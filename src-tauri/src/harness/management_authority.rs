//! Native-issued grants for the existing allowlisted one-shot management CLI.
//! An opaque grant is bound to its original page and exact executable and argv.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagementCommand {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    binary_provider: Option<String>,
    binary_path: Option<String>,
}
struct Grant { page: String, issuer: Arc<crate::control::receipts::WindowIssuer>, route_id: String, command: ManagementCommand, cleanup_original: Option<Arc<super::LiveChild>> }
fn grants() -> &'static Mutex<HashMap<String, Grant>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, Grant>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagementGrant { token: String, route_id: String }

#[tauri::command]
pub(crate) async fn harness_management_grant(window: tauri::Window, page_token: String, command: ManagementCommand) -> Result<ManagementGrant, String> {
    let captured = super::page_incarnation(&window)?;
    if captured != page_token { return Err("NATIVE_MANAGEMENT_PAGE_STALE".into()); }
    let webview = window.app_handle().get_webview_window(window.label()).ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    super::run_blocking("harness_management_grant", move || {
        if super::page_incarnation(&window)? != captured { return Err("NATIVE_MANAGEMENT_PAGE_STALE".into()); }
        // Existing native exec policy authorizes this bounded management subset.
        // Session deletion is deliberately excluded from a sessionless grant.
        if !super::exec_args_allowed(command.binary_provider.as_deref(), &command.args)
            || (command.binary_provider.as_deref() == Some("grok") && command.args.get(1).is_some_and(|arg| arg == "sessions"))
            || !super::is_resolved_harness_binary(&command.command, command.binary_provider.as_deref(), command.binary_path.as_deref()) {
            return Err("NATIVE_MANAGEMENT_COMMAND_NOT_ALLOWED".into());
        }
        issuer.with_live(|| {
            let mut entries = grants().lock().map_err(|_| "NATIVE_MANAGEMENT_UNAVAILABLE")?;
            entries.retain(|_, grant| grant.issuer.is_live());
            if entries.len() >= 512 { return Err("NATIVE_MANAGEMENT_CAPACITY".into()); }
            let token = uuid::Uuid::new_v4().to_string();
            let route_id = uuid::Uuid::new_v4().to_string();
            entries.insert(token.clone(), Grant { page: captured, issuer: issuer.clone(), route_id: route_id.clone(), command, cleanup_original: None });
            Ok(ManagementGrant { token, route_id })
        })
    }).await
}
#[tauri::command]
pub(crate) fn harness_utility_cleanup_grant(window: tauri::Window, session_id: String, construction_id: String, command: ManagementCommand) -> Result<ManagementGrant, String> {
    let page = super::page_incarnation(&window)?;
    let webview = window.app_handle().get_webview_window(window.label()).ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    let original = window.app_handle().state::<super::HarnessHost>().get_original(&session_id, Some(&construction_id))?;
    if !original.issuer.as_ref().is_some_and(|owner| Arc::ptr_eq(owner, &issuer))
        || (!matches!(original.management_input_policy, Some(InputPolicy::Utility)) && original.native_session_capability.is_none())
        || original.utility_executable.as_deref() != Some(command.command.as_str())
        || command.cwd.as_deref().map(std::path::Path::new) != Some(original.cwd.as_path())
        || command.binary_provider.as_deref() != Some("grok")
        || command.args.len() != 4 || command.args[..3] != ["--no-auto-update", "sessions", "delete"]
        || uuid::Uuid::parse_str(&command.args[3]).is_err()
        || !super::is_resolved_harness_binary(&command.command, Some("grok"), command.binary_path.as_deref()) {
        return Err("NATIVE_UTILITY_CLEANUP_SCOPE_DENIED".into());
    }
    issuer.with_live(|| {
        let mut entries = grants().lock().map_err(|_| "NATIVE_MANAGEMENT_UNAVAILABLE")?;
        entries.retain(|_, grant| grant.issuer.is_live());
        if entries.len() >= 512 { return Err("NATIVE_MANAGEMENT_CAPACITY".into()); }
        let token = uuid::Uuid::new_v4().to_string();
        let route_id = uuid::Uuid::new_v4().to_string();
        entries.insert(token.clone(), Grant { page, issuer: issuer.clone(), route_id: route_id.clone(), command, cleanup_original: Some(original) });
        Ok(ManagementGrant { token, route_id })
    })
}
pub(super) fn consume(window: &tauri::Window, token: &str, route_id: &str, command: &str, args: &[String], cwd: Option<&str>, provider: Option<&str>, binary_path: Option<&str>) -> Result<(), String> {
    let page = super::page_incarnation(window)?;
    let webview = window.app_handle().get_webview_window(window.label()).ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    issuer.with_live(|| {
    let mut entries = grants().lock().map_err(|_| "NATIVE_MANAGEMENT_UNAVAILABLE")?;
    let grant = entries.get(token).ok_or("NATIVE_MANAGEMENT_GRANT_UNKNOWN")?;
    let expected = &grant.command;
    if !Arc::ptr_eq(&issuer, &grant.issuer) || grant.page != page || grant.route_id != route_id || expected.command != command || expected.args != args || expected.cwd.as_deref() != cwd || expected.binary_provider.as_deref() != provider || expected.binary_path.as_deref() != binary_path {
        return Err("NATIVE_MANAGEMENT_GRANT_MISMATCH".into());
    }
    if let Some(original) = &grant.cleanup_original {
        original.process.as_ref().ok_or("NATIVE_UTILITY_PROCESS_REQUIRED")?.retirement().require_verified().map_err(|e| e.to_string())?;
    }
    entries.remove(token);
    Ok(())
    })
}

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagementSpawn {
    purpose: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    account: Option<super::HarnessAccount>,
    binary_provider: Option<String>,
    binary_path: Option<String>,
}
#[derive(Clone, Copy)]
pub(super) enum InputPolicy { Login, Acp, Grok, Codex, Pi, Claude, Utility }
struct SpawnGrant { page: String, issuer: Arc<crate::control::receipts::WindowIssuer>, route_id: String, command: ManagementSpawn, policy: InputPolicy }
fn spawn_grants() -> &'static Mutex<HashMap<String, SpawnGrant>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, SpawnGrant>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn spawn_policy(input: &ManagementSpawn) -> Option<InputPolicy> {
    let args: Vec<&str> = input.args.iter().map(String::as_str).collect();
    if input.purpose == "utility" {
        let forbidden = |arg: &&str| matches!(arg.split('=').next().unwrap_or(""), "--resume" | "--continue" | "--session-id" | "--session" | "-r");
        if args.iter().any(forbidden) { return None; }
        let isolated = match input.binary_provider.as_deref()? {
            "opencode" => args.len() == 3 && args[0] == "serve" && args[1] == "--hostname=127.0.0.1" && args[2].strip_prefix("--port=").and_then(|port| port.parse::<u16>().ok()).is_some_and(|port| port != 0),
            "cursor" => args == ["acp"],
            "antigravity" => args.is_empty() || args == ["--uid="]
                || ((args.len() == 10 || args.len() == 12)
                    && args[..3] == ["--agent", "bycoda-text", "--log-file"]
                    && std::path::Path::new(args[3]).starts_with(std::path::Path::new(&input.cwd))
                    && args[4..10] == ["--print=", "--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]
                    && (args.len() == 10 || (args[10] == "--model" && !args[11].is_empty()))),
            "grok" => args.len() == 10 && args[..6] == ["--no-auto-update", "--permission-mode", "dontAsk", "agent", "--no-leader", "--model"] && args[7..] == ["--reasoning-effort", "low", "stdio"],
            "pi" | "omp" => args.starts_with(&["--mode", "rpc"]) && args.contains(&"--no-session") && args.contains(&"--no-extensions"),
            "claude" => args.contains(&"--no-session-persistence") && args.contains(&"--strict-mcp-config") && args.windows(2).any(|pair| pair[0] == "--mcp-config" && serde_json::from_str::<serde_json::Value>(pair[1]).ok() == Some(serde_json::json!({"mcpServers":{}}))) && args.windows(2).any(|pair| pair[0] == "--settings" && serde_json::from_str::<serde_json::Value>(pair[1]).ok().and_then(|value| value.get("disableAllHooks").and_then(|value| value.as_bool())) == Some(true)),
            "codex" => args.first() == Some(&"app-server") && args.windows(2).any(|pair| pair == ["-c", "features.shell_tool=false"]) && args.windows(2).any(|pair| pair == ["-c", "features.unified_exec=false"]) && args.windows(2).any(|pair| pair == ["-c", "web_search=\"disabled\""]),
            _ => false,
        };
        return isolated.then_some(InputPolicy::Utility);
    }
    if input.purpose != "management" { return None; }
    if input.binary_provider.as_deref() == Some("claude") && args.len() == 14
        && args[..9] == ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--include-partial-messages", "--no-session-persistence", "--strict-mcp-config", "--mcp-config"]
        && serde_json::from_str::<serde_json::Value>(args[9]).ok() == Some(serde_json::json!({"mcpServers":{}}))
        && args[10] == "--settings"
        && serde_json::from_str::<serde_json::Value>(args[11]).ok() == Some(serde_json::json!({"disableAllHooks":true}))
        && args[12] == "--session-id" && uuid::Uuid::parse_str(args[13]).is_ok() {
        return Some(InputPolicy::Claude);
    }
    match (input.binary_provider.as_deref()?, args.as_slice()) {
        ("claude", ["auth", "login"]) | ("codex", ["login"]) | ("cursor", ["login"]) | ("grok", ["login", "--oauth"]) | ("fx", ["login", "vercel"]) => Some(InputPolicy::Login),
        ("cursor" | "hermes", ["acp"]) => Some(InputPolicy::Acp),
        ("antigravity", []) | ("antigravity", ["--uid="]) => Some(InputPolicy::Acp),
        ("grok", ["--no-auto-update", "agent", "--no-leader", "stdio"]) => Some(InputPolicy::Grok),
        ("pi" | "omp", ["--mode", "rpc", "--no-session"]) => Some(InputPolicy::Pi),
        ("codex", ["app-server"]) => Some(InputPolicy::Codex),
        _ => None,
    }
}
#[tauri::command]
pub(crate) async fn harness_management_spawn_grant(window: tauri::Window, page_token: String, command: ManagementSpawn) -> Result<Option<ManagementGrant>, String> {
    let captured = super::page_incarnation(&window)?;
    if captured != page_token { return Err("NATIVE_MANAGEMENT_PAGE_STALE".into()); }
    let webview = window.app_handle().get_webview_window(window.label()).ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    super::run_blocking("harness_management_spawn_grant", move || {
        if super::page_incarnation(&window)? != captured { return Err("NATIVE_MANAGEMENT_PAGE_STALE".into()); }
        let Some(policy) = spawn_policy(&command) else { return Ok(None); };
        if !super::is_resolved_harness_binary(&command.command, command.binary_provider.as_deref(), command.binary_path.as_deref()) { return Err("NATIVE_MANAGEMENT_COMMAND_NOT_ALLOWED".into()); }
        issuer.with_live(|| {
            let mut entries = spawn_grants().lock().map_err(|_| "NATIVE_MANAGEMENT_UNAVAILABLE")?;
            entries.retain(|_, grant| grant.issuer.is_live());
            if entries.len() >= 512 { return Err("NATIVE_MANAGEMENT_CAPACITY".into()); }
            let token = uuid::Uuid::new_v4().to_string();
            let route_id = uuid::Uuid::new_v4().to_string();
            entries.insert(token.clone(), SpawnGrant { page: captured, issuer: issuer.clone(), route_id: route_id.clone(), command, policy });
            Ok(Some(ManagementGrant { token, route_id }))
        })
    }).await
}
pub(super) fn consume_spawn(window: &tauri::Window, token: &str, route_id: &str, actual: ManagementSpawn) -> Result<InputPolicy, String> {
    let page = super::page_incarnation(window)?;
    let webview = window.app_handle().get_webview_window(window.label()).ok_or("NATIVE_CONTROL_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::capture(&webview)?;
    issuer.with_live(|| {
        let mut entries = spawn_grants().lock().map_err(|_| "NATIVE_MANAGEMENT_UNAVAILABLE")?;
        let grant = entries.get(token).ok_or("NATIVE_MANAGEMENT_GRANT_UNKNOWN")?;
        if !Arc::ptr_eq(&issuer, &grant.issuer) || grant.page != page || grant.route_id != route_id || grant.command != actual { return Err("NATIVE_MANAGEMENT_GRANT_MISMATCH".into()); }
        let policy = grant.policy;
        entries.remove(token);
        Ok(policy)
    })
}
pub(super) fn spawn_input_policy(window: &tauri::Window, token: Option<&str>, route: Option<&str>, purpose: Option<&str>, session_id: &str, command: &str, args: &[String], cwd: &str, account: Option<&super::HarnessAccount>, provider: Option<&str>, binary_path: Option<&str>) -> Result<Option<InputPolicy>, String> {
    match (token, route) {
        (Some(token), Some(route)) if route == session_id => consume_spawn(window, token, route, ManagementSpawn { purpose: purpose.ok_or("NATIVE_MANAGEMENT_GRANT_INVALID")?.to_owned(), command: command.into(), args: args.to_vec(), cwd: cwd.into(), account: account.cloned(), binary_provider: provider.map(str::to_owned), binary_path: binary_path.map(str::to_owned) }).map(Some),
        (Some(_), Some(_)) => Err("NATIVE_MANAGEMENT_ROUTE_MISMATCH".into()),
        (None, None) => Ok(None),
        _ => Err("NATIVE_MANAGEMENT_GRANT_INVALID".into()),
    }
}
/// Accept exactly one bounded JSON frame and only methods used by management
/// discovery. Never include the frame in diagnostics: auth material may occur.
pub(super) fn validate_input(policy: InputPolicy, line: &str, cwd: &std::path::Path) -> Result<(), String> {
    if line.len() > 65536 || line.contains('\n') || line.contains('\r') { return Err("NATIVE_MANAGEMENT_FRAME_REJECTED".into()); }
    let value: serde_json::Value = serde_json::from_str(line).map_err(|_| "NATIVE_MANAGEMENT_FRAME_REJECTED")?;
    let object = value.as_object().ok_or("NATIVE_MANAGEMENT_FRAME_REJECTED")?;
    let method = object.get("method").and_then(|v| v.as_str());
    let accepted = match policy {
        InputPolicy::Login => false,
        InputPolicy::Codex => matches!(method, Some("initialize" | "initialized" | "model/list" | "account/read")) || (method.is_none() && object.get("result").is_some_and(|v| v.as_object().is_some_and(|v| v.is_empty())) && object.contains_key("id")),
        InputPolicy::Acp | InputPolicy::Grok => matches!(method, Some("initialize" | "cursor/list_available_models"))
            || (method == Some("session/new") && object.get("params").and_then(|v| v.as_object()).is_some_and(|params| {
                params.keys().all(|key| key == "cwd" || key == "mcpServers")
                    && params.get("cwd").and_then(|v| v.as_str()).is_some_and(|path| std::path::Path::new(path) == cwd)
                    && params.get("mcpServers").and_then(|v| v.as_array()).is_some_and(|servers| servers.is_empty())
            }))
            || (matches!(policy, InputPolicy::Grok) && method == Some("authenticate") && object.get("params").and_then(|v| v.as_object()).is_some_and(|params| {
                params.keys().all(|key| key == "methodId" || key == "_meta")
                    && params.get("methodId").and_then(|v| v.as_str()).is_some_and(|id| !id.is_empty() && id.len() <= 256)
                    && params.get("_meta").and_then(|v| v.get("headless")).and_then(|v| v.as_bool()) == Some(true)
            }))
            || (method.is_none() && object.contains_key("id") && (
                object.get("result").is_some_and(|v| v.as_object().is_some_and(|result| result.is_empty()) || v == &serde_json::json!({"outcome":{"outcome":"cancelled"}}))
                || object.get("error").and_then(|v| v.as_object()).is_some_and(|error| error.get("code").and_then(|v| v.as_i64()) == Some(-32601) && error.get("message").and_then(|v| v.as_str()).is_some_and(|message| message.len() <= 256) && !error.contains_key("data"))
            )),
        InputPolicy::Pi => matches!(object.get("type").and_then(|v| v.as_str()), Some("get_available_models" | "get_commands" | "get_available_commands"))
            || (object.get("type").and_then(|v| v.as_str()) == Some("extension_ui_response") && object.get("cancelled").and_then(|v| v.as_bool()) == Some(true) && object.keys().all(|key| matches!(key.as_str(), "type" | "id" | "cancelled"))),
        InputPolicy::Claude => object.get("type").and_then(|v| v.as_str()) == Some("control_request")
            && object.get("request_id").and_then(|v| v.as_str()).is_some_and(|id| matches!(id, "bycoda_init" | "bycoda_list_models"))
            && object.get("request").and_then(|v| v.as_object()).is_some_and(|request| request.len() == 1 && matches!(request.get("subtype").and_then(|v| v.as_str()), Some("initialize" | "list_models")))
            && object.keys().all(|key| matches!(key.as_str(), "type" | "request_id" | "request")),
        InputPolicy::Utility => {
            let command = method.or_else(|| object.get("type").and_then(|value| value.as_str())).unwrap_or("");
            !matches!(command, "thread/resume" | "thread/fork" | "session/load" | "session/resume" | "session/fork" | "resume" | "fork" | "switch_session")
                && !object.get("request").and_then(|value| value.get("subtype")).and_then(|value| value.as_str()).is_some_and(|value| matches!(value, "resume" | "fork"))
        }
    };
    if accepted { Ok(()) } else { Err("NATIVE_MANAGEMENT_FRAME_REJECTED".into()) }
}
