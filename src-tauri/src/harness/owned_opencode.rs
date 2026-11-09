//! Bycoda-owned OpenCode v2 foreground process. The endpoint is taken only
//! from the original child's stdout; credentials never leave native memory.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;
use zeroize::Zeroizing;

use super::process_lifecycle::{OwnedChild, ProcessOwner, ProcessPin};
use crate::session_store::canonical_store::{
    admit_session_effect, NativeSessionCapability, PageAdmission,
};

struct Reference {
    page: String,
    capability: NativeSessionCapability,
    acquisition_id: String,
    cwd: String,
    binary_path: Option<String>,
}
struct CatalogReference {
    page: String,
    acquisition_id: String,
    cwd: String,
    binary_path: Option<String>,
}
struct UtilityReference {
    page: String,
    cwd: String,
    catalog_reference: String,
    acquisition_id: String,
    session_id: Option<String>,
    creating: bool,
    configuring: usize,
    sending: bool,
    unknown: bool,
    deleted: bool,
}
pub(crate) struct OwnedService {
    pub(super) id: String,
    pub(super) endpoint: String,
    // Kept only for native request authentication; never serialized or logged.
    pub(super) password: Zeroizing<String>,
    pub(super) process: Arc<ProcessOwner>,
    executable: String,
    references: HashMap<String, Reference>,
    released: HashMap<String, Reference>,
    acquisitions: HashMap<String, String>,
    catalog_references: HashMap<String, CatalogReference>,
    catalog_acquisitions: HashMap<String, String>,
    utility_references: HashMap<String, UtilityReference>,
    utility_acquisitions: HashMap<String, String>,
}
fn slot() -> &'static Mutex<Option<OwnedService>> {
    static SERVICE: OnceLock<Mutex<Option<OwnedService>>> = OnceLock::new();
    SERVICE.get_or_init(|| Mutex::new(None))
}
fn pending_retirement() -> &'static Mutex<Option<Arc<ProcessOwner>>> {
    static PENDING: OnceLock<Mutex<Option<Arc<ProcessOwner>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}
