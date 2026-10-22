//! Authenticated loopback transport. App windows own execution; callers never
//! receive arbitrary Tauri command access or direct database write access.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const APP_TURN_INACTIVE: &str = "bycoda app access is inactive. Use /operator once in this thread to enable it, then call the CLI during an active agent turn. Retrying this request now will not enable access.";

#[derive(Clone)]
struct Grant {
    window: String,
    session: String,
    cwd: String,
    token: String,
}
struct Pending {
    window: String,
    reply: mpsc::Sender<Value>,
    authority: Option<DesktopAuthority>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DesktopAuthority {
    pub relay_id: String,
    pub action: String,
    pub deadline: u64,
}
pub(crate) fn desktop_effect_action(action: &str) -> bool {
    matches!(
        action,
        "ssh.workspace.approve"
            | "ssh.workspace.close.approve"
            | "ptyMobile.create"
            | "ptyMobile.attach"
            | "ptyMobile.write"
            | "ptyMobile.resize"
            | "ptyMobile.detach"
            | "ptyMobile.close"
    )
}
fn clock_millis() -> Result<u64, String> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_millis() as u64)
}
struct ActiveTurn {
    window: String,
    cwd: String,
    app_allowed: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySource {
    session_id: String,
    cwd: String,
}
struct HistoryWindow {
    environment: String,
    seen: std::time::Instant,
    sources: HashMap<String, String>,
}
#[derive(Default)]
struct Inner {
    grants: HashMap<String, Grant>,
    app_grants: HashMap<String, Grant>,
    pending: HashMap<String, Pending>,
    workers: HashMap<String, String>,
    scratch: HashMap<String, PathBuf>,
    active: HashMap<String, ActiveTurn>,
    history_sources: HashMap<String, HistoryWindow>,
}
impl Inner {
    // Provider processes can stay alive between turns, so install the token
    // before their first spawn. Writes still require an opted-in active turn;
    // project session reads are available during ordinary active turns.
    fn prepare_app_grant(&mut self, session: &str, window: &str, cwd: &str) -> bool {
        if self.workers.contains_key(session) || self.grants.contains_key(session) {
            return false;
        }
        let token = self
            .app_grants
            .get(session)
            .map(|grant| grant.token.clone())
            .unwrap_or_else(|| {
                format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                )
            });
        self.app_grants.insert(
            session.to_string(),
            Grant {
                window: window.to_string(),
                session: session.to_string(),
                cwd: cwd.to_string(),
                token,
            },
        );
        true
    }

