//! Authenticated loopback transport. App windows own execution; callers never
//! receive arbitrary Tauri command access or direct database write access.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub(crate) mod owner_approval;
#[path = "control_receipts.rs"]
pub(crate) mod receipts;
mod scratch;
#[path = "control_writes.rs"]
pub(crate) mod writes;
pub use receipts::ControlTurnReceipt;
use receipts::WindowIssuer;
#[path = "workspace_effect_receipts.rs"]
pub(crate) mod workspace_effect_receipts;

/// Private source capture. This is not a public completion/retirement proof.
pub(crate) struct ChildControlTurn {
    receipt: ControlTurnReceipt,
    issuer: Arc<WindowIssuer>,
    window: String,
    cwd: String,
    output: Mutex<Option<Arc<crate::native_provider_output::NativeOutputStream>>>,
}

impl ChildControlTurn {
    pub(crate) fn bind_output(
        &self,
        output: Arc<crate::native_provider_output::NativeOutputStream>,
    ) -> Result<(), String> {
        if output.target() != self.receipt.session_id {
            return Err("NATIVE_CONTROL_SOURCE_TARGET_CHANGED".into());
        }
        let mut original = self
            .output
            .lock()
            .map_err(|_| "NATIVE_CONTROL_SOURCE_UNAVAILABLE")?;
        if original.is_some() {
            return Err("NATIVE_CONTROL_SOURCE_ALREADY_BOUND".into());
        }
        *original = Some(output);
        Ok(())
    }
}