fn hold_retiring(process: Arc<ProcessOwner>) -> Result<(), String> {
    // Retain the original physical owner even when a stop request fails or the
    // caller disappears. A new singleton must not overlap an unknown start.
    *pending_retirement()
        .lock()
        .map_err(|_| "OWNED_OPENCODE_RETIREMENT_UNAVAILABLE")? = Some(process.clone());
    process
        .request_stop()
        .map_err(|_| "OWNED_OPENCODE_RETIREMENT_UNCONFIRMED".into())
}
fn retire_unready_child(child: OwnedChild) -> Result<(), String> {
    let process = Arc::new(ProcessOwner::new(child));
    process.activate();
    let waiter = process.clone();
    std::thread::spawn(move || {
        let _ = waiter.wait();
    });
    hold_retiring(process)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceReference {
    service_id: String,
    reference_id: String,
    endpoint: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceHandle {
    service_id: String,
    reference_id: String,
}

/// Native-only captured original for one request or stream. The process pin
/// survives renderer cancellation until the actual native operation finishes.
pub(crate) struct ServiceAccess {
    pub(super) endpoint: String,
    pub(super) password: Zeroizing<String>,
    _process: ProcessPin,
    _admission: Option<PageAdmission>,
    utility: Option<UtilityTicket>,
    pub(super) utility_session: Option<String>,
}
#[derive(Clone, Copy)]
enum UtilityAction {
    Create,
    Configure,
    Send,
    Delete,
}
struct UtilityTicket {
    service_id: String,
    reference_id: String,
    action: UtilityAction,
    complete: bool,
}
impl Drop for UtilityTicket {
    fn drop(&mut self) {
        if self.complete {
            return;
        }
        if let Ok(mut current) = slot().lock() {
            if let Some(reference) = current
                .as_mut()
                .filter(|service| service.id == self.service_id)
                .and_then(|service| service.utility_references.get_mut(&self.reference_id))
            {
                match self.action {
                    UtilityAction::Create => reference.creating = false,
                    UtilityAction::Configure => {
                        reference.configuring = reference.configuring.saturating_sub(1)
                    }
                    UtilityAction::Send => reference.sending = false,
                    UtilityAction::Delete => {}
                }
                reference.unknown = true;
            }
        }
    }
}
impl ServiceAccess {
    pub(super) fn settle_utility(&mut self, status: u16, body: &str) -> Result<(), String> {
        let Some(ticket) = self.utility.as_mut() else {
            return Ok(());
        };
        if !(200..300).contains(&status) {
            return Err("OWNED_OPENCODE_UTILITY_OUTCOME_UNKNOWN".into());
        }
        let mut current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
        let reference = current
            .as_mut()
            .filter(|service| service.id == ticket.service_id)
            .and_then(|service| service.utility_references.get_mut(&ticket.reference_id))
            .ok_or("OWNED_OPENCODE_REFERENCE_STALE")?;
        match ticket.action {
            UtilityAction::Create => {
                let raw: serde_json::Value = serde_json::from_str(body)
                    .map_err(|_| "OWNED_OPENCODE_UTILITY_OUTCOME_UNKNOWN")?;
                let record = raw.get("data").unwrap_or(&raw);
                let id = record
                    .get("id")
                    .and_then(|value| value.as_str())
                    .filter(|id| {
                        !id.is_empty()
                            && id.len() <= 256
                            && id
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                    })
                    .ok_or("OWNED_OPENCODE_UTILITY_OUTCOME_UNKNOWN")?;
                reference.session_id = Some(id.to_owned());
                reference.creating = false;
            }
            UtilityAction::Send => {
                reference.sending = false;
            }
            UtilityAction::Configure => {
                reference.configuring = reference.configuring.saturating_sub(1);
            }
            UtilityAction::Delete => {
                reference.deleted = true;
            }
        }
        ticket.complete = true;
        Ok(())
    }
}
pub(crate) fn capture_service(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    service_id: &str,
    reference_id: &str,
    capability: &NativeSessionCapability,
) -> Result<ServiceAccess, String> {
    let admission = admit_session_effect(app, window, capability.shell_id(), capability)?;
    let page = super::page_incarnation(window)?;
    let current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
    let service = current.as_ref().ok_or("OWNED_OPENCODE_UNAVAILABLE")?;
    let reference = service
        .references
        .get(reference_id)
        .ok_or("OWNED_OPENCODE_REFERENCE_UNKNOWN")?;
    if service.id != service_id || reference.page != page || reference.capability != *capability {
        return Err("OWNED_OPENCODE_REFERENCE_STALE".into());
    }
    let process = service
        .process
        .pin()
        .map_err(|_| "OWNED_OPENCODE_PROCESS_CLOSED")?;
    Ok(ServiceAccess {
        endpoint: service.endpoint.clone(),
        password: service.password.clone(),
        _process: process,
        _admission: Some(admission),
        utility: None,
        utility_session: None,
    })
}
pub(crate) fn capture_endpoint(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    handle: &ServiceHandle,
    capability: &NativeSessionCapability,
    requested: &str,
) -> Result<ServiceAccess, String> {
    let access = capture_service(
        app,
        window,
        &handle.service_id,
        &handle.reference_id,
        capability,
    )?;
    let url = url::Url::parse(requested).map_err(|_| "OWNED_OPENCODE_ENDPOINT_INVALID")?;
    if url.origin().ascii_serialization() != access.endpoint
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("OWNED_OPENCODE_ENDPOINT_MISMATCH".into());
    }
    Ok(access)
}
pub(crate) fn capture_catalog_endpoint(
    window: &tauri::Window,
    handle: &ServiceHandle,
    method: &str,
    requested: &str,
) -> Result<ServiceAccess, String> {
    let page = super::page_incarnation(window)?;
    let url = url::Url::parse(requested).map_err(|_| "OWNED_OPENCODE_ENDPOINT_INVALID")?;
    if method != "GET"
        || !matches!(url.path(), "/api/model" | "/api/provider" | "/api/agent")
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("OWNED_OPENCODE_CATALOG_SCOPE_DENIED".into());
    }
    let current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
    let service = current.as_ref().ok_or("OWNED_OPENCODE_UNAVAILABLE")?;
    let reference = service
        .catalog_references
        .get(&handle.reference_id)
        .ok_or("OWNED_OPENCODE_REFERENCE_UNKNOWN")?;
    if service.id != handle.service_id
        || reference.page != page
        || url.origin().ascii_serialization() != service.endpoint
    {
        return Err("OWNED_OPENCODE_REFERENCE_STALE".into());
    }
    let process = service
        .process
        .pin()
        .map_err(|_| "OWNED_OPENCODE_PROCESS_CLOSED")?;
    Ok(ServiceAccess {
        endpoint: service.endpoint.clone(),
        password: service.password.clone(),
        _process: process,
        _admission: None,
        utility: None,
        utility_session: None,
    })
}
pub(crate) fn capture_utility_endpoint(
    window: &tauri::Window,
    handle: &ServiceHandle,
    method: &str,
    requested: &str,
    body: Option<&str>,
) -> Result<ServiceAccess, String> {
    if body.is_some_and(|raw| raw.len() > 1024 * 1024 + 4096) {
        return Err("OWNED_OPENCODE_UTILITY_SCOPE_DENIED".into());
    }
    let page = super::page_incarnation(window)?;
    let url = url::Url::parse(requested).map_err(|_| "OWNED_OPENCODE_ENDPOINT_INVALID")?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("OWNED_OPENCODE_ENDPOINT_INVALID".into());
    }
    let mut current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
    let service = current.as_mut().ok_or("OWNED_OPENCODE_UNAVAILABLE")?;
    if service.id != handle.service_id || url.origin().ascii_serialization() != service.endpoint {
        return Err("OWNED_OPENCODE_REFERENCE_STALE".into());
    }
    let process = service
        .process
        .pin()
        .map_err(|_| "OWNED_OPENCODE_PROCESS_CLOSED")?;
    let reference = service
        .utility_references
        .get_mut(&handle.reference_id)
        .ok_or("OWNED_OPENCODE_REFERENCE_UNKNOWN")?;
    if reference.page != page || reference.deleted {
        return Err("OWNED_OPENCODE_REFERENCE_STALE".into());
    }
    for (key, value) in url.query_pairs() {
        if !(key == "directory" && value == reference.cwd) && !(key == "resume" && value == "false")
        {
            return Err("OWNED_OPENCODE_UTILITY_SCOPE_DENIED".into());
        }
    }
    let mut action = None;
    let mut event_session = None;
    if method == "POST" && url.path() == "/api/session" {
        if reference.creating || reference.session_id.is_some() || reference.unknown {
            return Err("OWNED_OPENCODE_UTILITY_HELD".into());
        }
        let data: serde_json::Value =
            serde_json::from_str(body.ok_or("OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?)
                .map_err(|_| "OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?;
        let object = data
            .as_object()
            .ok_or("OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?;
        if object
            .keys()
            .any(|key| key != "location" && key != "permissions")
            || object.get("location")
                != Some(&serde_json::json!({"directory":reference.cwd.clone()}))
            || object.get("permissions")
                != Some(&serde_json::json!([{"action":"*","resource":"*","effect":"deny"}]))
        {
            return Err("OWNED_OPENCODE_UTILITY_SCOPE_DENIED".into());
        }
        reference.creating = true;
        action = Some(UtilityAction::Create);
    } else {
        let session = reference
            .session_id
            .as_ref()
            .ok_or("OWNED_OPENCODE_UTILITY_HELD")?;
        let base = format!("/api/session/{session}");
        if method == "GET" && url.path() == "/api/event" {
            event_session = Some(session.clone());
        } else if method == "POST"
            && (url.path() == format!("{base}/model") || url.path() == format!("{base}/agent"))
        {
            if reference.sending || reference.unknown {
                return Err("OWNED_OPENCODE_UTILITY_HELD".into());
            }
            let data: serde_json::Value =
                serde_json::from_str(body.ok_or("OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?)
                    .map_err(|_| "OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?;
            let object = data
                .as_object()
                .ok_or("OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?;
            let valid =
                if url.path().ends_with("/model") {
                    object.len() == 1
                        && object
                            .get("model")
                            .and_then(|value| value.as_object())
                            .is_some_and(|model| {
                                model.keys().all(|key| {
                                    matches!(key.as_str(), "providerID" | "id" | "variant")
                                }) && ["providerID", "id"].iter().all(|key| {
                                    model
                                        .get(*key)
                                        .and_then(|value| value.as_str())
                                        .is_some_and(|value| {
                                            !value.is_empty() && value.len() <= 512
                                        })
                                }) && model.get("variant").is_none_or(|value| {
                                    value.as_str().is_some_and(|value| value.len() <= 512)
                                })
                            })
                } else {
                    object.len() == 1
                        && object
                            .get("agent")
                            .and_then(|value| value.as_str())
                            .is_some_and(|value| !value.is_empty() && value.len() <= 512)
                };
            if !valid {
                return Err("OWNED_OPENCODE_UTILITY_SCOPE_DENIED".into());
            }
            reference.configuring = reference
                .configuring
                .checked_add(1)
                .ok_or("OWNED_OPENCODE_UTILITY_CAPACITY")?;
            action = Some(UtilityAction::Configure);
        } else if method == "POST" && url.path() == format!("{base}/generate") {
            if reference.sending || reference.configuring != 0 || reference.unknown {
                return Err("OWNED_OPENCODE_UTILITY_HELD".into());
            }
            let data: serde_json::Value =
                serde_json::from_str(body.ok_or("OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?)
                    .map_err(|_| "OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?;
            let object = data
                .as_object()
                .ok_or("OWNED_OPENCODE_UTILITY_SCOPE_DENIED")?;
            if object.len() != 1
                || !object
                    .get("prompt")
                    .and_then(|value| value.as_str())
                    .is_some_and(|prompt| prompt.len() <= 1024 * 1024)
            {
                return Err("OWNED_OPENCODE_UTILITY_SCOPE_DENIED".into());
            }
            reference.sending = true;
            action = Some(UtilityAction::Send);
        } else if method == "POST" && url.path() == format!("{base}/interrupt") { /* explicit stop remains available after an unknown send */
        } else if method == "DELETE" && url.path() == base {
            if reference.sending || reference.configuring != 0 || reference.unknown {
                return Err("OWNED_OPENCODE_UTILITY_HELD".into());
            }
            action = Some(UtilityAction::Delete);
        } else if method == "GET" && (url.path() == base || url.path() == format!("{base}/message"))
        {
        } else {
            return Err("OWNED_OPENCODE_UTILITY_SCOPE_DENIED".into());
        }
    }
    let utility = action.map(|action| UtilityTicket {
        service_id: service.id.clone(),
        reference_id: handle.reference_id.clone(),
        action,
        complete: false,
    });
    Ok(ServiceAccess {
        endpoint: service.endpoint.clone(),
        password: service.password.clone(),
        _process: process,
        _admission: None,
        utility,
        utility_session: event_session,
    })
}
pub(crate) fn capture_unscoped_endpoint(
    window: &tauri::Window,
    handle: &ServiceHandle,
    method: &str,
    requested: &str,
    body: Option<&str>,
) -> Result<ServiceAccess, String> {
    let is_utility = {
        let current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
        current.as_ref().is_some_and(|service| {
            service.id == handle.service_id
                && service
                    .utility_references
                    .contains_key(&handle.reference_id)
        })
    };
    if is_utility {
        capture_utility_endpoint(window, handle, method, requested, body)
    } else {
        capture_catalog_endpoint(window, handle, method, requested)
    }
}
impl ServiceAccess {
    pub(crate) fn authorization(&self) -> Zeroizing<String> {
        use base64::Engine;
        let raw = Zeroizing::new(format!("opencode:{}", self.password.as_str()));
        Zeroizing::new(format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
        ))
    }
}

// Read fixed chunks and bound each line. Stdout can include the generated
// password, so neither lines nor raw errors are emitted or retained.
fn observe_stdout<R: Read>(reader: R, ready: mpsc::SyncSender<String>) {
    let mut input = BufReader::new(reader);
    let mut line = Vec::with_capacity(1024);
    let mut sent = false;
    loop {
        let chunk = match input.fill_buf() {
            Ok(chunk) if !chunk.is_empty() => chunk,
            _ => break,
        };
        let take = chunk
            .iter()
            .position(|b| *b == b'\n')
            .map_or(chunk.len(), |n| n + 1);
        if line.len() <= 65536 {
            let available = 65537usize.saturating_sub(line.len());
            line.extend_from_slice(&chunk[..take.min(available)]);
        }
        let end = chunk[take - 1] == b'\n';
        input.consume(take);
        if !end {
            continue;
        }
        if !sent && line.len() <= 65536 {
            let text = String::from_utf8_lossy(&line);
            if let Some(raw) = text.trim().strip_prefix("server listening on ") {
                if let Ok(url) = url::Url::parse(raw.trim()) {
                    if url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port().is_some_and(|port| port != 0)
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.query().is_none()
                        && url.fragment().is_none()
                        && url.path() == "/"
                    {
                        sent = ready.send(url.origin().ascii_serialization()).is_ok();
                    }
                }
            }
        }
        line.clear();
    }
}

fn start_service(
    command: &str,
    cwd: &str,
    window: &tauri::Window,
    captured: &str,
) -> Result<OwnedService, String> {
    let workdir = crate::fs::expand_home(cwd);
    if !workdir.is_dir() {
        return Err("OWNED_OPENCODE_CWD_INVALID".into());
    }
    let password = Zeroizing::new(format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    ));
    let mut command_line = Command::new(command);
    command_line
        .args(["serve", "--hostname=127.0.0.1", "--port=0"])
        .current_dir(workdir)
        .env("OPENCODE_PASSWORD", password.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    super::prepare_child(&mut command_line, command);
    let mut child =
        OwnedChild::spawn(&mut command_line).map_err(|_| "OWNED_OPENCODE_SPAWN_FAILED")?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            retire_unready_child(child)?;
            return Err("OWNED_OPENCODE_STDOUT_UNAVAILABLE".into());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            retire_unready_child(child)?;
            return Err("OWNED_OPENCODE_STDERR_UNAVAILABLE".into());
        }
    };
    let process = Arc::new(ProcessOwner::new(child));
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || observe_stdout(stdout, send));
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut BufReader::new(stderr), &mut std::io::sink());
    });
    process.activate();
    let waiter = process.clone();
    std::thread::spawn(move || {
        let _ = waiter.wait();
    });
    let endpoint = match receive.recv_timeout(Duration::from_secs(30)) {
        Ok(endpoint) => endpoint,
        Err(_) => {
            hold_retiring(process)?;
            return Err("OWNED_OPENCODE_START_UNCONFIRMED".into());
        }
    };
    let _pin = match process.pin() {
        Ok(pin) => pin,
        Err(_) => {
            hold_retiring(process)?;
            return Err("OWNED_OPENCODE_PROCESS_CLOSED".into());
        }
    };
    if super::page_incarnation(window).ok().as_deref() != Some(captured) {
        hold_retiring(process)?;
        return Err("OWNED_OPENCODE_PAGE_STALE".into());
    }
    Ok(OwnedService {
        id: uuid::Uuid::new_v4().to_string(),
        endpoint,
        password,
        process,
        executable: command.to_owned(),
        references: HashMap::new(),
        released: HashMap::new(),
        acquisitions: HashMap::new(),
        catalog_references: HashMap::new(),
        catalog_acquisitions: HashMap::new(),
        utility_references: HashMap::new(),
        utility_acquisitions: HashMap::new(),
    })
}

#[tauri::command]
pub(crate) async fn owned_opencode_catalog_acquire(
    window: tauri::Window,
    command: String,
    binary_path: Option<String>,
    cwd: String,
    page_token: String,
    operation_id: String,
    management_token: String,
    management_route_id: String,
) -> Result<ServiceReference, String> {
    if operation_id.trim().is_empty() || operation_id.len() > 512 {
        return Err("OWNED_OPENCODE_OPERATION_INVALID".into());
    }
    let captured = super::page_incarnation(&window)?;
    if captured != page_token {
        return Err("OWNED_OPENCODE_PAGE_STALE".into());
    }
    super::run_blocking("owned_opencode_catalog_acquire", move || {
        if super::page_incarnation(&window)? != captured {
            return Err("OWNED_OPENCODE_PAGE_STALE".into());
        }
        let mut current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
        if let Some(service) = current.as_ref() {
            if let Some(reference_id) = service.catalog_acquisitions.get(&operation_id) {
                let reference = service
                    .catalog_references
                    .get(reference_id)
                    .ok_or("OWNED_OPENCODE_RECEIPT_INVALID")?;
                if service.executable != command
                    || reference.page != captured
                    || reference.cwd != cwd
                    || reference.binary_path != binary_path
                    || reference.acquisition_id != operation_id
                {
                    return Err("OWNED_OPENCODE_OPERATION_REUSED".into());
                }
                let _pin = service
                    .process
                    .pin()
                    .map_err(|_| "OWNED_OPENCODE_PROCESS_CLOSED")?;
                return Ok(ServiceReference {
                    service_id: service.id.clone(),
                    reference_id: reference_id.clone(),
                    endpoint: service.endpoint.clone(),
                });
            }
        }
        let args = vec!["--version".to_owned()];
        super::management_authority::consume(
            &window,
            &management_token,
            &management_route_id,
            &command,
            &args,
            Some(&cwd),
            Some("opencode"),
            binary_path.as_deref(),
        )?;
        if !super::is_resolved_harness_binary(&command, Some("opencode"), binary_path.as_deref()) {
            return Err("OWNED_OPENCODE_BINARY_INVALID".into());
        }
        {
            let mut pending = pending_retirement()
                .lock()
                .map_err(|_| "OWNED_OPENCODE_RETIREMENT_UNAVAILABLE")?;
            if let Some(original) = pending.as_ref() {
                if original.retirement().require_verified().is_err() {
                    return Err("OWNED_OPENCODE_RETIREMENT_UNCONFIRMED".into());
                }
                *pending = None;
            }
        }
        if current.is_none() {
            *current = Some(start_service(&command, &cwd, &window, &captured)?);
        }
        let service = current.as_mut().ok_or("OWNED_OPENCODE_UNAVAILABLE")?;
        if service.executable != command {
            return Err("OWNED_OPENCODE_BINARY_CHANGED".into());
        }
        let _pin = service
            .process
            .pin()
            .map_err(|_| "OWNED_OPENCODE_PROCESS_CLOSED")?;
        if super::page_incarnation(&window)? != captured {
            return Err("OWNED_OPENCODE_PAGE_STALE".into());
        }
        if service.catalog_references.len() >= 512 {
            return Err("OWNED_OPENCODE_REFERENCE_CAPACITY".into());
        }
        let reference_id = uuid::Uuid::new_v4().to_string();
        service.catalog_references.insert(
            reference_id.clone(),
            CatalogReference {
                page: captured,
                acquisition_id: operation_id.clone(),
                cwd,
                binary_path,
            },
        );
        service
            .catalog_acquisitions
            .insert(operation_id, reference_id.clone());
        Ok(ServiceReference {
            service_id: service.id.clone(),
            reference_id,
            endpoint: service.endpoint.clone(),
        })
    })
    .await
}

/// Issue a separate unscoped utility reference from an already-authorized
/// catalog source. It never inherits or names a conversation session.
#[tauri::command]
pub(crate) async fn owned_opencode_utility_acquire(
    window: tauri::Window,
    handle: ServiceHandle,
    page_token: String,
    operation_id: String,
    management_token: String,
    management_route_id: String,
) -> Result<ServiceReference, String> {
    if operation_id.trim().is_empty() || operation_id.len() > 512 {
        return Err("OWNED_OPENCODE_OPERATION_INVALID".into());
    }
    let captured = super::page_incarnation(&window)?;
    if captured != page_token {
        return Err("OWNED_OPENCODE_PAGE_STALE".into());
    }
    super::run_blocking("owned_opencode_utility_acquire", move || {
        if super::page_incarnation(&window)? != captured {
            return Err("OWNED_OPENCODE_PAGE_STALE".into());
        }
        let mut current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
        let service = current.as_mut().ok_or("OWNED_OPENCODE_UNAVAILABLE")?;
        if service.id != handle.service_id {
            return Err("OWNED_OPENCODE_REFERENCE_STALE".into());
        }
        let source = service
            .catalog_references
            .get(&handle.reference_id)
            .ok_or("OWNED_OPENCODE_REFERENCE_UNKNOWN")?;
        if source.page != captured {
            return Err("OWNED_OPENCODE_REFERENCE_STALE".into());
        }
        if let Some(id) = service.utility_acquisitions.get(&operation_id) {
            let prior = service
                .utility_references
                .get(id)
                .ok_or("OWNED_OPENCODE_RECEIPT_INVALID")?;
            if prior.page != captured
                || prior.cwd != source.cwd
                || prior.catalog_reference != handle.reference_id
                || prior.acquisition_id != operation_id
            {
                return Err("OWNED_OPENCODE_OPERATION_REUSED".into());
            }
            return Ok(ServiceReference {
                service_id: service.id.clone(),
                reference_id: id.clone(),
                endpoint: service.endpoint.clone(),
            });
        }
        let args = vec!["--version".to_owned()];
        super::management_authority::consume(
            &window,
            &management_token,
            &management_route_id,
            &service.executable,
            &args,
            Some(&source.cwd),
            Some("opencode"),
            source.binary_path.as_deref(),
        )?;
        if service.utility_references.len() >= 512 {
            return Err("OWNED_OPENCODE_REFERENCE_CAPACITY".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        service.utility_references.insert(
            id.clone(),
            UtilityReference {
                page: captured,
                cwd: source.cwd.clone(),
                catalog_reference: handle.reference_id.clone(),
                acquisition_id: operation_id.clone(),
                session_id: None,
                creating: false,
                configuring: 0,
                sending: false,
                unknown: false,
                deleted: false,
            },
        );
        service
            .utility_acquisitions
            .insert(operation_id, id.clone());
        Ok(ServiceReference {
            service_id: service.id.clone(),
            reference_id: id,
            endpoint: service.endpoint.clone(),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn owned_opencode_acquire(
    app: tauri::AppHandle,
    window: tauri::Window,
    command: String,
    binary_path: Option<String>,
    cwd: String,
    page_token: String,
    operation_id: String,
    capability: NativeSessionCapability,
) -> Result<ServiceReference, String> {
    if operation_id.trim().is_empty() || operation_id.len() > 512 {
        return Err("OWNED_OPENCODE_OPERATION_INVALID".into());
    }
    let captured = super::page_incarnation(&window)?;
    if captured != page_token {
        return Err("OWNED_OPENCODE_PAGE_STALE".into());
    }
    super::run_blocking("owned_opencode_acquire", move || {
        let parent_gate = super::session_spawn_gate(capability.shell_id());
        let _parent_guard = parent_gate
            .lock()
            .map_err(|_| "OWNED_OPENCODE_GATE_UNAVAILABLE")?;
        let _admission = admit_session_effect(&app, &window, capability.shell_id(), &capability)?;
        if super::page_incarnation(&window)? != captured {
            return Err("OWNED_OPENCODE_PAGE_STALE".into());
        }
        if !super::is_resolved_harness_binary(&command, Some("opencode"), binary_path.as_deref()) {
            return Err("OWNED_OPENCODE_BINARY_INVALID".into());
        }
        let workdir = crate::fs::expand_home(&cwd);
        if !workdir.is_dir() {
            return Err("OWNED_OPENCODE_CWD_INVALID".into());
        }
        let mut current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
        {
            let mut pending = pending_retirement()
                .lock()
                .map_err(|_| "OWNED_OPENCODE_RETIREMENT_UNAVAILABLE")?;
            if let Some(original) = pending.as_ref() {
                if original.retirement().require_verified().is_err() {
                    return Err("OWNED_OPENCODE_RETIREMENT_UNCONFIRMED".into());
                }
                *pending = None;
            }
        }
        if let Some(service) = current.as_mut() {
            if service.executable != command {
                return Err("OWNED_OPENCODE_BINARY_CHANGED".into());
            }
            let _pin = service
                .process
                .pin()
                .map_err(|_| "OWNED_OPENCODE_PROCESS_CLOSED")?;
            if let Some(reference_id) = service.acquisitions.get(&operation_id) {
                let reference = service
                    .references
                    .get(reference_id)
                    .or_else(|| service.released.get(reference_id))
                    .ok_or("OWNED_OPENCODE_RECEIPT_INVALID")?;
                if reference.page != captured
                    || reference.capability != capability
                    || reference.cwd != cwd
                    || reference.binary_path != binary_path
                    || reference.acquisition_id != operation_id
                {
                    return Err("OWNED_OPENCODE_OPERATION_REUSED".into());
                }
                if service.released.contains_key(reference_id) {
                    return Err("OWNED_OPENCODE_REFERENCE_RELEASED".into());
                }
                return Ok(ServiceReference {
                    service_id: service.id.clone(),
                    reference_id: reference_id.clone(),
                    endpoint: service.endpoint.clone(),
                });
            }
            if service
                .references
                .len()
                .saturating_add(service.released.len())
                >= 4096
            {
                return Err("OWNED_OPENCODE_REFERENCE_CAPACITY".into());
            }
            let reference_id = uuid::Uuid::new_v4().to_string();
            service.references.insert(
                reference_id.clone(),
                Reference {
                    page: captured,
                    capability,
                    acquisition_id: operation_id.clone(),
                    cwd,
                    binary_path,
                },
            );
            service
                .acquisitions
                .insert(operation_id, reference_id.clone());
            return Ok(ServiceReference {
                service_id: service.id.clone(),
                reference_id,
                endpoint: service.endpoint.clone(),
            });
        }
        let mut service = start_service(&command, &cwd, &window, &captured)?;
        let service_id = service.id.clone();
        let endpoint = service.endpoint.clone();
        let reference_id = uuid::Uuid::new_v4().to_string();
        let mut references = HashMap::new();
        references.insert(
            reference_id.clone(),
            Reference {
                page: captured,
                capability,
                acquisition_id: operation_id.clone(),
                cwd,
                binary_path,
            },
        );
        let mut acquisitions = HashMap::new();
        acquisitions.insert(operation_id, reference_id.clone());
        service.references = references;
        service.acquisitions = acquisitions;
        *current = Some(service);
        Ok(ServiceReference {
            service_id,
            reference_id,
            endpoint,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn owned_opencode_release(
    app: tauri::AppHandle,
    window: tauri::Window,
    service_id: String,
    reference_id: String,
    page_token: String,
    capability: NativeSessionCapability,
) -> Result<bool, String> {
    let captured = super::page_incarnation(&window)?;
    if captured != page_token {
        return Err("OWNED_OPENCODE_PAGE_STALE".into());
    }
    super::run_blocking("owned_opencode_release", move || {
        let _admission = admit_session_effect(&app, &window, capability.shell_id(), &capability)?;
        let mut current = slot().lock().map_err(|_| "OWNED_OPENCODE_UNAVAILABLE")?;
        let Some(service) = current.as_mut() else {
            return Ok(false);
        };
        if service.id != service_id {
            return Ok(false);
        }
        if service
            .released
            .get(&reference_id)
            .is_some_and(|reference| {
                reference.page == captured && reference.capability == capability
            })
        {
            return Ok(true);
        }
        let matches = service
            .references
            .get(&reference_id)
            .is_some_and(|reference| {
                reference.page == captured && reference.capability == capability
            });
        if matches {
            if let Some(reference) = service.references.remove(&reference_id) {
                service.released.insert(reference_id, reference);
            }
        }
        // No implicit process stop: another Bycoda consumer or a detached HTTP
        // operation may still hold the original service. Only owned-process
        // retirement with an explicit drain proof may stop it later.
        Ok(matches)
    })
    .await
}