    fn window_sessions(&self, label: &str) -> Vec<String> {
        let leads: Vec<String> = self
            .grants
            .values()
            .filter(|grant| grant.window == label)
            .map(|grant| grant.session.clone())
            .collect();
        let mut ids = leads.clone();
        ids.extend(
            self.app_grants
                .values()
                .filter(|grant| grant.window == label)
                .map(|grant| grant.session.clone()),
        );
        ids.extend(
            self.workers
                .iter()
                .filter(|(_, lead)| leads.contains(lead))
                .map(|(id, _)| id.clone()),
        );
        ids.extend(
            self.active
                .iter()
                .filter(|(_, turn)| turn.window == label)
                .map(|(id, _)| id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }
    fn close_window(&mut self, label: &str) -> Vec<String> {
        self.history_sources.remove(label);
        let ids = self.window_sessions(label);
        self.grants.retain(|id, _| !ids.contains(id));
        self.app_grants.retain(|id, _| !ids.contains(id));
        self.workers.retain(|id, _| !ids.contains(id));
        self.scratch.retain(|id, _| !ids.contains(id));
        self.active.retain(|id, _| !ids.contains(id));
        self.pending.retain(|_, pending| {
            if pending.window != label {
                return true;
            }
            let _ = pending
                .reply
                .send(json!({"ok":false,"error":"bycoda window closed"}));
            false
        });
        ids
    }
}
pub struct ControlHost {
    endpoint: String,
    inner: Arc<Mutex<Inner>>,
}

fn paths_overlap(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

/** Windows paths compare case-insensitively; POSIX paths must retain case. */
fn comparison_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    token: String,
    namespace: String,
    action: String,
    input: Value,
    request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    namespace: String,
    session_id: String,
    request_id: String,
    action: String,
    input: Value,
}

fn request_grant(host: &Inner, namespace: &str, token: &str) -> Result<Grant, String> {
    let grant = match namespace {
        "control" => host.grants.values().find(|grant| grant.token == token),
        "app" => host.app_grants.values().find(|grant| grant.token == token),
        _ => return Err("Unknown control namespace".into()),
    }
    .cloned()
    .ok_or("Connection revoked or unauthorized")?;
    if namespace == "app"
        && (host.grants.contains_key(&grant.session)
            || host.workers.contains_key(&grant.session)
            || !host
                .active
                .get(&grant.session)
                .is_some_and(|turn| turn.window == grant.window && turn.app_allowed))
    {
        return Err(APP_TURN_INACTIVE.into());
    }
    Ok(grant)
}

fn request_grant_for_action(
    host: &Inner,
    namespace: &str,
    token: &str,
    action: &str,
) -> Result<Grant, String> {
    if namespace == "app" && matches!(action, "sessions.list" | "sessions.read") {
        let grant = host
            .app_grants
            .values()
            .find(|grant| grant.token == token)
            .cloned()
            .ok_or("Connection revoked or unauthorized")?;
        if !host
            .active
            .get(&grant.session)
            .is_some_and(|turn| turn.window == grant.window && turn.cwd == grant.cwd)
            || host.grants.contains_key(&grant.session)
            || host.workers.contains_key(&grant.session)
        {
            return Err("Session read access requires an active conversation turn".into());
        }
        return Ok(grant);
    }
    request_grant(host, namespace, token)
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let inner = Arc::new(Mutex::new(Inner::default()));
    app.manage(ControlHost {
        endpoint,
        inner: inner.clone(),
    });
    let app = app.clone();
    std::thread::spawn(move || {
        // Limit concurrent readers, including unauthenticated sockets.
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(32);
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..8 {
            let rx = rx.clone();
            let app = app.clone();
            let inner = inner.clone();
            std::thread::spawn(move || loop {
                let stream = match rx.lock() {
                    Ok(rx) => rx.recv(),
                    Err(_) => return,
                };
                let Ok(stream) = stream else { return };
                serve(stream, &app, &inner);
            });
        }
        for stream in listener.incoming().flatten() {
            let _ = tx.try_send(stream);
        }
    });
    Ok(())
}

fn serve(mut stream: TcpStream, app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let result = (|| -> Result<Value, String> {
        let mut raw = String::new();
        BufReader::new(&mut stream)
            .take(262_145)
            .read_line(&mut raw)
            .map_err(|e| e.to_string())?;
        if raw.len() > 262_144 {
            return Err("Request exceeds 256 KiB".into());
        }
        let request: Request = serde_json::from_str(&raw).map_err(|_| "Invalid control request")?;
        if !request.input.is_object()
            || request.request_id.is_empty()
            || request.request_id.len() > 128
        {
            return Err("Invalid input or request ID".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        let grant = {
            let mut host = inner.lock().map_err(|_| "Control service unavailable")?;
            let grant = request_grant_for_action(
                &host,
                &request.namespace,
                &request.token,
                &request.action,
            )?;
            if host.pending.len() >= 24 {
                return Err("Too many pending control requests".into());
            }
            host.pending.insert(
                id.clone(),
                Pending {
                    window: grant.window.clone(),
                    reply: tx,
                    authority: None,
                },
            );
            grant
        };
        let event = Event {
            id: id.clone(),
            namespace: request.namespace,
            session_id: grant.session,
            request_id: request.request_id,
            action: request.action,
            input: request.input,
        };
        let delivered = app.emit_to(grant.window.as_str(), "bycoda-control-request", event);
        let result = if delivered.is_err() {
            Err("bycoda executor is unavailable".into())
        } else {
            rx.recv_timeout(Duration::from_secs(35))
                .map_err(|_| "Control request timed out. Retry with the same request ID.".into())
        };
        if let Ok(mut host) = inner.lock() {
            host.pending.remove(&id);
        }
        result
    })();
    let response = result.unwrap_or_else(|error| {
        if error == APP_TURN_INACTIVE {
            json!({"ok": false, "error": error, "retryable": false})
        } else {
            json!({"ok": false, "error": error})
        }
    });
    let _ = writeln!(stream, "{response}");
}

fn conversation_ui_window(
    host: &Inner,
    session: &str,
    cwd: &str,
    environment: &str,
) -> Result<String, String> {
    let active = host
        .active
        .get(session)
        .ok_or("The conversation is not active in a desktop window")?;
    let normalize = |path: &str| {
        let path = path
            .replace('\\', "/")
            .trim_end_matches('/')
            .trim_start_matches("//?/")
            .to_owned();
        let path = if let Some(unc) = path.strip_prefix("UNC/") {
            format!("//{unc}")
        } else {
            path
        };
        if path.as_bytes().get(1) == Some(&b':') || path.starts_with("//") {
            path.to_lowercase()
        } else {
            path
        }
    };
    let actual = if let Some(remote) = active.cwd.strip_prefix(&format!("remote://{environment}/"))
    {
        if remote.as_bytes().get(1) == Some(&b':') {
            remote.to_owned()
        } else {
            format!("/{remote}")
        }
    } else if active.cwd.starts_with("remote://") {
        return Err("Conversation belongs to another host".into());
    } else {
        std::fs::canonicalize(&active.cwd)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| active.cwd.clone())
    };
    let expected = if active.cwd.starts_with("remote://") {
        cwd.to_owned()
    } else {
        std::fs::canonicalize(cwd)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| cwd.to_owned())
    };
    if normalize(&actual) != normalize(&expected) {
        return Err("Conversation belongs to another project".into());
    }
    Ok(active.window.clone())
}

fn history_import_input(
    action: &str,
    input: &Value,
    session: &str,
    cwd: &str,
    environment: &str,
) -> Result<Value, String> {
    let allowed: &[&str] = match action {
        "historyImport.discover" => &["sessionId"],
        "historyImport.commit" => &[
            "sessionId",
            "reviewId",
            "digest",
            "candidateIds",
            "operationId",
        ],
        "historyImport.status" | "historyImport.cancel" => &["sessionId", "operationId"],
        "organization.read" | "providerManagement.read" => &["sessionId"],
        "providerManagement.patch" => &[
            "sessionId",
            "operationId",
            "expectedAccountRevision",
            "provider",
            "accountId",
            "change",
        ],
        "providerManagement.status" => &["sessionId", "operationId"],
        "providerManagement.quotaRefresh" => &[
            "sessionId",
            "operationId",
            "expectedAccountRevision",
            "provider",
            "accountId",
            "confirm",
        ],
        "organization.patch" => &["sessionId", "expectedRevision", "operationId", "change"],
        "organization.status" => &["sessionId", "operationId"],
        "preferences.read" => &["sessionId"],
        "preferences.templateRead" => &["sessionId", "templateId", "expectedRevision"],
        "preferences.patch" => &["sessionId", "expectedRevision", "operationId", "change"],
        "preferences.status" => &["sessionId", "operationId"],
        "worktrees.removal.review" => &["sessionId", "path"],
        "worktrees.removal.approve" => &["sessionId", "reviewId", "requestId"],
        "worktrees.removal.status" => &["sessionId", "requestId"],
        "ptyMobile.list" => &["sessionId", "actorId"],
        "ptyMobile.create" => &[
            "sessionId",
            "actorId",
            "requestId",
            "profileId",
            "cols",
            "rows",
        ],
        "ptyMobile.attach" => &[
            "sessionId",
            "actorId",
            "terminalId",
            "epoch",
            "requestId",
            "after",
            "freshRenderer",
        ],
        "ptyMobile.read" => &[
            "sessionId",
            "actorId",
            "terminalId",
            "epoch",
            "after",
            "limit",
        ],
        "ptyMobile.write" => &[
            "sessionId",
            "actorId",
            "terminalId",
            "epoch",
            "leaseId",
            "inputSequence",
            "dataBase64",
        ],
        "ptyMobile.resize" => &[
            "sessionId",
            "actorId",
            "terminalId",
            "epoch",
            "leaseId",
            "cols",
            "rows",
        ],
        "ptyMobile.status" => &[
            "sessionId",
            "actorId",
            "terminalId",
            "epoch",
            "leaseId",
            "requestId",
        ],
        "ptyMobile.detach" => &["sessionId", "actorId", "terminalId", "epoch", "leaseId"],
        "ptyMobile.close" => &["sessionId", "actorId", "terminalId", "epoch", "requestId"],
        "ssh.workspace.catalog.read" => &["sessionId", "actorId"],
        "ssh.workspace.review" => &["sessionId", "actorId", "connectionId"],
        "ssh.workspace.approve" | "ssh.workspace.close.approve" => {
            &["sessionId", "actorId", "reviewId", "requestId"]
        }
        "ssh.workspace.status" => &["sessionId", "actorId", "requestId", "workspaceId"],
        "ssh.workspace.close.review" => &["sessionId", "actorId", "workspaceId"],
        _ => return Err("Unsupported history import action".into()),
    };
    let mut fields = input
        .as_object()
        .cloned()
        .ok_or("Invalid history import request")?;
    if fields.keys().any(|key| !allowed.contains(&key.as_str()))
        || fields.get("sessionId").and_then(Value::as_str) != Some(session)
    {
        return Err("History import source identity mismatch".into());
    }
    fields.insert("environmentId".into(), Value::String(environment.into()));
    fields.insert("projectCwd".into(), Value::String(cwd.into()));
    Ok(Value::Object(fields))
}

fn history_source_window(
    host: &Inner,
    session: &str,
    cwd: &str,
    environment: &str,
) -> Result<String, String> {
    let canonical = |path: &str| {
        let path = std::fs::canonicalize(path)
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|_| path.into());
        let path = path
            .replace('\\', "/")
            .trim_start_matches("//?/")
            .trim_end_matches('/')
            .to_owned();
        if path.as_bytes().get(1) == Some(&b':') || path.starts_with("//") {
            path.to_lowercase()
        } else {
            path
        }
    };
    let mut owners = host.history_sources.iter().filter(|(_, owner)| {
        owner.environment == environment
            && owner.seen.elapsed() < Duration::from_secs(45)
            && owner.sources.get(session).is_some_and(|actual| {
                !actual.starts_with("remote://") && canonical(actual) == canonical(cwd)
            })
    });
    let (window, _) = owners
        .next()
        .ok_or("Open the source conversation in the local bycoda desktop")?;
    if owners.next().is_some() {
        return Err("History source is open in multiple desktop windows".into());
    }
    Ok(window.clone())
}

pub(crate) fn validate_history_source_owner(
    app: &AppHandle,
    window: &str,
    session: &str,
    cwd: &str,
    environment: &str,
) -> Result<(), String> {
    let state = app.state::<ControlHost>();
    let host = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if history_source_window(&host, session, cwd, environment)? != window {
        return Err("Source owner window changed".into());
    }
    Ok(())
}

/// Only advertises local open sources for the history-import relay. It grants no agent/operator access.
#[tauri::command]
pub fn control_history_sources(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    sources: Vec<HistorySource>,
) -> Result<(), String> {
    if sources.len() > 1000
        || sources.iter().any(|source| {
            source.session_id.is_empty()
                || source.session_id.len() > 200
                || source.cwd.len() > 4096
                || source.cwd.contains('\0')
                || source.cwd.starts_with("remote://")
                || !Path::new(&source.cwd).is_absolute()
        })
    {
        return Err("Invalid local history sources".into());
    }
    let environment = if sources.is_empty() {
        None
    } else {
        Some(crate::remote::local_conversation_environment(&app)?)
    };
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if sources.is_empty() {
        inner.history_sources.remove(window.label());
        return Ok(());
    }
    let environment = environment.ok_or("Local history environment unavailable")?;
    inner.history_sources.insert(
        window.label().into(),
        HistoryWindow {
            environment,
            seen: std::time::Instant::now(),
            sources: sources
                .into_iter()
                .map(|source| (source.session_id, source.cwd))
                .collect(),
        },
    );
    Ok(())
}

/// Host-granted UI and project session reads; never enables general /operator access.
pub(crate) fn conversation_ui_request(
    app: &AppHandle,
    session: &str,
    cwd: &str,
    environment: &str,
    action: &str,
    input: Value,
) -> Result<Value, String> {
    conversation_ui_request_with_authority(app, session, cwd, environment, action, input, None)
}

pub(crate) fn conversation_ui_request_with_authority(
    app: &AppHandle,
    session: &str,
    cwd: &str,
    environment: &str,
    action: &str,
    input: Value,
    authority: Option<DesktopAuthority>,
) -> Result<Value, String> {
    if let Some(authority) = authority.as_ref() {
        if authority.action != action
            || !desktop_effect_action(action)
            || uuid::Uuid::parse_str(&authority.relay_id).is_err()
            || authority.deadline <= clock_millis()?
        {
            return Err("Invalid desktop effect authority".into());
        }
    }
    if !matches!(
        action,
        "ui.tools.status"
            | "ui.tools.open"
            | "ui.tools.place"
            | "ui.tools.close"
            | "ui.workspace.list"
            | "ui.workspace.status"
            | "ui.workspace.open"
            | "ui.workspace.close"
            | "terminals.create"
            | "terminals.interrupt"
            | "terminals.close"
            | "sessions.list"
            | "sessions.read"
            | "historyImport.discover"
            | "historyImport.commit"
            | "historyImport.status"
            | "historyImport.cancel"
            | "organization.read"
            | "providerManagement.read"
            | "providerManagement.patch"
            | "providerManagement.status"
            | "providerManagement.quotaRefresh"
            | "organization.patch"
            | "organization.status"
            | "preferences.read"
            | "preferences.templateRead"
            | "preferences.patch"
            | "preferences.status"
            | "ptyMobile.list"
            | "ptyMobile.create"
            | "ptyMobile.attach"
            | "ptyMobile.read"
            | "ptyMobile.write"
            | "ptyMobile.status"
            | "ptyMobile.resize"
            | "ptyMobile.detach"
            | "ptyMobile.close"
            | "ssh.workspace.catalog.read"
            | "ssh.workspace.review"
            | "ssh.workspace.approve"
            | "ssh.workspace.status"
            | "ssh.workspace.close.review"
            | "ssh.workspace.close.approve"
            | "worktrees.removal.review"
            | "worktrees.removal.approve"
            | "worktrees.removal.status"
    ) || !input.is_object()
    {
        return Err("Unsupported Conversation UI action".into());
    }
    let history = action.starts_with("ptyMobile.")
        || action.starts_with("ssh.workspace.")
        || action.starts_with("historyImport.")
        || action.starts_with("organization.")
        || action.starts_with("preferences.")
        || matches!(
            action,
            "providerManagement.read"
                | "providerManagement.patch"
                | "providerManagement.status"
                | "providerManagement.quotaRefresh"
        )
        || action.starts_with("worktrees.removal.");
    let input = if history {
        history_import_input(action, &input, session, cwd, environment)?
    } else {
        input
    };
    let state = app.state::<ControlHost>();
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    let window = {
        let mut host = state
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        let window = if history {
            history_source_window(&host, session, cwd, environment)?
        } else {
            conversation_ui_window(&host, session, cwd, environment)?
        };
        if host.pending.len() >= 24 {
            return Err("Too many pending control requests".into());
        }
        host.pending.insert(
            id.clone(),
            Pending {
                window: window.clone(),
                reply: tx,
                authority,
            },
        );
        window
    };
    let event = Event {
        id: id.clone(),
        namespace: "conversation-ui".into(),
        session_id: session.into(),
        request_id: id.clone(),
        action: action.into(),
        input,
    };
    if matches!(
        action,
        "ui.tools.open" | "ui.tools.place" | "ui.workspace.open"
    ) {
        if let Some(view) = app.get_webview_window(&window) {
            let _ = view.show();
            let _ = view.unminimize();
        }
    }
    let result = if app
        .emit_to(window.as_str(), "bycoda-control-request", event)
        .is_err()
    {
        Err("Conversation window is unavailable".into())
    } else {
        // Terminal close retains the existing native foreground-process confirmation.
        // Its renderer deadline expires before this wait, so a late approval cannot kill work.
        let timeout = if matches!(
            action,
            "ssh.workspace.approve" | "ssh.workspace.close.approve"
        ) {
            240
        } else if action == "terminals.close" {
            120
        } else {
            15
        };
        rx.recv_timeout(Duration::from_secs(timeout)).map_err(|_| {
            "Conversation UI request timed out; read ui.tools.status before retrying".to_owned()
        })
    };
    if let Ok(mut host) = state.inner.lock() {
        host.pending.remove(&id);
    }
    let value = result?;
    if value["ok"] != true {
        return Err(value["error"]
            .as_str()
            .unwrap_or("Conversation UI action failed")
            .to_owned());
    }
    Ok(value["result"].clone())
}

#[tauri::command]
pub fn control_enable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    cwd: String,
) -> Result<String, String> {
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    if !cwd.is_dir() {
        return Err("Choose a project folder first".into());
    }
    let cwd = comparison_path(&cwd);
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if let Some((id, _)) = inner
        .active
        .iter()
        .find(|(id, turn)| *id != &session_id && paths_overlap(&turn.cwd, &cwd))
    {
        return Err(format!(
            "Another session ({id}) is running in this checkout. Stop it before enabling orchestration."
        ));
    }
    if inner.grants.values().any(|g| {
        paths_overlap(&g.cwd, &cwd) && (g.session != session_id || g.window != window.label())
    }) {
        return Err("This checkout already has an orchestrator in another session".into());
    }
    // A lead may return to ordinary chat without respawning its provider.
    // Keep its app token installed but unusable until a later opted-in turn.
    inner.prepare_app_grant(&session_id, window.label(), &cwd);
    inner.grants.insert(
        session_id.clone(),
        Grant {
            window: window.label().into(),
            session: session_id.clone(),
            cwd,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        },
    );
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(executable.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn control_disable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&session_id)
        .is_some_and(|g| g.window == window.label())
    {
        inner.grants.remove(&session_id);
        inner.workers.retain(|_, parent| parent != &session_id);
        let workers = inner.workers.clone();
        inner.scratch.retain(|id, _| workers.contains_key(id));
    }
    Ok(())
}

