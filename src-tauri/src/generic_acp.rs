//! Host-owned generic ACP configuration. Public lists intentionally omit environment values.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub auth_method_id: Option<String>,
    pub context_window: Option<u64>,
}
static LOCK: Mutex<()> = Mutex::new(());
static CANCELLED: OnceLock<Mutex<BTreeMap<String, bool>>> = OnceLock::new();
fn installs() -> &'static Mutex<BTreeMap<String, bool>> {
    CANCELLED.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("generic-acp"))
        .map_err(|error| error.to_string())
}
fn configs(app: &AppHandle) -> Result<Vec<Config>, String> {
    let path = directory(app)?.join("generic-acp.json");
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(error) => Err(error.to_string()),
    }
}
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
        && value.as_bytes()[0].is_ascii_alphanumeric()
}
fn validate(config: &Config) -> Result<(), String> {
    if !valid_id(&config.id)
        || config.name.trim().is_empty()
        || config.name.len() > 160
        || config.command.trim().is_empty()
        || config.command.len() > 2048
        || config.command.contains(['\0', '\n', '\r'])
        || config.args.len() > 64
        || config
            .args
            .iter()
            .any(|arg| arg.len() > 4096 || arg.contains('\0'))
    {
        return Err("Invalid ACP executable, id or arguments".into());
    }
    if config.env.len() > 64
        || config.env.iter().any(|(key, value)| {
            key.is_empty()
                || !key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                || key.as_bytes()[0].is_ascii_digit()
                || value.len() > 8192
                || value.contains('\0')
        })
    {
        return Err("Invalid ACP environment".into());
    }
    if config
        .context_window
        .is_some_and(|value| !(1024..=10_000_000).contains(&value))
    {
        return Err("Invalid context window".into());
    }
    Ok(())
}
fn persist(app: &AppHandle, values: &[Config]) -> Result<(), String> {
    let dir = directory(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let temp = dir.join("generic-acp.tmp");
    fs::write(
        &temp,
        serde_json::to_vec(values).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    fs::rename(temp, dir.join("generic-acp.json")).map_err(|error| error.to_string())
}
pub fn launch_config(app: &AppHandle, id: &str) -> Result<Config, String> {
    let config = configs(app)?
        .into_iter()
        .find(|config| config.id == id)
        .ok_or("ACP agent is not configured on this machine")?;
    validate(&config)?;
    Ok(config)
}
#[tauri::command(async)]
pub fn generic_acp_list(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(configs(&app)?.into_iter().map(|config| json!({ "id":config.id,"name":config.name,"command":config.command,"args":config.args,"authMethodId":config.auth_method_id,"contextWindow":config.context_window,"envKeys":config.env.keys().collect::<Vec<_>>() })).collect())
}
#[tauri::command(async)]
pub fn generic_acp_save(app: AppHandle, config: Value) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "ACP configuration lock failed")?;
    let preserve_env = config.get("env").is_none();
    let mut value: Config = serde_json::from_value(config).map_err(|error| error.to_string())?;
    validate(&value)?;
    let mut values = configs(&app)?;
    if preserve_env {
        if let Some(old) = values.iter().find(|old| old.id == value.id) {
            value.env = old.env.clone();
        }
    }
    values.retain(|old| old.id != value.id);
    values.push(value);
    persist(&app, &values)
}
#[tauri::command(async)]
pub fn generic_acp_remove(app: AppHandle, id: String) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "ACP configuration lock failed")?;
    let mut values = configs(&app)?;
    values.retain(|config| config.id != id);
    persist(&app, &values)
}
const REGISTRY: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
fn exact_package(package: &str) -> bool {
    let Some((name, version)) = package.rsplit_once('@') else {
        return false;
    };
    fn word(value: &str) -> bool {
        !value.is_empty()
            && value.as_bytes()[0].is_ascii_alphanumeric()
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
            })
    }
    let name_valid = if let Some(scoped) = name.strip_prefix('@') {
        scoped
            .split_once('/')
            .is_some_and(|(scope, name)| word(scope) && word(name))
    } else {
        word(name)
    };
    if name.len() > 200 || !name_valid {
        return false;
    }
    let base = version.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<_> = base.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-+".contains(&byte))
}
#[tauri::command(async)]
pub fn generic_acp_registry(refresh: Option<bool>) -> Result<Vec<Value>, String> {
    let _ = refresh;
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .redirects(0)
        .build()
        .get(REGISTRY)
        .call()
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![];
    response
        .into_reader()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("ACP registry exceeds 1 MiB".into());
    }
    let root: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let agents = root
        .as_array()
        .or_else(|| root.get("agents").and_then(Value::as_array))
        .ok_or("Invalid registry")?;
    if agents.len() > 2000 {
        return Err("Registry has too many agents".into());
    }
    Ok(agents.iter().filter_map(|agent| {
        let id = agent.get("id")?.as_str()?; if !valid_id(id) { return None; }
        let dist = agent.get("distribution").and_then(|value| value.get("npx"));
        let package = dist.and_then(|value| value.get("package")).and_then(Value::as_str);
        let supported = package.is_some_and(exact_package);
        Some(json!({"id":id,"name":agent.get("name"),"version":agent.get("version"),"description":agent.get("description"),"package":if supported {package} else {None},"args":dist.and_then(|value| value.get("args")).cloned().unwrap_or(json!([])),"env":dist.and_then(|value| value.get("env")),"supported":supported,"unsupportedReason":if supported {None} else {Some("This build supports pinned npm distributions; use local command setup for binary or uvx agents.")} }))
    }).collect())
}
#[tauri::command(async)]
pub fn generic_acp_cancel_install(id: String) -> Result<(), String> {
    if let Some(value) = installs()
        .lock()
        .map_err(|_| "Install lock failed")?
        .get_mut(&id)
    {
        *value = true;
    }
    Ok(())
}
#[tauri::command]
pub async fn generic_acp_install(
    app: AppHandle,
    id: String,
    version: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || generic_acp_install_sync(app, id, version))
        .await
        .map_err(|error| error.to_string())?
}

