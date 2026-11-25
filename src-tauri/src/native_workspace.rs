//! Native process admission shares the execution Host's managed-workspace gate.
//! A lease is released only after confirmed child exit; uncertain exits stay fenced.
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(crate) mod editor_buffers;

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
        admit_activity(&host, &id, cwd, kind, session_id)?;
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
        self.host.project(
            "native.activity.end",
            json!({"activityId":self.id}),
            |result, _projection| {
                if result["acknowledged"] != true {
                    return Err("Execution Host has not acknowledged native process exit".into());
                }
                Ok(())
            },
        )
    }
}

fn admit_activity(
    host: &crate::remote::NativeWorkspaceTransport,
    id: &str,
    cwd: &Path,
    kind: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    let mut request = json!({"activityId":id,"cwd":crate::fs::path_to_js(cwd),"kind":kind});
    if let Some(session_id) = session_id {
        request["sessionId"] = json!(session_id);
    }
    host.project("native.activity.start", request, |lease, _projection| {
        if lease["activityId"] != id
            || !lease["workspaceId"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        {
            return Err("Execution Host did not admit managed workspace activity".into());
        }
        Ok(())
    })
}

impl Drop for Activity {
    fn drop(&mut self) {
        if !self.started {
            let _ = self.host.project(
                "native.activity.end",
                json!({"activityId":self.id}),
                |_, _projection| Ok(()),
            );
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
                            // Host ids are 12 lowercase hex digits; `wt-optimization` is a plain branch worktree.
                            id.len() == 12
                                && id
                                    .bytes()
                                    .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
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
                    if let Ok(output) = crate::fs::git_cmd_output(&mut command) {
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

/// Tables of the retired persisted buffer reports, referencing tables first (history points at
/// bodies). Dropping a table also drops its triggers. Editor drafts (`native_editor_drafts*`) are
/// unrelated.
const RETIRED_BUFFER_TABLES: [&str; 9] = [
    "native_workspace_buffer_history",
    "native_workspace_buffers",
    "native_workspace_buffer_clock",
    "native_workspace_buffer_identity",
    "native_workspace_buffer_bodies",
    "native_workspace_buffer_guard_groups",
    "native_workspace_buffer_holds",
    "native_workspace_buffer_write_permits",
    "native_workspace_buffer_released",
];

/// One-time, idempotent migration run with the session-store schema.
pub(crate) fn ensure_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    // The retired tables reference each other; with foreign keys on, dropping a referenced table
    // first failed at app start. Checks run at commit, when none of them is left.
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")?;
    for table in RETIRED_BUFFER_TABLES {
        tx.execute_batch(&format!("DROP TABLE IF EXISTS {table};"))?;
    }
    tx.commit()
}

#[tauri::command]
pub async fn managed_workspace_buffers(
    app: AppHandle,
    window: tauri::Window,
    buffers: Vec<BufferState>,
) -> Result<(), String> {
    // The live registry is the only editor state: nothing is persisted or sent to the Host.
    app.state::<editor_buffers::EditorBuffers>()
        .report(window.label(), &buffers);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retired_buffer_tables_are_dropped_and_editor_drafts_survive() {
        let path =
            std::env::temp_dir().join(format!("native-buffer-drop-{}.db", uuid::Uuid::new_v4()));
        {
            let store = crate::session_store::SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            // Legacy shape, including a trigger that blocks deleting history rows.
            conn.execute_batch(
                "CREATE TABLE native_workspace_buffers(owner_id TEXT PRIMARY KEY,snapshot_json TEXT NOT NULL,updated_at INTEGER NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE native_workspace_buffer_bodies(id INTEGER PRIMARY KEY,body BLOB);
                 CREATE TABLE native_workspace_buffer_history(id INTEGER PRIMARY KEY,owner_id TEXT,body_id INTEGER REFERENCES native_workspace_buffer_bodies(id));
                 CREATE TRIGGER native_buffers_v2_history_delete BEFORE DELETE ON native_workspace_buffer_history BEGIN SELECT RAISE(ABORT,'NATIVE_BUFFER_HISTORY_IMMUTABLE'); END;
                 INSERT INTO native_workspace_buffers VALUES('main','[]',1,1);
                 INSERT INTO native_workspace_buffer_bodies VALUES(1,x'00');
                 INSERT INTO native_workspace_buffer_history(owner_id,body_id) VALUES('main',1);
                 INSERT INTO native_editor_drafts(owner_id,document_id,store_instance,window_incarnation,window_label,path,revision,payload_json,payload_digest,text_digest,serialized_text_digest,baseline_digest,retained_bytes,state,updated_at)
                 VALUES('o','d','s','w','main','C:/fixture/draft.ts',1,'{}','p','t','s','b',600,'retained',5);",
            )
            .unwrap();
        }
        // Reopening runs the schema setup again, including the drop migration.
        let store = crate::session_store::SessionStore::open(path.clone()).unwrap();
        let conn = store.lock_conn().unwrap();
        let retired: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'native_workspace_buffer%' OR name LIKE 'native_buffers_v2_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retired, 0);
        let draft: (String, String, i64) = conn
            .query_row(
                "SELECT path,state,updated_at FROM native_editor_drafts WHERE owner_id='o' AND document_id='d'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(draft, ("C:/fixture/draft.ts".into(), "retained".into(), 5));
        // The migration is idempotent.
        ensure_schema(&conn).unwrap();
        crate::native_editor_drafts::ensure_schema(&conn).unwrap();
        drop(conn);
        drop(store);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn activity_admission_omits_absent_session_and_keeps_explicit_session() {
        use std::io::{BufRead, BufReader, Read, Write};

        for session_id in [None, Some("activity-session")] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let host = crate::remote::NativeWorkspaceTransport::for_test(format!(
                "http://{}",
                listener.local_addr().unwrap()
            ));
            let server = std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                let (mut socket, _) = loop {
                    match listener.accept() {
                        Ok(socket) => break socket,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < deadline =>
                        {
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                        Err(error) => panic!("activity admission fixture was not called: {error}"),
                    }
                };
                // BSD-derived platforms let accepted sockets inherit the
                // listener's non-blocking mode; the fixture reads blocking.
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(socket.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert!(line.starts_with("POST /rpc "));
                let mut length = None;
                let mut authenticated = false;
                loop {
                    line.clear();
                    assert!(reader.read_line(&mut line).unwrap() > 0);
                    if line == "\r\n" {
                        break;
                    }
                    let (name, value) = line.split_once(':').unwrap();
                    if name.eq_ignore_ascii_case("content-length") {
                        length = Some(value.trim().parse::<usize>().unwrap());
                    }
                    if name.eq_ignore_ascii_case("authorization") {
                        authenticated = value.trim() == "Bearer fixture-token";
                    }
                }
                assert!(authenticated);
                let mut bytes = vec![0; length.unwrap()];
                reader.read_exact(&mut bytes).unwrap();
                let request: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(request["environmentId"], "fixture-env");
                assert_eq!(request["method"], "native.activity.start");
                let params = &request["params"];
                assert_eq!(params["activityId"], "activity-id");
                assert_eq!(params["kind"], "terminal");
                assert!(params["cwd"].as_str().is_some_and(|cwd| !cwd.is_empty()));
                match session_id {
                    Some(session_id) => assert_eq!(params["sessionId"], session_id),
                    None => assert!(params.get("sessionId").is_none()),
                }
                let response =
                    json!({"result":{"activityId":"activity-id","workspaceId":"managed"}})
                        .to_string();
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                    response.len()
                )
                .unwrap();
            });
            let admitted = admit_activity(
                &host,
                "activity-id",
                Path::new("C:/fixture/managed"),
                "terminal",
                session_id,
            );
            server.join().unwrap();
            admitted.unwrap();
        }
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
}