#[tauri::command]
pub fn control_attach_worker(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    lead_id: String,
    session_id: String,
) -> Result<String, String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&lead_id)
        .is_none_or(|grant| grant.window != window.label())
    {
        return Err("Lead connection is inactive".into());
    }
    let scratch = match inner.scratch.get(&session_id) {
        Some(path) if path.is_dir() => path.clone(),
        _ => create_worker_scratch()?,
    };
    inner.workers.insert(session_id.clone(), lead_id);
    inner.app_grants.remove(&session_id);
    inner.scratch.insert(session_id, scratch.clone());
    Ok(scratch.to_string_lossy().into_owned())
}

fn create_worker_scratch() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("bycoda-worker-{}", uuid::Uuid::new_v4()));
    let builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(&path).map_err(|e| e.to_string())?;
    std::fs::canonicalize(path).map_err(|e| e.to_string())
}

fn configure_worker_scratch(cmd: &mut Command, path: &Path) {
    // Native temp-file helpers and shell mktemp use the same private scope
    // that is named in the worker's assignment prompt.
    cmd.env("TMPDIR", path).env("TMP", path).env("TEMP", path);
}

#[tauri::command]
pub fn control_authorize_turn(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    cwd: String,
    app_access: bool,
) -> Result<(), String> {
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    let cwd = comparison_path(&cwd);
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if let Some(lead) = inner
        .grants
        .values()
        .find(|grant| paths_overlap(&grant.cwd, &cwd))
    {
        if lead.window != window.label()
            || (lead.session != session_id && inner.workers.get(&session_id) != Some(&lead.session))
        {
            return Err("This checkout is controlled by an orchestrator. Stop that run before starting independent work.".into());
        }
    }
    let eligible = inner.prepare_app_grant(&session_id, window.label(), &cwd);
    let app_allowed = app_access && eligible;
    inner.active.insert(
        session_id,
        ActiveTurn {
            window: window.label().to_string(),
            cwd,
            app_allowed,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn control_turn_finished(host: State<'_, ControlHost>, session_id: String) {
    if let Ok(mut inner) = host.inner.lock() {
        inner.active.remove(&session_id);
    }
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let host = app.state::<ControlHost>();
    let ids = {
        let Ok(inner) = host.inner.lock() else { return };
        inner.window_sessions(label)
    };
    // Each kill waits for taskkill, so run them off the event loop. The reaper
    // is tracked, so exit still waits for these children to die.
    if !ids.is_empty() {
        crate::spawn_tracked_reap(app, move |handle| {
            for id in &ids {
                let _ = crate::harness::harness_kill(handle.state(), id.clone());
            }
        });
    }
    if let Ok(mut inner) = host.inner.lock() {
        inner.close_window(label);
    };
}

pub fn configure_child(app: &AppHandle, session_id: &str, cmd: &mut Command) {
    cmd.env_remove("BYCODA_CONTROL_ENDPOINT")
        .env_remove("BYCODA_CONTROL_TOKEN")
        .env_remove("BYCODA_APP_ENDPOINT")
        .env_remove("BYCODA_APP_TOKEN");
    let Some(host) = app.try_state::<ControlHost>() else {
        return;
    };
    if let Ok(inner) = host.inner.lock() {
        if let Some(grant) = inner.grants.get(session_id) {
            cmd.env("BYCODA_CONTROL_ENDPOINT", &host.endpoint)
                .env("BYCODA_CONTROL_TOKEN", &grant.token);
        }
        if let Some(grant) = inner.app_grants.get(session_id) {
            cmd.env("BYCODA_APP_ENDPOINT", &host.endpoint)
                .env("BYCODA_APP_TOKEN", &grant.token);
        }
        if let Some(scratch) = inner.scratch.get(session_id) {
            configure_worker_scratch(cmd, scratch);
        }
    };
}

#[tauri::command]
pub fn app_cli_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn control_reply(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    response: Value,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .pending
        .get(&id)
        .is_some_and(|p| p.window == window.label())
    {
        if let Some(pending) = inner.pending.remove(&id) {
            let _ = pending.reply.send(response);
        }
    }
    Ok(())
}

fn pending_desktop_authority(
    inner: &Inner,
    window: &str,
    id: &str,
    action: &str,
    now: u64,
) -> Result<DesktopAuthority, String> {
    let pending = inner
        .pending
        .get(id)
        .filter(|entry| entry.window == window)
        .ok_or("Desktop effect request is no longer pending in this window")?;
    let authority = pending
        .authority
        .as_ref()
        .filter(|value| {
            desktop_effect_action(action) && value.action == action && value.deadline > now
        })
        .ok_or("Desktop effect authority is missing or expired")?;
    Ok(authority.clone())
}

fn authorize_desktop_effect_with(
    inner: &Mutex<Inner>,
    window: &str,
    id: &str,
    action: &str,
    now: impl Fn() -> Result<u64, String>,
    query: impl FnOnce(&DesktopAuthority) -> Result<bool, String>,
) -> Result<bool, String> {
    let authority = {
        let guard = inner.lock().map_err(|_| "Control service unavailable")?;
        pending_desktop_authority(&guard, window, id, action, now()?)?
    };
    if !query(&authority)? {
        return Ok(false);
    }
    let current = {
        let guard = inner.lock().map_err(|_| "Control service unavailable")?;
        pending_desktop_authority(&guard, window, id, action, now()?)?
    };
    if current != authority {
        return Err("Desktop effect authority changed during authorization".into());
    }
    Ok(true)
}

/// Live pre-effect check. The original upstream ID is retained only in native memory.
#[tauri::command(async)]
pub fn control_desktop_authorize_effect(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    action: String,
) -> Result<bool, String> {
    authorize_desktop_effect_with(
        &host.inner,
        window.label(),
        &id,
        &action,
        clock_millis,
        |authority| {
            let result = crate::remote::local_conversation_rpc(
                &app,
                "conversation.desktop.authorize",
                json!({"id": authority.relay_id, "action": authority.action}),
            )
            .map_err(|_| "Desktop effect authorization is unavailable".to_string())?;
            Ok(result.as_object().is_some_and(|value| {
                value.len() == 1 && value.get("authorized") == Some(&Value::Bool(true))
            }))
        },
    )
}

#[tauri::command(async)]
pub fn control_save(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
    state: String,
) -> Result<(), String> {
    if state.len() > 8_000_000 {
        return Err("Orchestration history is too large".into());
    }
    let run: Value = serde_json::from_str(&state).map_err(|_| "Invalid run state")?;
    let conn = store.lock_conn()?;
    crate::session_store::save_orchestration(&conn, &lead_id, &run).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(async)]
pub fn control_load(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    store
        .lock_conn()?
        .query_row(
            "SELECT state FROM orchestration_runs WHERE lead_id=?1",
            [lead_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn resolve_scope(root: &Path, value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Write scopes must be project-relative paths without '..'".into());
    }
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut existing = root.join(path);
    let mut missing = Vec::new();
    while !existing.exists() {
        missing.push(existing.file_name().ok_or("Invalid scope")?.to_os_string());
        if !existing.pop() {
            return Err("Invalid scope".into());
        }
    }
    existing = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !existing.starts_with(&root) {
        return Err("Write scope points outside the project".into());
    }
    for part in missing.into_iter().rev() {
        existing.push(part);
    }
    Ok(comparison_path(&existing))
}

/// Resolve reported writes as well as scopes: aliases and symlinks must not
/// turn a private scratch directory into an exemption for another worker's files.
#[tauri::command(async)]
pub fn control_write_path(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("Reported write paths must be absolute".into());
    }
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        // A dangling symlink cannot be treated as a new ordinary file.
        if std::fs::symlink_metadata(existing).is_ok() {
            return Err("Reported write path contains a dangling symlink".into());
        }
        missing.push(
            existing
                .file_name()
                .ok_or("Invalid write path")?
                .to_os_string(),
        );
        existing = existing.parent().ok_or("Invalid write path")?;
    }
    let mut resolved = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved.to_string_lossy().replace('\\', "/"))
}

#[tauri::command(async)]
pub fn control_scopes(cwd: String, files: Vec<String>) -> Result<Vec<String>, String> {
    if files.len() > 64 {
        return Err("At most 64 write scopes per task".into());
    }
    files
        .iter()
        .map(|file| {
            resolve_scope(&crate::fs::expand_home(&cwd), file)
                .map_err(|error| format!("Invalid write scope \"{file}\": {error}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    fn effect_fixture() -> std::sync::Mutex<super::Inner> {
        let mut inner = super::Inner::default();
        let (reply, _) = std::sync::mpsc::channel();
        inner.pending.insert(
            "native-request".into(),
            super::Pending {
                window: "source-window".into(),
                reply,
                authority: Some(super::DesktopAuthority {
                    relay_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
                    action: "ssh.workspace.approve".into(),
                    deadline: 200,
                }),
            },
        );
        std::sync::Mutex::new(inner)
    }

    #[test]
    fn desktop_effect_authority_uses_original_host_id_and_checks_live_owner() {
        let inner = effect_fixture();
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(100),
            |authority| {
                assert_ne!(authority.relay_id, "native-request");
                assert_eq!(authority.relay_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
                Ok(true)
            }
        )
        .unwrap());
        assert!(!super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(100),
            |_| Ok(false)
        )
        .unwrap());
        for (window, action) in [
            ("foreign", "ssh.workspace.approve"),
            ("source-window", "ssh.workspace.close.approve"),
            ("source-window", "ssh.workspace.status"),
        ] {
            assert!(super::authorize_desktop_effect_with(
                &inner,
                window,
                "native-request",
                action,
                || Ok(100),
                |_| panic!("invalid owner/action must not query host")
            )
            .is_err());
        }
    }

    #[test]
    fn desktop_effect_authority_refuses_missing_expired_and_unlinked_requests() {
        let inner = effect_fixture();
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(200),
            |_| panic!("expired authority must not query host")
        )
        .is_err());
        inner
            .lock()
            .unwrap()
            .pending
            .get_mut("native-request")
            .unwrap()
            .authority = None;
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(100),
            |_| panic!("local/unlinked authority must not query host")
        )
        .is_err());
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "missing",
            "ssh.workspace.approve",
            || Ok(100),
            |_| panic!("missing authority must not query host")
        )
        .is_err());
    }

    #[test]
    fn desktop_effect_authority_rechecks_pending_and_deadline_after_host_response() {
        let inner = effect_fixture();
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(100),
            |_| {
                inner.lock().unwrap().pending.remove("native-request");
                Ok(true)
            }
        )
        .is_err());
        let inner = effect_fixture();
        let now = std::cell::Cell::new(100);
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(now.get()),
            |_| {
                now.set(201);
                Ok(true)
            }
        )
        .is_err());
        let inner = effect_fixture();
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(100),
            |_| Err("host unavailable".into())
        )
        .is_err());
    }
    #[test]
    fn history_import_exact_inputs_pin_native_identity() {
        let value = super::history_import_input(
            "historyImport.discover",
            &serde_json::json!({"sessionId":"source"}),
            "source",
            "/project",
            "native-host",
        )
        .unwrap();
        assert_eq!(value["environmentId"], "native-host");
        assert_eq!(value["projectCwd"], "/project");
        for input in [
            serde_json::json!({"sessionId":"other"}),
            serde_json::json!({"sessionId":"source", "environmentId":"forged"}),
            serde_json::json!({"sessionId":"source", "projectCwd":"/private"}),
            serde_json::json!({"sessionId":"source", "invoke":"session_import"}),
        ] {
            assert!(super::history_import_input(
                "historyImport.discover",
                &input,
                "source",
                "/project",
                "native-host"
            )
            .is_err());
        }
        assert!(super::history_import_input(
            "historyImport.arbitrary",
            &serde_json::json!({"sessionId":"source"}),
            "source",
            "/project",
            "native-host"
        )
        .is_err());
    }
    #[test]
    fn preferences_exact_actions_reject_injected_identity_and_native_invokes() {
        for (action, input) in [
            (
                "preferences.read",
                serde_json::json!({"sessionId":"source"}),
            ),
            (
                "preferences.templateRead",
                serde_json::json!({"sessionId":"source","templateId":"one","expectedRevision":"review"}),
            ),
            (
                "preferences.patch",
                serde_json::json!({"sessionId":"source","expectedRevision":"review","operationId":"operation","change":{"kind":"projectReset"}}),
            ),
            (
                "preferences.status",
                serde_json::json!({"sessionId":"source","operationId":"operation"}),
            ),
        ] {
            let result =
                history_import_input(action, &input, "source", "G:/project/worktree", "native")
                    .unwrap();
            assert_eq!(result["environmentId"], "native");
            assert_eq!(result["projectCwd"], "G:/project/worktree");
            for field in ["cwd", "projectCwd", "environmentId", "invoke"] {
                let mut injected = input.clone();
                injected[field] = Value::String("injected".into());
                assert!(history_import_input(
                    action,
                    &injected,
                    "source",
                    "G:/project/worktree",
                    "native"
                )
                .is_err());
            }
            assert!(history_import_input(
                action,
                &input,
                "other-source",
                "G:/project/worktree",
                "native"
            )
            .is_err());
        }
        assert!(history_import_input(
            "preferences.invoke",
            &serde_json::json!({"sessionId":"source"}),
            "source",
            "G:/project",
            "native"
        )
        .is_err());
    }

    #[test]
    fn organization_exact_actions_reject_injected_identity_and_native_invokes() {
        assert!(history_import_input(
            "organization.read",
            &serde_json::json!({"sessionId":"source"}),
            "source",
            "G:/project/worktree",
            "host"
        )
        .is_ok());
        assert!(history_import_input("organization.patch", &serde_json::json!({"sessionId":"source", "expectedRevision":"review", "operationId":"operation", "change":{"kind":"projectName","name":"Display"}}), "source", "G:/project/worktree", "host").is_ok());
        for input in [
            serde_json::json!({"sessionId":"source","projectCwd":"G:/private"}),
            serde_json::json!({"sessionId":"source","environmentId":"foreign"}),
            serde_json::json!({"sessionId":"source","invoke":"session_import"}),
        ] {
            assert!(history_import_input(
                "organization.read",
                &input,
                "source",
                "G:/project/worktree",
                "host"
            )
            .is_err());
        }
    }
    #[test]
    fn provider_management_read_pins_native_source_and_rejects_injected_fields() {
        let value = history_import_input(
            "providerManagement.read",
            &serde_json::json!({"sessionId":"source"}),
            "source",
            "G:/project",
            "host",
        )
        .unwrap();
        assert_eq!(value["environmentId"], "host");
        assert_eq!(value["projectCwd"], "G:/project");
        for field in [
            "environmentId",
            "projectCwd",
            "workingCwd",
            "invoke",
            "fetch",
            "approved",
        ] {
            let mut input = serde_json::json!({"sessionId":"source"});
            input[field] = serde_json::json!("injected");
            assert!(history_import_input(
                "providerManagement.read",
                &input,
                "source",
                "G:/project",
                "host"
            )
            .is_err());
        }
        assert!(history_import_input(
            "providerManagement.write",
            &serde_json::json!({"sessionId":"source"}),
            "source",
            "G:/project",
            "host"
        )
        .is_err());
        let patch = serde_json::json!({"sessionId":"source", "operationId":"operation", "expectedAccountRevision":"review", "provider":"claude", "accountId":"one", "change":{"kind":"rename","label":"Display"}});
        assert!(history_import_input(
            "providerManagement.patch",
            &patch,
            "source",
            "G:/project",
            "host"
        )
        .is_ok());
        assert!(history_import_input(
            "providerManagement.status",
            &serde_json::json!({"sessionId":"source","operationId":"operation"}),
            "source",
            "G:/project",
            "host"
        )
        .is_ok());
        let quota = serde_json::json!({"sessionId":"source","operationId":"quota","expectedAccountRevision":"review","provider":"claude","accountId":"one","confirm":"REFRESH_PROVIDER_QUOTA"});
        assert!(history_import_input(
            "providerManagement.quotaRefresh",
            &quota,
            "source",
            "G:/project",
            "host"
        )
        .is_ok());
        let mut forged_quota = quota;
        forged_quota["url"] = serde_json::json!("https://private");
        assert!(history_import_input(
            "providerManagement.quotaRefresh",
            &forged_quota,
            "source",
            "G:/project",
            "host"
        )
        .is_err());
        for action in ["providerManagement.patch", "providerManagement.status"] {
            let mut forged = patch.clone();
            forged["approved"] = serde_json::json!(true);
            assert!(history_import_input(action, &forged, "source", "G:/project", "host").is_err());
        }
    }
    #[test]
    fn history_import_routes_idle_sources_without_active_turn_or_app_grants() {
        let mut host = Inner::default();
        host.history_sources.insert(
            "owner".into(),
            HistoryWindow {
                environment: "host".into(),
                seen: std::time::Instant::now(),
                sources: HashMap::from([("idle".into(), "G:/project/worktree".into())]),
            },
        );
        assert!(host.active.is_empty());
        assert!(host.app_grants.is_empty());
        assert_eq!(
            history_source_window(&host, "idle", "g:/PROJECT/worktree", "host").unwrap(),
            "owner"
        );
        assert!(history_source_window(&host, "idle", "G:/project", "host").is_err());
        assert!(history_source_window(&host, "idle", "G:/project/worktree", "other-host").is_err());
        assert!(conversation_ui_window(&host, "idle", "G:/project/worktree", "host").is_err());
        host.history_sources.insert(
            "duplicate".into(),
            HistoryWindow {
                environment: "host".into(),
                seen: std::time::Instant::now(),
                sources: HashMap::from([("idle".into(), "G:/project/worktree".into())]),
            },
        );
        assert!(history_source_window(&host, "idle", "G:/project/worktree", "host").is_err());
        host.history_sources.remove("duplicate");
        host.history_sources.get_mut("owner").unwrap().seen =
            std::time::Instant::now() - Duration::from_secs(46);
        assert!(history_source_window(&host, "idle", "G:/project/worktree", "host").is_err());
        host.history_sources.get_mut("owner").unwrap().seen = std::time::Instant::now();
        host.history_sources
            .get_mut("owner")
            .unwrap()
            .sources
            .insert("idle".into(), "G:/moved".into());
        assert!(history_source_window(&host, "idle", "G:/project/worktree", "host").is_err());
        host.close_window("owner");
        assert!(host.history_sources.is_empty());
        assert!(history_source_window(&host, "idle", "G:/moved", "host").is_err());
    }
    use super::*;
    #[test]
    fn conversation_ui_routes_only_the_active_owning_window_without_operator_access() {
        let mut host = Inner::default();
        host.active.insert(
            "session".into(),
            ActiveTurn {
                window: "own-window".into(),
                cwd: "G:/demo/project".into(),
                app_allowed: false,
            },
        );
        assert_eq!(
            conversation_ui_window(&host, "session", "g:/DEMO/project", "host").unwrap(),
            "own-window"
        );
        assert!(conversation_ui_window(&host, "session", "G:/other", "host").is_err());
        assert!(conversation_ui_window(&host, "other-session", "G:/demo/project", "host").is_err());
        host.active.get_mut("session").unwrap().cwd = "remote://mac-host/Users/me/project".into();
        assert_eq!(
            conversation_ui_window(&host, "session", "/Users/me/project", "mac-host").unwrap(),
            "own-window"
        );
        assert!(
            conversation_ui_window(&host, "session", "/Users/me/project", "wrong-host").is_err()
        );
        assert!(conversation_ui_window(&host, "session", "/users/me/project", "mac-host").is_err());
        assert!(!host.active["session"].app_allowed);
    }
    #[test]
    fn app_tokens_are_bound_to_active_turns_and_cannot_control_orchestration() {
        let mut inner = Inner::default();
        inner.app_grants.insert(
            "ordinary".into(),
            Grant {
                window: "main".into(),
                session: "ordinary".into(),
                cwd: "/repo".into(),
                token: "app-token".into(),
            },
        );
        assert!(matches!(
            request_grant(&inner, "app", "app-token"),
            Err(error) if error == APP_TURN_INACTIVE
        ));
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/repo".into(),
                app_allowed: true,
            },
        );
        assert!(request_grant(&inner, "app", "app-token").is_ok());
        assert!(request_grant(&inner, "control", "app-token").is_err());
        inner.active.get_mut("ordinary").unwrap().app_allowed = false;
        assert!(request_grant(&inner, "app", "app-token").is_err());
        assert!(request_grant_for_action(&inner, "app", "app-token", "sessions.list").is_ok());
        assert!(request_grant_for_action(&inner, "app", "app-token", "sessions.read").is_ok());
        for action in [
            "sessions.send",
            "sessions.draft",
            "sessions.start",
            "notes.write",
        ] {
            assert!(request_grant_for_action(&inner, "app", "app-token", action).is_err());
        }
        assert!(request_grant_for_action(&inner, "app", "wrong-token", "sessions.read").is_err());
        inner.active.get_mut("ordinary").unwrap().cwd = "/foreign".into();
        assert!(request_grant_for_action(&inner, "app", "app-token", "sessions.read").is_err());
        inner.active.get_mut("ordinary").unwrap().cwd = "/repo".into();
        inner.active.remove("ordinary");
        assert!(request_grant(&inner, "app", "app-token").is_err());
        assert!(request_grant_for_action(&inner, "app", "app-token", "sessions.read").is_err());
    }
    #[test]
    fn app_token_survives_normal_turns_but_only_works_when_opted_in() {
        let mut inner = Inner::default();
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        let token = inner.app_grants["ordinary"].token.clone();
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/repo".into(),
                app_allowed: false,
            },
        );
        assert!(request_grant(&inner, "app", &token).is_err());
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        assert_eq!(inner.app_grants["ordinary"].token, token);
        inner.grants.insert(
            "ordinary".into(),
            Grant {
                window: "main".into(),
                session: "ordinary".into(),
                cwd: "/repo".into(),
                token: "control-token".into(),
            },
        );
        assert!(!inner.prepare_app_grant("ordinary", "main", "/repo"));
        inner.active.get_mut("ordinary").unwrap().app_allowed = true;
        assert!(request_grant(&inner, "app", &token).is_err());
        inner.grants.remove("ordinary");
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        assert_eq!(inner.app_grants["ordinary"].token, token);
        inner.active.get_mut("ordinary").unwrap().app_allowed = true;
        assert!(request_grant(&inner, "app", &token).is_ok());
        inner.active.remove("ordinary");
        assert!(request_grant(&inner, "app", &token).is_err());
    }
    #[cfg(not(windows))]
    #[test]
    fn comparison_keys_preserve_posix_case() {
        assert_eq!(comparison_path(Path::new("/tmp/Foo")), "/tmp/Foo");
        assert_ne!(
            comparison_path(Path::new("/tmp/Foo")),
            comparison_path(Path::new("/tmp/foo"))
        );
    }

    #[test]
    fn workers_get_distinct_private_scratch_and_matching_temp_environment() {
        let first = create_worker_scratch().unwrap();
        let second = create_worker_scratch().unwrap();
        assert_ne!(first, second);
        assert!(first.is_absolute());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        let mut cmd = Command::new("unused");
        configure_worker_scratch(&mut cmd, &first);
        for key in ["TMPDIR", "TMP", "TEMP"] {
            assert!(cmd
                .get_envs()
                .any(|(name, value)| name == key && value == Some(first.as_os_str())));
        }
        let new_file = first.join("new/helper.py");
        assert_eq!(
            control_write_path(new_file.to_string_lossy().into_owned()).unwrap(),
            new_file.to_string_lossy().replace('\\', "/")
        );
        assert!(control_write_path("relative.py".into()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&second, first.join("escape")).unwrap();
            let resolved = control_write_path(
                first
                    .join("escape/helper.py")
                    .to_string_lossy()
                    .into_owned(),
            )
            .unwrap();
            assert_eq!(resolved, second.join("helper.py").to_string_lossy());
            std::os::unix::fs::symlink(first.join("missing"), first.join("dangling")).unwrap();
            assert!(control_write_path(
                first
                    .join("dangling/helper.py")
                    .to_string_lossy()
                    .into_owned()
            )
            .is_err());
        }
        std::fs::remove_dir_all(first).unwrap();
        std::fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn closing_a_window_releases_ordinary_turns_and_owned_orchestration() {
        let mut inner = Inner::default();
        for (id, window) in [
            ("ordinary", "closing"),
            ("lead", "closing"),
            ("other", "open"),
        ] {
            inner.active.insert(
                id.into(),
                ActiveTurn {
                    window: window.into(),
                    cwd: format!("/{id}"),
                    app_allowed: false,
                },
            );
        }
        for (id, window) in [("lead", "closing"), ("other", "open")] {
            inner.grants.insert(
                id.into(),
                Grant {
                    window: window.into(),
                    session: id.into(),
                    cwd: format!("/{id}"),
                    token: id.into(),
                },
            );
        }
        inner.workers.insert("worker".into(), "lead".into());
        inner.workers.insert("other-worker".into(), "other".into());
        let (reply, response) = mpsc::channel();
        inner.pending.insert(
            "pending".into(),
            Pending {
                window: "closing".into(),
                reply,
                authority: None,
            },
        );
        let (reply, other_response) = mpsc::channel();
        inner.pending.insert(
            "other-pending".into(),
            Pending {
                window: "open".into(),
                reply,
                authority: None,
            },
        );

        assert_eq!(
            inner.close_window("closing"),
            ["lead", "ordinary", "worker"]
        );
        assert_eq!(inner.active.len(), 1);
        assert_eq!(inner.active["other"].window, "open");
        assert_eq!(inner.grants.len(), 1);
        assert!(inner.grants.contains_key("other"));
        assert_eq!(inner.workers.len(), 1);
        assert_eq!(inner.workers["other-worker"], "other");
        assert_eq!(response.try_recv().unwrap()["ok"], false);
        assert!(other_response.try_recv().is_err());
        assert!(inner.pending.contains_key("other-pending"));
        assert!(inner.close_window("closing").is_empty());
    }

    #[test]
    fn scopes_reject_escape_and_resolve_new_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        assert!(resolve_scope(&root, "../escape").is_err());
        assert!(resolve_scope(&root, "/absolute").is_err());
        assert!(control_scopes(
            root.to_string_lossy().into_owned(),
            vec!["../escape".into()]
        )
        .unwrap_err()
        .contains("Invalid write scope \"../escape\""));
        assert!(resolve_scope(&root, "src/new.ts")
            .unwrap()
            .ends_with("/src/new.ts"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
            assert!(resolve_scope(&root, "outside/file").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn checkout_reservations_include_nested_folders() {
        assert!(paths_overlap("/repo", "/repo/src"));
        assert!(paths_overlap("/repo/src", "/repo"));
        assert!(!paths_overlap("/repo", "/repo2"));
    }
}