const APP_TURN_INACTIVE: &str = "bycoda app access is inactive. Use /operator once in this thread to enable it, then call the CLI during an active agent turn. Retrying this request now will not enable access.";
static ASSISTANT_VISIBILITY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Grant {
    window: String,
    session: String,
    cwd: String,
    token: String,
    generation: String,
    issuer: Option<Arc<WindowIssuer>>,
}
struct Pending {
    window: String,
    reply: mpsc::Sender<Value>,
    authority: Option<DesktopAuthority>,
    assistant_source: Option<(String, String, Arc<WindowIssuer>)>,
    window_issuer: Option<Arc<WindowIssuer>>,
    effect_started: bool,
}
#[derive(Clone)]
pub(crate) struct DesktopAuthority {
    pub relay_id: String,
    pub action: String,
    pub deadline: u64,
    pub issuer: Arc<crate::remote::NativeServiceChannel>,
    pub workspace_owner: Option<(String, String, String)>,
    pub workspace_admitted: bool,
}
impl std::fmt::Debug for DesktopAuthority {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DesktopAuthority")
            .field("relay_id", &self.relay_id)
            .field("action", &self.action)
            .field("deadline", &self.deadline)
            .finish_non_exhaustive()
    }
}
impl PartialEq for DesktopAuthority {
    fn eq(&self, other: &Self) -> bool {
        self.relay_id == other.relay_id
            && self.action == other.action
            && self.deadline == other.deadline
            && self.workspace_owner == other.workspace_owner
            && self.workspace_admitted == other.workspace_admitted
            && Arc::ptr_eq(&self.issuer, &other.issuer)
    }
}
impl Eq for DesktopAuthority {}
pub(crate) fn desktop_effect_action(action: &str) -> bool {
    matches!(
        action,
        "ssh.workspace.approve"
            | "workspace.projects.select"
            | "workspace.sessions.create"
            | "workspace.sessions.open"
            | "workspace.sessions.submit"
            | "workspace.sessions.submit.status"
            | "workspace.sessions.stop"
            | "ui.tools.open"
            | "ui.tools.status"
            | "voice.generation.retire"
            | "voice.generation.status"
            | "voice.generation.source"
            | "inbox.room.scope"
            | "preferences.patch"
            | "providerManagement.patch"
            | "providerManagement.quotaRefresh"
            | "organization.patch"
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
    receipt: ControlTurnReceipt,
    issuer: Arc<WindowIssuer>,
    processes: Vec<Arc<ChildControlTurn>>,
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
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssistantSourceRole {
    Interactive,
    Background,
}
struct AssistantWindow {
    window: String,
    environment: String,
    thread: String,
    seen: std::time::Instant,
    issuer: Arc<WindowIssuer>,
    sequence: u64,
    active: bool,
    role: AssistantSourceRole,
}
fn assistant_source_update_allowed(
    previous: Option<&AssistantWindow>,
    issuer: &Arc<WindowIssuer>,
    sequence: u64,
) -> bool {
    sequence > 0
        && !previous.is_some_and(|source| {
            Arc::ptr_eq(&source.issuer, issuer) && source.sequence >= sequence
        })
}
fn assistant_source_window(
    host: &Inner,
    thread: &str,
    environment: &str,
) -> Result<String, String> {
    let live = |source: &&AssistantWindow| {
        source.active
            && source.thread == thread
            && source.environment == environment
            && source.seen.elapsed() < Duration::from_secs(45)
            && source.issuer.is_live()
    };
    let mut interactive = host
        .assistant_sources
        .values()
        .filter(live)
        .filter(|source| source.role == AssistantSourceRole::Interactive);
    if let Some(source) = interactive.next() {
        if interactive.next().is_some() {
            return Err("Assistant Room is open in multiple desktop windows".into());
        }
        return Ok(source.window.clone());
    }
    let mut background = host
        .assistant_sources
        .values()
        .filter(live)
        .filter(|source| source.role == AssistantSourceRole::Background && source.window == "main");
    let source = background
        .next()
        .ok_or("Open the Assistant Room on this Host")?;
    if background.next().is_some() {
        return Err("Assistant Room background source is ambiguous".into());
    }
    Ok(source.window.clone())
}
pub(crate) fn validate_assistant_source(
    app: &AppHandle,
    thread: &str,
    environment: &str,
) -> Result<(String, Arc<WindowIssuer>), String> {
    let state = app.state::<ControlHost>();
    let host = state
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    let window = assistant_source_window(&host, thread, environment)?;
    let key = format!("{}\0{}\0{}", window, environment, thread);
    let issuer = host
        .assistant_sources
        .get(&key)
        .ok_or("Assistant Room source unavailable")?
        .issuer
        .clone();
    Ok((window, issuer))
}
fn retirement_source_current(
    host: &Inner,
    window: &str,
    thread: &str,
    environment: &str,
    issuer: &Arc<WindowIssuer>,
) -> bool {
    if !issuer.is_live() {
        return false;
    }
    !host.assistant_sources.values().any(|source| {
        source.active
            && source.thread == thread
            && source.environment == environment
            && source.seen.elapsed() < Duration::from_secs(45)
            && source.issuer.is_live()
            && source.role == AssistantSourceRole::Interactive
            && (source.window != window || !Arc::ptr_eq(&source.issuer, issuer))
    })
}
/// Retirement itself can unregister its Room source. Physical window identity
/// remains mandatory, and any replacement Room owner invalidates the proof.
pub(crate) fn validate_retirement_source(
    app: &AppHandle,
    window: &str,
    thread: &str,
    environment: &str,
    issuer: &Arc<WindowIssuer>,
) -> Result<(), String> {
    let webview = app
        .get_webview_window(window)
        .ok_or("Voice Room window unavailable")?;
    let current = receipts::existing(&webview)?;
    if !Arc::ptr_eq(issuer, &current) || !issuer.is_live() {
        return Err("Voice Room window issuer changed".into());
    }
    let state = app.state::<ControlHost>();
    let host = state
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if !retirement_source_current(&host, window, thread, environment, issuer) {
        return Err("Voice Room source changed".into());
    }
    Ok(())
}
#[derive(Default)]
struct Inner {
    grants: HashMap<String, Grant>,
    app_grants: HashMap<String, Grant>,
    pending: HashMap<String, Pending>,
    workers: HashMap<String, String>,
    scratch: HashMap<String, Arc<scratch::Scratch>>,
    active: HashMap<String, ActiveTurn>,
    /// Original turn work, including superseded/pending/unknown originals.
    turn_writes: writes::TurnLedger,
    history_sources: HashMap<String, HistoryWindow>,
    assistant_sources: HashMap<String, AssistantWindow>,
}
impl Inner {
    fn install_authorized_turn(
        &mut self,
        window: &str,
        issuer: &Arc<WindowIssuer>,
        session_id: String,
        cwd: String,
        app_access: bool,
    ) -> Result<ControlTurnReceipt, String> {
        // Reserve before replacing A or changing any grant. Unknown originals
        // cannot make room; only verified byte/authority-end records can.
        self.turn_writes.close_abandoned(window, issuer);
        self.turn_writes.capacity()?;
        let receipt = ControlTurnReceipt::issue(session_id.clone());
        let work =
            writes::TurnWork::new(receipt.clone(), issuer.clone(), window.into(), cwd.clone());
        if let Some(previous) = self
            .active
            .get(&session_id)
            .and_then(|turn| self.turn_writes.find(&turn.receipt))
        {
            previous.writes.close();
        }
        self.turn_writes.insert(work);
        let eligible = self.prepare_app_grant(&session_id, window, &cwd);
        self.active.insert(
            session_id,
            ActiveTurn {
                window: window.into(),
                cwd,
                app_allowed: app_access && eligible,
                receipt: receipt.clone(),
                issuer: issuer.clone(),
                processes: Vec::new(),
            },
        );
        Ok(receipt)
    }
    fn capture_child_source(
        &mut self,
        issuer: &Arc<WindowIssuer>,
        label: &str,
        target: &str,
        cwd: String,
        receipt: ControlTurnReceipt,
    ) -> Result<Arc<ChildControlTurn>, String> {
        if receipt.session_id != target {
            return Err("NATIVE_CONTROL_TURN_TARGET_CHANGED".into());
        }
        self.check_turn(label, issuer, &receipt)?;
        let active = self.active.get_mut(&receipt.session_id).unwrap();
        if active.cwd != cwd {
            log::info!("process cwd differs; using authorized turn cwd");
        }
        if active.processes.len() >= 512 {
            return Err("NATIVE_CONTROL_SOURCE_CAPACITY".into());
        }
        let captured = Arc::new(ChildControlTurn {
            receipt,
            issuer: issuer.clone(),
            window: label.into(),
            cwd: active.cwd.clone(),
            output: Mutex::new(None),
        });
        active.processes.push(captured.clone());
        Ok(captured)
    }

    fn with_child_source<T>(
        &self,
        turn: &ChildControlTurn,
        spawn: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.check_turn(&turn.window, &turn.issuer, &turn.receipt)?;
        if self.active[&turn.receipt.session_id].cwd != turn.cwd {
            log::info!("process cwd differs; using authorized turn cwd");
        }
        spawn()
    }
    fn check_turn(
        &self,
        window: &str,
        issuer: &Arc<WindowIssuer>,
        receipt: &ControlTurnReceipt,
    ) -> Result<(), String> {
        receipt.validate()?;
        let active = self
            .active
            .get(&receipt.session_id)
            .ok_or("NATIVE_CONTROL_TURN_STALE")?;
        if active.receipt != *receipt
            || active.window != window
            || !Arc::ptr_eq(&active.issuer, issuer)
        {
            return Err("NATIVE_CONTROL_TURN_STALE".into());
        }
        Ok(())
    }
    fn capture_write_turn(
        &mut self,
        window: &str,
        issuer: &Arc<WindowIssuer>,
        target: &str,
        cwd: &str,
        receipt: &ControlTurnReceipt,
    ) -> Result<Arc<writes::TurnWork>, String> {
        self.check_turn(window, issuer, receipt)?;
        if receipt.session_id != target {
            return Err("NATIVE_CONTROL_TURN_SOURCE_CHANGED".into());
        }
        let work = self
            .turn_writes
            .find(receipt)
            .ok_or("NATIVE_CONTROL_TURN_SOURCE_MISSING")?;
        if work.cwd != cwd {
            log::info!("process cwd differs; using authorized turn cwd");
        }
        if !work.matches(window, issuer, receipt) {
            return Err("NATIVE_CONTROL_TURN_SOURCE_CHANGED".into());
        }
        Ok(work)
    }

    fn begin_finish_turn(
        &mut self,
        window: &str,
        issuer: &Arc<WindowIssuer>,
        receipt: &ControlTurnReceipt,
    ) -> Result<Arc<writes::TurnWork>, String> {
        receipt.validate()?;
        let work = self
            .turn_writes
            .find(receipt)
            .ok_or("NATIVE_CONTROL_TURN_STALE")?;
        if !work.matches(window, issuer, receipt) {
            return Err("NATIVE_CONTROL_TURN_STALE".into());
        }
        // Permission ends before waiting. A late exact A finish never removes B.
        work.writes.close();
        if self
            .active
            .get(&receipt.session_id)
            .is_some_and(|turn| turn.receipt == *receipt)
        {
            self.active.remove(&receipt.session_id);
        }
        Ok(work)
    }

    #[cfg(test)]
    fn finish_turn(
        &mut self,
        window: &str,
        issuer: &Arc<WindowIssuer>,
        receipt: &ControlTurnReceipt,
    ) -> Result<(), String> {
        let work = self.begin_finish_turn(window, issuer, receipt)?;
        work.writes.drain()?;
        work.complete()
    }
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
                generation: uuid::Uuid::new_v4().to_string(),
                issuer: None,
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
        // Original strict work remains retained even after window closure. A
        // label cleanup supplies neither byte completion nor physical proof.
        self.turn_writes.close_window(label);
        self.history_sources.remove(label);
        self.assistant_sources
            .retain(|_, source| source.window != label);
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
            || !host.active.get(&grant.session).is_some_and(|turn| {
                turn.window == grant.window && turn.app_allowed && turn.issuer.is_live()
            }))
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
        if !host.active.get(&grant.session).is_some_and(|turn| {
            turn.window == grant.window && turn.cwd == grant.cwd && turn.issuer.is_live()
        }) || host.grants.contains_key(&grant.session)
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
                    assistant_source: None,
                    window_issuer: None,
                    effect_started: false,
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
    if !active.issuer.is_live() {
        return Err("The conversation's original desktop window is closed".into());
    }
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
/// Off the main thread: it waits on the connection store lock every heartbeat.
#[tauri::command(async)]
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

/// Advertise the open Room thread for its local Host. This does not grant access.
/// Privacy transitions use the authenticated local native channel, never a
/// renderer-selected Host or bearer credential. A failed response is unknown.
#[tauri::command(async)]
pub fn control_assistant_visibility(
    app: AppHandle,
    window: WebviewWindow,
    action: String,
    epoch: Option<u64>,
) -> Result<u64, String> {
    let issuer = receipts::capture(&window)?;
    issuer.with_live(|| Ok(()))?;
    let (method, params) = match action.as_str() {
        "epoch" if epoch.is_none() => ("assistant.visibility.epoch", json!({})),
        "revoke" if epoch.is_none() => ("assistant.visibility.revoke", json!({})),
        _ => return Err("Invalid Room visibility operation".into()),
    };
    let channel = crate::remote::NativeServiceChannel::connect(&app)?;
    let result = channel.project(method, params, |value| {
        value
            .get("epoch")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Invalid Room visibility response".into())
    })?;
    issuer.with_live(|| Ok(result))
}

/// Advertise the open Room thread for its local Host. This does not grant access.
#[tauri::command(async)]
pub fn control_assistant_source(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    thread_id: String,
    environment_id: String,
    active: bool,
    sequence: u64,
) -> Result<(), String> {
    control_assistant_source_v2(
        app,
        window,
        host,
        thread_id,
        environment_id,
        active,
        sequence,
        AssistantSourceRole::Interactive,
    )
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Tauri command arguments are the frontend IPC contract.
pub fn control_assistant_source_v2(
    app: AppHandle,
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    thread_id: String,
    environment_id: String,
    active: bool,
    sequence: u64,
    role: AssistantSourceRole,
) -> Result<(), String> {
    let issuer = receipts::capture(&window)?;
    if role == AssistantSourceRole::Background && window.label() != "main" {
        return Err("Background Room source requires the primary window".into());
    }
    let local_environment = if active {
        Some(crate::remote::local_conversation_environment(&app)?)
    } else {
        None
    };
    issuer.with_live(|| {
        let mut inner = host
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        let key = format!("{}\0{}\0{}", window.label(), environment_id, thread_id);
        if !assistant_source_update_allowed(inner.assistant_sources.get(&key), &issuer, sequence) {
            return Err("Stale assistant Room source update".into());
        }
        if !inner.assistant_sources.contains_key(&key) && inner.assistant_sources.len() >= 1024 {
            return Err("Assistant Room source capacity reached".into());
        }
        let thread = thread_id;
        let environment = environment_id;
        if thread.is_empty()
            || thread.len() > 200
            || thread.contains('\0')
            || environment.is_empty()
            || environment.len() > 200
            || environment.contains('\0')
            || (active && Some(&environment) != local_environment.as_ref())
        {
            return Err("Invalid assistant Room source".into());
        }
        inner.assistant_sources.insert(
            key,
            AssistantWindow {
                window: window.label().into(),
                environment,
                thread,
                seen: std::time::Instant::now(),
                issuer: issuer.clone(),
                sequence,
                active,
                role,
            },
        );
        Ok(())
    })
}

/// Read-only Room dispatch. Its exact Host request and Room window stay pinned.
#[allow(clippy::too_many_arguments)] // The pinned Host request and Room window are passed as explicit fields so each stays visible at the call site.
pub(crate) fn assistant_ui_request_pinned(
    app: &AppHandle,
    thread: &str,
    environment: &str,
    action: &str,
    input: Value,
    project_id: Option<&str>,
    target_cwd: Option<&str>,
    relay_id: &str,
    deadline: u64,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
    source: &crate::remote::NativeServiceReply,
) -> Result<Value, String> {
    if !matches!(
        action,
        "preferences.read"
            | "preferences.templateRead"
            | "preferences.patch"
            | "preferences.status"
            | "providerManagement.read"
            | "providerManagement.patch"
            | "providerManagement.status"
            | "providerManagement.quotaRefresh"
            | "organization.read"
            | "organization.patch"
            | "organization.status"
            | "workspace.projects.select"
            | "workspace.sessions.create"
            | "workspace.sessions.open"
            | "workspace.sessions.submit"
            | "workspace.sessions.submit.status"
            | "workspace.sessions.stop"
            | "voice.generation.retire"
            | "voice.generation.status"
            | "voice.generation.source"
            | "inbox.room.scope"
            | "ui.tools.open"
            | "ui.tools.status"
    ) || !input.is_object()
        || thread.is_empty()
        || thread.len() > 200
        || issuer.environment_id() != environment
        || !issuer.is_current()
    {
        return Err("Invalid Assistant Room request".into());
    }
    if action == "ui.tools.open"
        && (input["tab"] != "browser"
            || input["projectHost"] != true
            || input.as_object().is_none_or(|fields| {
                fields
                    .keys()
                    .any(|key| !["tab", "projectHost", "placement"].contains(&key.as_str()))
            })
            || input.get("placement").is_some_and(|value| {
                !matches!(value.as_str(), Some("left" | "right" | "top" | "bottom"))
            }))
    {
        return Err("Room can open only its project Host browser".into());
    }
    if action == "ui.tools.status" && input.as_object().is_none_or(|fields| !fields.is_empty()) {
        return Err("Invalid Room browser panel status".into());
    }
    let state = app.state::<ControlHost>();
    let check_authority = || -> Result<(), String> {
        source.check()?;
        if !issuer.is_current() || deadline <= clock_millis()? {
            return Err("Assistant Room request expired".into());
        }
        let allowed = issuer.project(
            "conversation.desktop.authorize",
            json!({"id":relay_id,"action":action}),
            |result| {
                Ok(result.as_object().is_some_and(|value| {
                    value.len() == 1 && value.get("authorized") == Some(&Value::Bool(true))
                }))
            },
        )?;
        if !allowed {
            return Err("Assistant Room authority revoked".into());
        }
        source.check()
    };
    check_authority()?;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    let (window, window_issuer) = {
        let mut host = state
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        let window = assistant_source_window(&host, thread, environment)?;
        let key = format!("{}\0{}\0{}", window, environment, thread);
        let window_issuer = host
            .assistant_sources
            .get(&key)
            .ok_or("Assistant Room source unavailable")?
            .issuer
            .clone();
        if host.pending.len() >= 24 {
            return Err("Too many pending control requests".into());
        }
        let authority = desktop_effect_action(action).then(|| DesktopAuthority {
            relay_id: relay_id.into(),
            action: action.into(),
            deadline,
            issuer: issuer.clone(),
            workspace_owner: None,
            workspace_admitted: false,
        });
        host.pending.insert(
            id.clone(),
            Pending {
                window: window.clone(),
                reply: tx,
                authority,
                window_issuer: Some(window_issuer.clone()),
                assistant_source: Some((thread.into(), environment.into(), window_issuer.clone())),
                effect_started: false,
            },
        );
        (window, window_issuer)
    };
    let check_window = |after_effect: bool| -> Result<(), String> {
        if after_effect && action == "voice.generation.retire" {
            return validate_retirement_source(app, &window, thread, environment, &window_issuer);
        }
        let host = state
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        if assistant_source_window(&host, thread, environment)? != window
            || !host
                .assistant_sources
                .get(&format!("{}\0{}\0{}", window, environment, thread))
                .is_some_and(|entry| Arc::ptr_eq(&entry.issuer, &window_issuer))
        {
            return Err("Assistant Room source changed".into());
        }
        Ok(())
    };
    let qualified = action.starts_with("workspace.")
        || matches!(
            action,
            "ui.tools.open" | "ui.tools.status" | "inbox.room.scope"
        );
    let mut emitted = false;
    let result = (|| {
        check_authority()?;
        check_window(false)?;
        if qualified {
            let permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
            let target = target_cwd.ok_or("A native project target is required")?;
            let webview = app
                .get_webview_window(&window)
                .ok_or("Room window unavailable")?;
            let snapshot = privacy_scope_admission_pinned(app, &webview, &window_issuer)?;
            crate::privacy_projection::scope_projection_metadata(app, &window_issuer, &snapshot)?;
            if !crate::conversation_tools_bridge::privacy_scope_capture::visible_projects_include(
                &snapshot, target,
            ) {
                return Err("Target project is unavailable or private".into());
            }
            check_authority()?;
            check_window(false)?;
            if action.starts_with("workspace.") && action != "workspace.sessions.submit.status" {
                workspace_effect_receipts::begin(
                    app,
                    &id,
                    environment,
                    thread,
                    project_id.ok_or("Workspace project identity required")?,
                    target,
                    action,
                    &input,
                )?;
            }
            crate::conversation_tools_bridge::privacy_scope_capture::retain_effect(&id, permit)?;
        }
        app.emit_to(window.as_str(), "bycoda-control-request", json!({
            "id":id, "namespace":"assistant-ui", "threadId":thread, "environmentId":environment,
            "action":action, "input":input, "projectId": project_id, "targetProjectCwd": target_cwd,
        })).map_err(|_| "Assistant Room window unavailable")?;
        emitted = true;
        let value = rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "Assistant Room request timed out")?;
        check_authority()?;
        check_window(true)?;
        if value["ok"] != true {
            return Err(value["error"]
                .as_str()
                .unwrap_or("Assistant Room action failed")
                .into());
        }
        let mut result = value["result"].clone();
        if action == "organization.read" {
            let sequence = ASSISTANT_VISIBILITY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            if sequence == 0 || sequence >= 9_007_199_254_740_991 {
                return Err("Room visibility sequence exhausted".into());
            }
            let object = result
                .as_object_mut()
                .ok_or("Invalid Room organization snapshot")?;
            object.insert(
                "_roomVisibility".into(),
                json!({ "issuer": window_issuer.identity(), "sequence": sequence }),
            );
        }
        Ok(result)
    })();
    if !qualified || !emitted {
        if let Ok(mut host) = state.inner.lock() {
            host.pending.remove(&id);
        }
        if qualified {
            crate::conversation_tools_bridge::privacy_scope_capture::settle_effect(&id);
        }
    }
    result
}

/// Retain the exact native owner until its UI operation settles. The worker
/// cannot emit the request until Host has durably accepted its signed receipt.
#[allow(clippy::too_many_arguments)] // The native owner tuple is passed as explicit fields so each stays visible at the call site.
pub(crate) fn start_workspace_owner(
    app: &AppHandle,
    thread: &str,
    environment: &str,
    project: &str,
    cwd: &str,
    action: &str,
    input: Value,
    operation_hash: &str,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
) -> Result<String, String> {
    let request = input["requestId"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 300)
        .ok_or("Workspace request identity required")?
        .to_owned();
    let (window, window_issuer) = validate_assistant_source(app, thread, environment)?;
    let view = app
        .get_webview_window(&window)
        .ok_or("Room window unavailable")?;
    let permit = crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let snapshot = privacy_scope_admission_pinned(app, &view, &window_issuer)?;
    crate::privacy_projection::scope_projection_metadata(app, &window_issuer, &snapshot)?;
    if !crate::conversation_tools_bridge::privacy_scope_capture::visible_projects_include(
        &snapshot, cwd,
    ) {
        return Err("Target project is unavailable or private".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, _rx) = mpsc::channel();
    let state = app.state::<ControlHost>();
    {
        let mut host = state
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        if host.pending.len() >= 24
            || assistant_source_window(&host, thread, environment)? != window
        {
            return Err("Room source unavailable".into());
        }
        let source = host
            .assistant_sources
            .get(&format!("{}\0{}\0{}", window, environment, thread))
            .ok_or("Room source unavailable")?;
        if !Arc::ptr_eq(&source.issuer, &window_issuer) {
            return Err("Room source changed".into());
        }
        workspace_effect_receipts::begin(
            app,
            &id,
            environment,
            thread,
            project,
            cwd,
            action,
            &input,
        )?;
        crate::conversation_tools_bridge::privacy_scope_capture::retain_effect(&id, permit)?;
        host.pending.insert(
            id.clone(),
            Pending {
                window: window.clone(),
                reply: tx,
                window_issuer: Some(window_issuer.clone()),
                assistant_source: Some((thread.into(), environment.into(), window_issuer.clone())),
                authority: Some(DesktopAuthority {
                    relay_id: id.clone(),
                    action: action.into(),
                    deadline: clock_millis()?.saturating_add(120_000),
                    issuer: issuer.clone(),
                    workspace_owner: Some((thread.into(), request.clone(), operation_hash.into())),
                    workspace_admitted: false,
                }),
                effect_started: false,
            },
        );
        workspace_effect_receipts::accept_owner(&id)?;
    }
    let worker_app = app.clone();
    let worker_id = id.clone();
    let worker_window = window.clone();
    let worker_thread = thread.to_owned();
    let worker_environment = environment.to_owned();
    let worker_project = project.to_owned();
    let worker_cwd = cwd.to_owned();
    let worker_action = action.to_owned();
    let worker_hash = operation_hash.to_owned();
    let worker_issuer = issuer.clone();
    std::thread::spawn(move || {
        let allowed =
            crate::conversation_tools_bridge::workspace_operation_owner::wait_for_authority(
                || {
                    crate::conversation_tools_bridge::workspace_operation_owner::authorized(
                        &worker_issuer,
                        &worker_thread,
                        &request,
                        &worker_hash,
                    )
                    .unwrap_or(false)
                },
                || std::thread::sleep(Duration::from_millis(100)),
                300,
            );
        let current = validate_assistant_source(&worker_app, &worker_thread, &worker_environment);
        let same_source = current.is_ok_and(|(label, owner)| {
            label == worker_window && Arc::ptr_eq(&owner, &window_issuer)
        });
        if allowed && same_source {
            let state = worker_app.state::<ControlHost>();
            let admitted = state
                .inner
                .lock()
                .ok()
                .and_then(|mut host| {
                    host.pending
                        .get_mut(&worker_id)
                        .and_then(|pending| pending.authority.as_mut())
                        .map(|authority| {
                            authority.workspace_admitted = true;
                        })
                })
                .is_some();
            if admitted && worker_app.emit_to(worker_window.as_str(), "bycoda-control-request", json!({"id":worker_id,"namespace":"assistant-ui","threadId":worker_thread,"environmentId":worker_environment,"action":worker_action,"input":input,"projectId":worker_project,"targetProjectCwd":worker_cwd})).is_ok() { return; }
        }
        if let Ok(mut host) = worker_app.state::<ControlHost>().inner.lock() {
            host.pending.remove(&worker_id);
        }
        workspace_effect_receipts::mark_unknown(&worker_id);
        crate::conversation_tools_bridge::privacy_scope_capture::settle_effect(&worker_id);
    });
    Ok(id)
}

/// Internal read-only privacy projection. Labels and renderer-supplied IDs never
/// replace the exact physical window issuer captured by the native caller.
pub(crate) fn privacy_scope_snapshot_pinned(
    app: &AppHandle,
    window: &WebviewWindow,
    expected: &Arc<WindowIssuer>,
) -> Result<Value, String> {
    privacy_scope_pinned(app, window, expected, "transition")
}

/// Admission refuses a scope while this window has an unconfirmed privacy change.
pub(crate) fn privacy_scope_admission_pinned(
    app: &AppHandle,
    window: &WebviewWindow,
    expected: &Arc<WindowIssuer>,
) -> Result<Value, String> {
    privacy_scope_pinned(app, window, expected, "admission")
}

fn privacy_scope_pinned(
    app: &AppHandle,
    window: &WebviewWindow,
    expected: &Arc<WindowIssuer>,
    purpose: &str,
) -> Result<Value, String> {
    let check = || {
        let current = receipts::capture(window)?;
        if pending_window_issuer_matches(Some(expected), &current) {
            Ok(())
        } else {
            Err("Privacy source window changed".to_string())
        }
    };
    check()?;
    let state = app.state::<ControlHost>();
    let id = uuid::Uuid::new_v4().to_string();
    let (reply, receive) = mpsc::channel();
    expected.with_live(|| {
        let mut host = state
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        if host.pending.len() >= 24 {
            return Err("Too many pending control requests".into());
        }
        host.pending.insert(
            id.clone(),
            Pending {
                window: window.label().to_owned(),
                reply,
                authority: None,
                assistant_source: None,
                window_issuer: Some(expected.clone()),
                effect_started: false,
            },
        );
        Ok(())
    })?;
    let result = (|| {
        check()?;
        app.emit_to(window.label(), "bycoda-control-request", json!({
            "id": id, "namespace": "privacy-scope", "action": "privacy.scope.snapshot", "input": { "purpose": purpose },
        })).map_err(|_| "Privacy source window unavailable")?;
        let response = receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Privacy scope request timed out")?;
        check()?;
        if response["ok"] != true {
            return Err("Privacy scope request was refused".into());
        }
        let snapshot = response["result"].clone();
        if !snapshot.is_object()
            || snapshot["privacyRevision"]
                .as_u64()
                .is_none_or(|revision| revision > 9_007_199_254_740_991)
            || !snapshot["stableStorageKeys"].is_object()
            || snapshot["visibleProjects"]
                .as_array()
                .is_none_or(|projects| projects.len() > 1000)
            || serde_json::to_vec(&snapshot)
                .map_err(|_| "Invalid privacy scope snapshot")?
                .len()
                > 1024 * 1024
        {
            return Err("Invalid privacy scope snapshot".into());
        }
        Ok(snapshot)
    })();
    if let Ok(mut host) = state.inner.lock() {
        host.pending.remove(&id);
    }
    result
}

/// Host-granted UI/project reads retain the actual issuer; no general operator access.
#[allow(clippy::too_many_arguments)]
pub(crate) fn conversation_ui_request_pinned(
    app: &AppHandle,
    session: &str,
    cwd: &str,
    environment: &str,
    action: &str,
    input: Value,
    authority: Option<DesktopAuthority>,
    source: &crate::remote::NativeServiceReply,
) -> Result<Value, String> {
    conversation_ui_request_inner(
        app,
        session,
        cwd,
        environment,
        action,
        input,
        authority,
        source,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn conversation_ui_request_device_pinned(
    app: &AppHandle,
    session: &str,
    cwd: &str,
    environment: &str,
    action: &str,
    input: Value,
    authority: Option<DesktopAuthority>,
    source: &crate::remote::NativeServiceReply,
    target: &crate::remote::NativeDeviceReply,
) -> Result<Value, String> {
    conversation_ui_request_inner(
        app,
        session,
        cwd,
        environment,
        action,
        input,
        authority,
        source,
        Some(target),
    )
}

#[allow(clippy::too_many_arguments)]
fn conversation_ui_request_inner(
    app: &AppHandle,
    session: &str,
    cwd: &str,
    environment: &str,
    action: &str,
    input: Value,
    authority: Option<DesktopAuthority>,
    source: &crate::remote::NativeServiceReply,
    target: Option<&crate::remote::NativeDeviceReply>,
) -> Result<Value, String> {
    if let Some(authority) = authority.as_ref() {
        if authority.action != action
            || !desktop_effect_action(action)
            || uuid::Uuid::parse_str(&authority.relay_id).is_err()
            || authority.deadline <= clock_millis()?
            || authority.issuer.environment_id() != environment
            || !authority.issuer.is_current()
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
    let prepare = || {
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
                assistant_source: None,
                window_issuer: None,
                effect_started: false,
            },
        );
        Ok(window)
    };
    let prepared = match target {
        Some(target) => source.with_device_projection(target, |_| prepare()),
        None => source.project(|_| prepare()),
    };
    let window = match prepared {
        Ok(window) => window,
        Err(error) => {
            if let Ok(mut host) = state.inner.lock() {
                host.pending.remove(&id);
            }
            return Err(error);
        }
    };
    let event = Event {
        id: id.clone(),
        namespace: "conversation-ui".into(),
        session_id: session.into(),
        request_id: id.clone(),
        action: action.into(),
        input,
    };
    let result = (|| {
        match target {
            Some(target) => source.with_device_projection(target, |_| Ok(()))?,
            None => source.check()?,
        }
        if matches!(
            action,
            "ui.tools.open" | "ui.tools.place" | "ui.workspace.open"
        ) {
            if let Some(view) = app.get_webview_window(&window) {
                let _ = view.show();
                let _ = view.unminimize();
            }
        }
        if app
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
        }
    })();
    if let Ok(mut host) = state.inner.lock() {
        host.pending.remove(&id);
    }
    let value = result?;
    let consume = || {
        if value["ok"] != true {
            return Err(value["error"]
                .as_str()
                .unwrap_or("Conversation UI action failed")
                .to_owned());
        }
        Ok(value["result"].clone())
    };
    match target {
        Some(target) => source.with_device_projection(target, |_| consume()),
        None => source.project(|_| consume()),
    }
}

#[tauri::command]
pub async fn control_enable(
    window: WebviewWindow,
    session_id: String,
    cwd: String,
) -> Result<String, String> {
    let app = window.app_handle().clone();
    let issuer = receipts::capture(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<ControlHost>();

    issuer.with_live(|| {
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
            generation: uuid::Uuid::new_v4().to_string(),
            issuer: Some(issuer.clone()),
        },
    );
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(executable.to_string_lossy().into_owned())
    })

    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn control_grant_capture(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
) -> Result<String, String> {
    let issuer = receipts::capture(&window)?;
    issuer.with_live(|| {
        let inner = host
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        let grant = inner
            .grants
            .get(&session_id)
            .ok_or("Original orchestration grant unavailable")?;
        if grant.window != window.label()
            || !grant
                .issuer
                .as_ref()
                .is_some_and(|original| Arc::ptr_eq(original, &issuer))
        {
            return Err("Original orchestration grant unavailable".into());
        }
        Ok(grant.generation.clone())
    })
}

#[tauri::command]
pub fn control_disable_captured(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    generation: String,
) -> Result<(), String> {
    let issuer = receipts::capture(&window)?;
    issuer.with_live(|| {
        let mut inner = host
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        disable_original_grant(
            &mut inner,
            window.label(),
            &issuer,
            &session_id,
            &generation,
        )
    })
}

fn disable_original_grant(
    inner: &mut Inner,
    label: &str,
    issuer: &Arc<WindowIssuer>,
    session_id: &str,
    generation: &str,
) -> Result<(), String> {
    let grant = inner
        .grants
        .get(session_id)
        .ok_or("Original orchestration grant unavailable")?;
    if grant.window != label
        || grant.generation != generation
        || !grant
            .issuer
            .as_ref()
            .is_some_and(|original| Arc::ptr_eq(original, issuer))
    {
        return Err("Original orchestration grant changed".into());
    }
    inner.grants.remove(session_id);
    inner.workers.retain(|_, parent| parent != session_id);
    let workers = inner.workers.clone();
    inner.scratch.retain(|id, _| workers.contains_key(id));
    Ok(())
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
pub async fn control_attach_worker(
    window: tauri::Window,
    lead_id: String,
    session_id: String,
) -> Result<String, String> {
    let app = window.app_handle().clone();
    let admission = crate::native_window_lifecycle::admit_window_buffers(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<ControlHost>();

        admission.finish(control_attach_worker_with(
            &host,
            window.label(),
            lead_id,
            session_id,
            create_worker_scratch,
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn control_attach_worker_with(
    host: &ControlHost,
    owner: &str,
    lead_id: String,
    session_id: String,
    create_scratch: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<String, String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&lead_id)
        .is_none_or(|grant| grant.window != owner)
    {
        return Err("Lead connection is inactive".into());
    }
    let scratch = match inner.scratch.get(&session_id) {
        Some(path) if path.path().is_dir() => path.clone(),
        _ => scratch::Scratch::capture(create_scratch()?)?,
    };
    inner.workers.insert(session_id.clone(), lead_id);
    inner.app_grants.remove(&session_id);
    inner.scratch.insert(session_id, scratch.clone());
    Ok(scratch.path().to_string_lossy().into_owned())
}

fn create_worker_scratch() -> Result<PathBuf, String> {
    create_worker_scratch_in(&std::env::temp_dir())
}

// Only the native operation supplies this root; it is never an IPC path or grant.
fn create_worker_scratch_in(root: &Path) -> Result<PathBuf, String> {
    let path = root.join(format!("bycoda-worker-{}", uuid::Uuid::new_v4()));
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
pub async fn control_authorize_turn(
    window: WebviewWindow,
    session_id: String,
    cwd: String,
    app_access: bool,
) -> Result<ControlTurnReceipt, String> {
    let app = window.app_handle().clone();
    let issuer = receipts::capture(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<ControlHost>();

    if session_id.is_empty() {
        return Err("NATIVE_CONTROL_TURN_INVALID".into());
    }
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    let cwd = comparison_path(&cwd);
    issuer.with_live(|| {
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
    inner.install_authorized_turn(window.label(), &issuer, session_id, cwd, app_access)
    })

    }).await.map_err(|error| error.to_string())?
}

#[tauri::command(async)]
pub fn control_turn_finished(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    receipt: ControlTurnReceipt,
) -> Result<(), String> {
    let issuer = receipts::existing(&window)?;
    finish_original_turn(&host, &issuer, window.label(), &receipt)
}

pub(crate) fn finish_original_turn(
    host: &ControlHost,
    issuer: &Arc<WindowIssuer>,
    window: &str,
    receipt: &ControlTurnReceipt,
) -> Result<(), String> {
    let work = issuer.with_live(|| {
        host.inner
            .lock()
            .map_err(|_| "Control service unavailable".to_string())?
            .begin_finish_turn(window, issuer, receipt)
    })?;
    // No issuer/ControlHost/registry lock is held over actual writer closure.
    // This waits byte IO and its admitted callback tail, never kills a warm P.
    if let Err(error) = work.writes.drain() {
        log::warn!("turn settlement: {error}");
    }
    work.complete()
}

/// Original active authorization captured under the actual issuer and retained
/// through an operation. The callback must not wait or acquire an issuer lock.
pub(crate) fn with_write_turn<T>(
    host: &ControlHost,
    issuer: &Arc<WindowIssuer>,
    window: &str,
    target: &str,
    cwd: &str,
    receipt: &ControlTurnReceipt,
    action: impl FnOnce(Arc<writes::TurnWork>) -> Result<T, String>,
) -> Result<T, String> {
    issuer.with_live(|| {
        let mut inner = host
            .inner
            .lock()
            .map_err(|_| "NATIVE_CONTROL_SERVICE_UNAVAILABLE")?;
        let work = inner.capture_write_turn(window, issuer, target, cwd, receipt)?;
        action(work)
    })
}

pub(crate) fn canonical_child_cwd(cwd: &Path) -> Result<String, String> {
    Ok(comparison_path(
        &std::fs::canonicalize(cwd).map_err(|e| e.to_string())?,
    ))
}

pub(crate) fn page_reloaded(app: &AppHandle, issuer: &Arc<WindowIssuer>) {
    let Some(host) = app.try_state::<ControlHost>() else {
        return;
    };
    let mut inner = host.inner.lock().unwrap_or_else(|error| error.into_inner());
    // Close admission, but retain outstanding writes until their real completion.
    // Process ownership stays in HarnessHost; reload is not retirement proof.
    inner.turn_writes.close_issuer(issuer);
    inner
        .active
        .retain(|_, turn| !Arc::ptr_eq(&turn.issuer, issuer));
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
                let _ = crate::harness::kill_current_harness(
                    &handle.state::<crate::harness::HarnessHost>(),
                    id,
                );
            }
        });
    }
    if let Ok(mut inner) = host.inner.lock() {
        inner.close_window(label);
    };
}

pub(crate) fn capture_child_turn(
    app: &AppHandle,
    issuer: &Arc<WindowIssuer>,
    label: &str,
    target: &str,
    cwd: &Path,
    receipt: Option<ControlTurnReceipt>,
) -> Result<Option<Arc<ChildControlTurn>>, String> {
    let Some(receipt) = receipt else {
        return Ok(None);
    };
    if receipt.session_id != target {
        return Err("NATIVE_CONTROL_TURN_TARGET_CHANGED".into());
    }
    let cwd = comparison_path(&std::fs::canonicalize(cwd).map_err(|e| e.to_string())?);
    let host = app
        .try_state::<ControlHost>()
        .ok_or("NATIVE_CONTROL_SERVICE_UNAVAILABLE")?;
    issuer.with_live(|| {
        let mut inner = host
            .inner
            .lock()
            .map_err(|_| "NATIVE_CONTROL_SERVICE_UNAVAILABLE")?;
        inner
            .capture_child_source(issuer, label, target, cwd, receipt)
            .map(Some)
    })
}

/// Hold the exact turn check through actual process creation. No later current
/// lookup may replace this captured source after command/environment setup.
pub(crate) fn with_child_turn<T>(
    app: &AppHandle,
    turn: Option<&Arc<ChildControlTurn>>,
    spawn: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let Some(turn) = turn else {
        return spawn();
    };
    let host = app
        .try_state::<ControlHost>()
        .ok_or("NATIVE_CONTROL_SERVICE_UNAVAILABLE")?;
    turn.issuer.with_live(|| {
        let inner = host
            .inner
            .lock()
            .map_err(|_| "NATIVE_CONTROL_SERVICE_UNAVAILABLE")?;
        inner.with_child_source(turn, spawn)
    })
}

pub(crate) fn configure_child(
    app: &AppHandle,
    session_id: &str,
    cmd: &mut Command,
    turn: Option<&Arc<ChildControlTurn>>,
) -> Option<scratch::ProcessScratch> {
    cmd.env_remove("BYCODA_CONTROL_ENDPOINT")
        .env_remove("BYCODA_CONTROL_TOKEN")
        .env_remove("BYCODA_APP_ENDPOINT")
        .env_remove("BYCODA_APP_TOKEN");
    let host = app.try_state::<ControlHost>()?;
    let inner = host.inner.lock().ok()?;
    configure_child_grants(&inner, &host.endpoint, session_id, cmd, turn);
    inner
        .scratch
        .get(session_id)
        .cloned()
        .map(scratch::ProcessScratch::new)
}

fn configure_child_grants(
    inner: &Inner,
    endpoint: &str,
    session_id: &str,
    cmd: &mut Command,
    turn: Option<&Arc<ChildControlTurn>>,
) {
    if let Some(grant) = inner.grants.get(session_id) {
        cmd.env("BYCODA_CONTROL_ENDPOINT", endpoint)
            .env("BYCODA_CONTROL_TOKEN", &grant.token);
    }
    // Orchestrator grants above are separately authorized. Ordinary app
    // access is attached only to the caller's exact captured Native turn.
    let app_session = turn.map(|turn| turn.receipt.session_id.as_str());
    if let Some(grant) = app_session.and_then(|id| inner.app_grants.get(id)) {
        cmd.env("BYCODA_APP_ENDPOINT", endpoint)
            .env("BYCODA_APP_TOKEN", &grant.token);
    }
    if let Some(scratch) = inner.scratch.get(session_id) {
        configure_worker_scratch(cmd, scratch.path());
    }
}

#[tauri::command]
pub async fn app_cli_path() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        std::env::current_exe()
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn control_reply(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    response: Value,
) -> Result<(), String> {
    let replying_issuer = receipts::capture(&window)?;
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner.pending.get(&id).is_some_and(|p| {
        p.window == window.label()
            && pending_window_issuer_matches(p.window_issuer.as_ref(), &replying_issuer)
    }) {
        if let Some(pending) = inner.pending.remove(&id) {
            // Errors can represent an uncertain physical effect. Keep its privacy
            // permit held until an explicit owner recovery establishes settlement.
            let action = pending
                .authority
                .as_ref()
                .map(|authority| authority.action.as_str());
            let read_only = matches!(
                action,
                Some(
                    "workspace.sessions.submit.status"
                        | "ui.tools.status"
                        | "voice.generation.status"
                        | "voice.generation.source"
                        | "inbox.room.scope"
                )
            );
            let workspace_effect = action.is_some_and(|value| {
                value.starts_with("workspace.") || value == "organization.patch"
            }) && !read_only;
            let guarded_effect = workspace_effect || action == Some("ui.tools.open");
            let receipt_saved =
                if workspace_effect && response["ok"] == true && pending.effect_started {
                    workspace_effect_receipts::complete(&id, &response).is_ok()
                } else if guarded_effect && !pending.effect_started {
                    false
                } else {
                    !workspace_effect
                };
            if workspace_effect && !receipt_saved {
                workspace_effect_receipts::mark_unknown(&id);
            }
            if workspace_effect_settled(
                read_only,
                guarded_effect,
                pending.effect_started,
                response["ok"] == true,
                receipt_saved,
            ) {
                crate::conversation_tools_bridge::privacy_scope_capture::settle_effect(&id);
            }
            let reply = if response["ok"] == true && !receipt_saved {
                json!({"ok":false,"error":"Room effect receipt outcome is uncertain"})
            } else {
                response
            };
            let _ = pending.reply.send(reply);
        }
    }
    Ok(())
}

fn workspace_effect_settled(
    read_only: bool,
    workspace_effect: bool,
    effect_started: bool,
    ok: bool,
    receipt_saved: bool,
) -> bool {
    read_only || (workspace_effect && !effect_started) || (ok && receipt_saved)
}

fn pending_window_issuer_matches(
    expected: Option<&Arc<WindowIssuer>>,
    current: &Arc<WindowIssuer>,
) -> bool {
    expected.is_none_or(|expected| {
        Arc::ptr_eq(expected, current) && expected.is_live() && current.is_live()
    })
}

pub(crate) fn validate_workspace_privacy_upgrade(
    app: &AppHandle,
    window: &WebviewWindow,
    issuer: &Arc<WindowIssuer>,
    id: &str,
) -> Result<(), String> {
    let state = app.state::<ControlHost>();
    let host = state
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    let pending = host
        .pending
        .get(id)
        .filter(|pending| pending.window == window.label())
        .ok_or("Workspace request is unavailable")?;
    if !pending.window_issuer.as_ref().is_some_and(|expected| {
        Arc::ptr_eq(expected, issuer) && expected.is_live() && issuer.is_live()
    }) {
        return Err("Workspace window issuer changed".into());
    }
    let authority = pending
        .authority
        .as_ref()
        .filter(|authority| {
            authority.workspace_owner.is_some()
                && (authority.action.starts_with("workspace.")
                    || authority.action == "organization.patch")
        })
        .ok_or("Workspace owner is unavailable")?;
    if !authority.workspace_admitted {
        return Err("Workspace owner is not admitted".into());
    }
    let (thread, environment, source) = pending
        .assistant_source
        .as_ref()
        .ok_or("Workspace source unavailable")?;
    if !Arc::ptr_eq(source, issuer)
        || assistant_source_window(&host, thread, environment)? != window.label()
    {
        return Err("Workspace source changed".into());
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
    if let Some((thread, environment, issuer)) = &pending.assistant_source {
        if action == "voice.generation.retire" {
            if !retirement_source_current(inner, window, thread, environment, issuer) {
                return Err("Voice Room source changed".into());
            }
        } else if assistant_source_window(inner, thread, environment)? != window
            || !inner
                .assistant_sources
                .get(&format!("{}\0{}\0{}", window, environment, thread))
                .is_some_and(|source| Arc::ptr_eq(&source.issuer, issuer))
        {
            return Err("Assistant Room source changed".into());
        }
    }
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
    if !authority.workspace_admitted && !authority.issuer.is_current() {
        return Err("Desktop effect issuer changed during authorization".into());
    }
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
    if !authority.workspace_admitted && !authority.issuer.is_current() {
        return Err("Desktop effect issuer changed during authorization".into());
    }
    Ok(true)
}

/// Live pre-effect check. The original upstream ID is retained only in native memory.
#[tauri::command(async)]
pub fn control_desktop_authorize_effect(
    _app: AppHandle,
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    action: String,
) -> Result<bool, String> {
    if matches!(
        action.as_str(),
        "voice.generation.retire"
            | "voice.generation.status"
            | "voice.generation.source"
            | "inbox.room.scope"
    ) || action.starts_with("workspace.")
        || matches!(
            action.as_str(),
            "organization.patch" | "ui.tools.open" | "ui.tools.status"
        )
    {
        let current = receipts::capture(&window)?;
        let inner = host
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        let pending = inner
            .pending
            .get(&id)
            .ok_or("Room effect request unavailable")?;
        if !pending_window_issuer_matches(pending.window_issuer.as_ref(), &current) {
            return Err("Room window issuer changed".into());
        }
    }
    let allowed = authorize_desktop_effect_with(
        &host.inner,
        window.label(),
        &id,
        &action,
        clock_millis,
        |authority| {
            if let Some((thread, request, hash)) = &authority.workspace_owner {
                if authority.workspace_admitted {
                    return Ok(true);
                }
                return crate::conversation_tools_bridge::workspace_operation_owner::authorized(
                    &authority.issuer,
                    thread,
                    request,
                    hash,
                );
            }
            authority
                .issuer
                .project(
                    "conversation.desktop.authorize",
                    json!({"id": authority.relay_id, "action": authority.action}),
                    |result| {
                        Ok(result.as_object().is_some_and(|value| {
                            value.len() == 1 && value.get("authorized") == Some(&Value::Bool(true))
                        }))
                    },
                )
                .map_err(|_| "Desktop effect authorization is unavailable".to_string())
        },
    )?;
    if allowed
        && (action.starts_with("workspace.")
            || matches!(action.as_str(), "organization.patch" | "ui.tools.open"))
    {
        let mut inner = host
            .inner
            .lock()
            .map_err(|_| "Control service unavailable")?;
        pending_desktop_authority(&inner, window.label(), &id, &action, clock_millis()?)?;
        inner
            .pending
            .get_mut(&id)
            .ok_or("Workspace request is no longer pending")?
            .effect_started = true;
    }
    Ok(allowed)
}

#[tauri::command]
pub async fn control_save(
    window: tauri::Window,
    lead_id: String,
    state: String,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    let admission = crate::native_window_lifecycle::admit_window_persistence(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<crate::session_store::SessionStore>();
        admission.finish(control_save_with(&store, &lead_id, &state))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn control_save_with(
    store: &crate::session_store::SessionStore,
    lead_id: &str,
    state: &str,
) -> Result<(), String> {
    if state.len() > 8_000_000 {
        return Err("Orchestration history is too large".into());
    }
    let run: Value = serde_json::from_str(state).map_err(|_| "Invalid run state")?;
    let conn = store.lock_conn()?;
    crate::session_store::save_orchestration(&conn, lead_id, &run).map_err(|e| e.to_string())?;
    drop(conn);
    Ok(())
}

#[tauri::command]
pub async fn control_load(app: AppHandle, lead_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<crate::session_store::SessionStore>();

        use rusqlite::OptionalExtension;
        let result = store
            .lock_conn()?
            .query_row(
                "SELECT state FROM orchestration_runs WHERE lead_id=?1",
                [lead_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string());
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

mod fs_commands;
#[cfg(test)]
use fs_commands::resolve_scope;
use fs_commands::{control_scopes_inner, control_write_path_inner};

#[tauri::command]
pub async fn control_write_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || control_write_path_inner(path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn control_scopes(cwd: String, files: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || control_scopes_inner(cwd, files))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod admission_tests;

#[cfg(test)]
mod tests {
    #[test]
    fn captured_grant_cannot_disable_replacement_or_other_page() {
        use super::*;
        let mut inner = Inner::default();
        let original = Arc::new(WindowIssuer::default());
        let replacement_page = Arc::new(WindowIssuer::default());
        inner.grants.insert(
            "lead".into(),
            Grant {
                window: "main".into(),
                session: "lead".into(),
                cwd: "/repo".into(),
                token: "secret".into(),
                generation: "generation-b".into(),
                issuer: Some(original.clone()),
            },
        );
        assert!(
            disable_original_grant(&mut inner, "main", &original, "lead", "generation-a").is_err()
        );
        assert!(disable_original_grant(
            &mut inner,
            "main",
            &replacement_page,
            "lead",
            "generation-b"
        )
        .is_err());
        assert!(inner.grants.contains_key("lead"));
        disable_original_grant(&mut inner, "main", &original, "lead", "generation-b").unwrap();
        assert!(!inner.grants.contains_key("lead"));
    }
    fn effect_fixture() -> std::sync::Mutex<super::Inner> {
        let mut inner = super::Inner::default();
        let (reply, _) = std::sync::mpsc::channel();
        inner.pending.insert(
            "native-request".into(),
            super::Pending {
                window: "source-window".into(),
                reply,
                assistant_source: None,
                window_issuer: None,
                effect_started: false,
                authority: Some(super::DesktopAuthority {
                    relay_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
                    action: "ssh.workspace.approve".into(),
                    deadline: 200,
                    issuer: crate::remote::NativeServiceChannel::for_test(),
                    workspace_owner: None,
                    workspace_admitted: false,
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
    fn accepted_workspace_authority_stays_bound_to_original_action_and_request() {
        let inner = effect_fixture();
        {
            let mut guard = inner.lock().unwrap();
            let authority = guard
                .pending
                .get_mut("native-request")
                .unwrap()
                .authority
                .as_mut()
                .unwrap();
            authority.action = "workspace.sessions.stop".into();
            authority.workspace_owner = Some(("room".into(), "original".into(), "hash".into()));
            authority.workspace_admitted = true;
        }
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "workspace.sessions.stop",
            || Ok(100),
            |authority| {
                assert!(authority.workspace_admitted);
                assert_eq!(authority.workspace_owner.as_ref().unwrap().1, "original");
                Ok(true)
            }
        )
        .unwrap());
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "workspace.sessions.create",
            || Ok(100),
            |_| panic!("wrong action")
        )
        .is_err());
    }

    #[test]
    fn workspace_preflight_failure_releases_only_before_effect_admission() {
        assert!(super::workspace_effect_settled(
            false, true, false, false, false
        ));
        assert!(!super::workspace_effect_settled(
            false, true, true, false, false
        ));
        assert!(!super::workspace_effect_settled(
            false, true, true, true, false
        ));
        assert!(super::workspace_effect_settled(
            false, true, true, true, true
        ));
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
    fn desktop_effect_authority_refuses_equal_metadata_from_a_replaced_issuer() {
        let inner = effect_fixture();
        assert!(super::authorize_desktop_effect_with(
            &inner,
            "source-window",
            "native-request",
            "ssh.workspace.approve",
            || Ok(100),
            |original| {
                let mut state = inner.lock().unwrap();
                let authority = state
                    .pending
                    .get_mut("native-request")
                    .unwrap()
                    .authority
                    .as_mut()
                    .unwrap();
                assert_eq!(authority.relay_id, original.relay_id);
                authority.issuer = crate::remote::NativeServiceChannel::for_test();
                Ok(true)
            },
        )
        .unwrap_err()
        .contains("authority changed"));
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
    fn pending_voice_retirement_keeps_original_issuer_after_unregister_only() {
        let mut host = Inner::default();
        let issuer = Arc::new(WindowIssuer::default());
        let (reply, _) = std::sync::mpsc::channel();
        host.pending.insert(
            "retire".into(),
            Pending {
                window: "room".into(),
                reply,
                window_issuer: Some(issuer.clone()),
                effect_started: false,
                assistant_source: Some(("thread".into(), "host".into(), issuer.clone())),
                authority: Some(DesktopAuthority {
                    relay_id: "relay".into(),
                    action: "voice.generation.retire".into(),
                    deadline: 200,
                    issuer: crate::remote::NativeServiceChannel::for_test(),
                    workspace_owner: None,
                    workspace_admitted: false,
                }),
            },
        );
        assert!(
            pending_desktop_authority(&host, "room", "retire", "voice.generation.retire", 100)
                .is_ok()
        );
        assert!(
            pending_desktop_authority(&host, "room", "retire", "organization.patch", 100).is_err()
        );
        host.assistant_sources.insert(
            "replacement".into(),
            AssistantWindow {
                window: "room".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: Arc::new(WindowIssuer::default()),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert!(
            pending_desktop_authority(&host, "room", "retire", "voice.generation.retire", 100)
                .is_err()
        );
    }
    #[test]
    fn retirement_allows_source_unregister_but_rejects_replacement_or_dead_window() {
        let mut host = Inner::default();
        let original = Arc::new(WindowIssuer::default());
        host.assistant_sources.insert(
            "room".into(),
            AssistantWindow {
                window: "room".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: original.clone(),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert!(retirement_source_current(
            &host, "room", "thread", "host", &original
        ));
        host.assistant_sources.get_mut("room").unwrap().active = false;
        assert!(retirement_source_current(
            &host, "room", "thread", "host", &original
        ));
        let replacement = Arc::new(WindowIssuer::default());
        host.assistant_sources.insert(
            "replacement".into(),
            AssistantWindow {
                window: "room".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: replacement,
                sequence: 2,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert!(!retirement_source_current(
            &host, "room", "thread", "host", &original
        ));
        host.assistant_sources.remove("replacement");
        tauri::Resource::close(original.clone());
        assert!(!retirement_source_current(
            &host, "room", "thread", "host", &original
        ));
    }
    #[test]
    fn room_interactive_source_wins_only_over_primary_background() {
        let mut host = Inner::default();
        let primary = Arc::new(WindowIssuer::default());
        let secondary = Arc::new(WindowIssuer::default());
        host.assistant_sources.insert(
            "main".into(),
            AssistantWindow {
                window: "main".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: primary.clone(),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Background,
            },
        );
        assert_eq!(
            assistant_source_window(&host, "thread", "host").unwrap(),
            "main"
        );
        host.assistant_sources.insert(
            "secondary".into(),
            AssistantWindow {
                window: "secondary".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: secondary.clone(),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert_eq!(
            assistant_source_window(&host, "thread", "host").unwrap(),
            "secondary"
        );
        host.assistant_sources.insert(
            "third".into(),
            AssistantWindow {
                window: "third".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: Arc::new(WindowIssuer::default()),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert!(assistant_source_window(&host, "thread", "host").is_err());
        host.assistant_sources.remove("third");
        host.assistant_sources.get_mut("secondary").unwrap().active = false;
        assert_eq!(
            assistant_source_window(&host, "thread", "host").unwrap(),
            "main"
        );
        assert!(!assistant_source_update_allowed(
            host.assistant_sources.get("secondary"),
            &secondary,
            1
        ));
        host.assistant_sources.get_mut("main").unwrap().active = false;
        host.assistant_sources.insert(
            "not-primary".into(),
            AssistantWindow {
                window: "not-primary".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: Arc::new(WindowIssuer::default()),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Background,
            },
        );
        assert!(assistant_source_window(&host, "thread", "host").is_err());
    }
    #[test]
    fn assistant_room_source_requires_live_exact_unique_owner() {
        let mut host = Inner::default();
        let issuer = Arc::new(WindowIssuer::default());
        host.assistant_sources.insert(
            "room".into(),
            AssistantWindow {
                window: "room".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: issuer.clone(),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert_eq!(
            assistant_source_window(&host, "thread", "host").unwrap(),
            "room"
        );
        assert!(assistant_source_window(&host, "other", "host").is_err());
        assert!(assistant_source_window(&host, "thread", "other").is_err());
        host.assistant_sources.insert(
            "duplicate".into(),
            AssistantWindow {
                window: "duplicate".into(),
                environment: "host".into(),
                thread: "thread".into(),
                seen: std::time::Instant::now(),
                issuer: Arc::new(WindowIssuer::default()),
                sequence: 1,
                active: true,
                role: AssistantSourceRole::Interactive,
            },
        );
        assert!(assistant_source_window(&host, "thread", "host").is_err());
        host.assistant_sources.remove("duplicate");
        host.assistant_sources.get_mut("room").unwrap().seen =
            std::time::Instant::now() - Duration::from_secs(46);
        assert!(assistant_source_window(&host, "thread", "host").is_err());
        host.assistant_sources.get_mut("room").unwrap().seen = std::time::Instant::now();
        host.assistant_sources.get_mut("room").unwrap().active = false;
        host.assistant_sources.get_mut("room").unwrap().sequence = 2;
        assert!(assistant_source_window(&host, "thread", "host").is_err());
        assert!(!assistant_source_update_allowed(
            host.assistant_sources.get("room"),
            &issuer,
            1
        ));
        assert!(!assistant_source_update_allowed(
            host.assistant_sources.get("room"),
            &issuer,
            2
        ));
        assert!(assistant_source_update_allowed(
            host.assistant_sources.get("room"),
            &issuer,
            3
        ));
        let replacement = Arc::new(WindowIssuer::default());
        assert!(assistant_source_update_allowed(
            host.assistant_sources.get("room"),
            &replacement,
            1
        ));
        assert!(!assistant_source_update_allowed(None, &replacement, 0));
        host.assistant_sources.get_mut("room").unwrap().active = true;
        tauri::Resource::close(issuer);
        assert!(assistant_source_window(&host, "thread", "host").is_err());
        host.close_window("room");
        assert!(host.assistant_sources.is_empty());
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
    fn closed_actual_window_revokes_app_and_conversation_reads_without_retirement_ack() {
        let mut inner = Inner::default();
        let issuer = Arc::new(WindowIssuer::default());
        inner.app_grants.insert(
            "session".into(),
            Grant {
                window: "main".into(),
                session: "session".into(),
                cwd: "/repo".into(),
                token: "token".into(),
                generation: uuid::Uuid::new_v4().to_string(),
                issuer: None,
            },
        );
        inner.active.insert(
            "session".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/repo".into(),
                app_allowed: true,
                receipt: ControlTurnReceipt::issue("session".into()),
                issuer: issuer.clone(),
                processes: Vec::new(),
            },
        );
        // The query may run within original admission without re-locking that
        // same issuer; lock order stays issuer -> ControlHost.
        issuer
            .with_live(|| {
                assert!(request_grant(&inner, "app", "token").is_ok());
                Ok(())
            })
            .unwrap();
        tauri::Resource::close(issuer);
        assert!(request_grant(&inner, "app", "token").is_err());
        assert!(request_grant_for_action(&inner, "app", "token", "sessions.read").is_err());
        assert!(conversation_ui_window(&inner, "session", "/repo", "host").is_err());
        assert!(
            inner.active.contains_key("session"),
            "revocation is not physical/cohort completion"
        );
    }
    #[test]
    fn poisoned_actual_window_admission_cannot_keep_an_application_grant_live() {
        let mut inner = Inner::default();
        let issuer = Arc::new(WindowIssuer::default());
        inner.app_grants.insert(
            "session".into(),
            Grant {
                window: "main".into(),
                session: "session".into(),
                cwd: "/repo".into(),
                token: "token".into(),
                generation: uuid::Uuid::new_v4().to_string(),
                issuer: None,
            },
        );
        inner.active.insert(
            "session".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/repo".into(),
                app_allowed: true,
                receipt: ControlTurnReceipt::issue("session".into()),
                issuer: issuer.clone(),
                processes: Vec::new(),
            },
        );
        let failed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = issuer
                .with_live(|| -> Result<(), String> { panic!("controlled admission failure") });
        }));
        assert!(failed.is_err());
        assert!(request_grant(&inner, "app", "token").is_err());
        assert!(request_grant_for_action(&inner, "app", "token", "sessions.list").is_err());
        assert!(conversation_ui_window(&inner, "session", "/repo", "host").is_err());
        assert!(inner.active.contains_key("session"));
    }
    #[test]
    fn conversation_ui_routes_only_the_active_owning_window_without_operator_access() {
        let mut host = Inner::default();
        host.active.insert(
            "session".into(),
            ActiveTurn {
                window: "own-window".into(),
                cwd: "G:/demo/project".into(),
                app_allowed: false,
                receipt: ControlTurnReceipt::issue("session".into()),
                issuer: Arc::new(WindowIssuer::default()),
                processes: Vec::new(),
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
                generation: uuid::Uuid::new_v4().to_string(),
                issuer: None,
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
                receipt: ControlTurnReceipt::issue("ordinary".into()),
                issuer: Arc::new(WindowIssuer::default()),
                processes: Vec::new(),
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
                receipt: ControlTurnReceipt::issue("ordinary".into()),
                issuer: Arc::new(WindowIssuer::default()),
                processes: Vec::new(),
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
                generation: uuid::Uuid::new_v4().to_string(),
                issuer: None,
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
            control_write_path_inner(new_file.to_string_lossy().into_owned()).unwrap(),
            new_file.to_string_lossy().replace('\\', "/")
        );
        assert!(control_write_path_inner("relative.py".into()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&second, first.join("escape")).unwrap();
            let resolved = control_write_path_inner(
                first
                    .join("escape/helper.py")
                    .to_string_lossy()
                    .into_owned(),
            )
            .unwrap();
            assert_eq!(resolved, second.join("helper.py").to_string_lossy());
            std::os::unix::fs::symlink(first.join("missing"), first.join("dangling")).unwrap();
            assert!(control_write_path_inner(
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
                    receipt: ControlTurnReceipt::issue(id.into()),
                    issuer: Arc::new(WindowIssuer::default()),
                    processes: Vec::new(),
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
                    generation: uuid::Uuid::new_v4().to_string(),
                    issuer: None,
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
                assistant_source: None,
                window_issuer: None,
                effect_started: false,
            },
        );
        let (reply, other_response) = mpsc::channel();
        inner.pending.insert(
            "other-pending".into(),
            Pending {
                window: "open".into(),
                reply,
                authority: None,
                assistant_source: None,
                window_issuer: None,
                effect_started: false,
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
        assert!(control_scopes_inner(
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