fn generic_acp_install_sync(app: AppHandle, id: String, version: String) -> Result<(), String> {
    let entries = generic_acp_registry(None)?;
    let entry = entries
        .into_iter()
        .find(|entry| entry["id"] == id && entry["version"] == version)
        .ok_or("Registry version is unavailable")?;
    let package = entry["package"]
        .as_str()
        .filter(|package| exact_package(package))
        .ok_or("Pinned npm distribution is unavailable")?;
    {
        let mut running = installs().lock().map_err(|_| "Install lock failed")?;
        if running.contains_key(&id) {
            return Err("ACP installation already running".into());
        }
        running.insert(id.clone(), false);
    }
    let result = (|| {
        let prefix = directory(&app)?
            .join("acp-tools")
            .join(&id)
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&prefix).map_err(|error| error.to_string())?;
        let mut cmd;
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                .map(|path| path.join("node.exe"))
                .find(|path| path.is_file())
                .ok_or("Node.js is unavailable")?;
            let npm = node
                .parent()
                .ok_or("Invalid Node path")?
                .join("node_modules/npm/bin/npm-cli.js");
            if !npm.is_file() {
                return Err("npm CLI is unavailable beside Node.js".into());
            }
            cmd = Command::new(node);
            cmd.arg(npm).creation_flags(0x08000000);
        }
        #[cfg(not(windows))]
        {
            cmd = Command::new("npm");
        }
        cmd.args(["install", "--prefix"])
            .arg(&prefix)
            .args(["--no-audit", "--no-fund", "--", package])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|error| error.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            let cancelled = *installs()
                .lock()
                .map_err(|_| "Install lock failed")?
                .get(&id)
                .unwrap_or(&true);
            if cancelled || Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err("ACP installation cancelled or timed out".into());
            }
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                if !status.success() {
                    return Err(
                        "ACP installation failed; check npm availability and package compatibility"
                            .into(),
                    );
                }
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let name = package.rsplit_once('@').ok_or("Invalid package")?.0;
        let package_root = prefix.join("node_modules").join(name);
        let manifest: Value = serde_json::from_slice(
            &fs::read(package_root.join("package.json")).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let bins: Vec<&str> = if let Some(bin) = manifest["bin"].as_str() {
            vec![bin]
        } else {
            manifest["bin"]
                .as_object()
                .map(|values| values.values().filter_map(Value::as_str).collect())
                .unwrap_or_default()
        };
        if bins.len() != 1 {
            return Err(
                "Package exposes multiple or no commands; configure a local command explicitly"
                    .into(),
            );
        }
        let script = package_root
            .join(bins[0])
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !script.starts_with(
            package_root
                .canonicalize()
                .map_err(|error| error.to_string())?,
        ) {
            return Err("Package command escapes installation".into());
        }
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|path| path.join(if cfg!(windows) { "node.exe" } else { "node" }))
            .find(|path| path.is_file())
            .ok_or("Node.js is unavailable")?;
        let mut args = vec![json!(script.to_string_lossy())];
        args.extend(entry["args"].as_array().cloned().unwrap_or_default());
        generic_acp_save(
            app.clone(),
            json!({"id":id,"name":entry["name"],"command":node.to_string_lossy(),"args":args,"env":entry["env"].as_object().cloned().unwrap_or_default()}),
        )
    })();
    installs()
        .lock()
        .map_err(|_| "Install lock failed")?
        .remove(&id);
    result
}
