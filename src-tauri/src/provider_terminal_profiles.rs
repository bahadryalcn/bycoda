//! References to existing CLI homes. Credentials and history remain owned by the CLI.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const PREFIX: &str = "terminal-";
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());
type Registry = BTreeMap<String, PathBuf>;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub path: PathBuf,
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if matches!(provider, "claude" | "codex") {
        Ok(())
    } else {
        Err("Terminal profiles are supported for Claude and Codex".into())
    }
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("terminal-profiles.json"))
}

fn read_registry(path: &Path) -> Result<Registry, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("Could not read terminal profile references: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Registry::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_registry(path: &Path, registry: &Registry) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid registry path")?)
        .map_err(|e| e.to_string())?;
    let pending = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(
        &pending,
        serde_json::to_vec_pretty(registry).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(pending, path).map_err(|e| e.to_string())
}

pub(crate) fn is_terminal_id(id: &str) -> bool {
    id.starts_with(PREFIX)
}

pub(crate) fn resolve(
    app: &AppHandle,
    provider: &str,
    id: &str,
) -> Result<Option<PathBuf>, String> {
    if !is_terminal_id(id) {
        return Ok(None);
    }
    validate_provider(provider)?;
    let _lock = REGISTRY_LOCK.lock().map_err(|e| e.to_string())?;
    let path = read_registry(&registry_path(app)?)?
        .remove(&format!("{provider}:{id}"))
        .ok_or("This terminal profile is disconnected; find it again in Accounts")?;
    if !path.is_dir() {
        return Err("The linked terminal profile directory is unavailable".into());
    }
    Ok(Some(path))
}

pub(crate) fn disconnect(app: &AppHandle, provider: &str, id: &str) -> Result<(), String> {
    validate_provider(provider)?;
    let _lock = REGISTRY_LOCK.lock().map_err(|e| e.to_string())?;
    let path = registry_path(app)?;
    let mut registry = read_registry(&path)?;
    registry.remove(&format!("{provider}:{id}"));
    write_registry(&path, &registry)
}

fn profile_id(provider: &str, path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    let value = value.to_lowercase();
    let digest = Sha256::digest(format!("{provider}:{value}"));
    format!("{PREFIX}{:x}", digest)[..PREFIX.len() + 24].to_owned()
}

fn has_profile(provider: &str, path: &Path) -> bool {
    let markers: &[&str] = if provider == "claude" {
        &[
            ".claude.json",
            ".credentials.json",
            "settings.json",
            "projects",
        ]
    } else {
        &["auth.json", "config.toml", "sessions"]
    };
    path.is_dir() && markers.iter().any(|name| path.join(name).exists())
}

fn default_dir(provider: &str) -> Result<PathBuf, String> {
    let (env, folder) = if provider == "claude" {
        ("CLAUDE_CONFIG_DIR", ".claude")
    } else {
        ("CODEX_HOME", ".codex")
    };
    std::env::var_os(env)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| crate::dirs_home().map(|home| PathBuf::from(home).join(folder)))
        .ok_or_else(|| "Home directory is unavailable".into())
}

fn candidate(provider: &str, path: PathBuf) -> Result<TerminalProfile, String> {
    if !path.is_absolute() || !has_profile(provider, &path) {
        return Err("Select an existing Claude or Codex profile directory".into());
    }
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let default = std::fs::canonicalize(default_dir(provider)?).ok();
    let is_default = default.as_ref() == Some(&path);
    let label = if is_default {
        "Terminal account".to_owned()
    } else {
        path.file_name()
            .map(|name| name.to_string_lossy().trim_start_matches('.').to_owned())
            .unwrap_or_else(|| "Terminal profile".into())
    };
    Ok(TerminalProfile {
        id: if is_default {
            "default".into()
        } else {
            profile_id(provider, &path)
        },
        provider: provider.into(),
        label,
        path,
    })
}

#[tauri::command(async)]
pub fn provider_terminal_profiles(
    app: AppHandle,
    provider: String,
) -> Result<Vec<TerminalProfile>, String> {
    validate_provider(&provider)?;
    let mut paths = vec![default_dir(&provider)?];
    paths.extend(saved_profile_paths(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        &provider,
    )?);
    // Bounded, shallow discovery: standard homes and sibling named profiles.
    // Shell aliases/functions are never executed. Other locations can be selected manually.
    if let Some(home) = crate::dirs_home() {
        let prefix = format!(".{provider}");
        for entry in std::fs::read_dir(home)
            .map_err(|e| e.to_string())?
            .take(2048)
            .flatten()
        {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == prefix
                || name.starts_with(&format!("{prefix}-"))
                || name.starts_with(&format!("{prefix}_"))
            {
                paths.push(entry.path());
            }
        }
    }
    let mut profiles = BTreeMap::new();
    for path in paths {
        if let Ok(profile) = candidate(&provider, path) {
            profiles.insert(profile.id.clone(), profile);
        }
    }
    Ok(profiles.into_values().collect())
}

fn saved_profile_paths(root: &Path, provider: &str) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    // A fresh webview has no browser account metadata. Keep previously linked
    // nonstandard locations and bycoda's existing profiles discoverable too.
    for (key, path) in read_registry(&root.join("terminal-profiles.json"))?
        .into_iter()
        .take(2048)
    {
        if key.starts_with(&format!("{provider}:")) {
            paths.push(path);
        }
    }
    let managed = root.join("provider-accounts").join(provider);
    match std::fs::read_dir(managed) {
        Ok(entries) => paths.extend(entries.take(256).flatten().map(|entry| entry.path())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Could not discover saved provider profiles: {error}"
            ))
        }
    }
    Ok(paths)
}

#[tauri::command(async)]
pub fn provider_terminal_profile_connect(
    app: AppHandle,
    provider: String,
    path: PathBuf,
) -> Result<TerminalProfile, String> {
    validate_provider(&provider)?;
    let profile = candidate(&provider, path)?;
    if profile.id != "default" {
        let _lock = REGISTRY_LOCK.lock().map_err(|e| e.to_string())?;
        let path = registry_path(&app)?;
        let mut registry = read_registry(&path)?;
        registry.insert(format!("{provider}:{}", profile.id), profile.path.clone());
        write_registry(&path, &registry)?;
    }
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_profile_paths_recovers_managed_and_linked_locations_without_browser_metadata() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "bycoda-profile-discovery-{}-{stamp}",
            std::process::id()
        ));
        let managed = root.join("provider-accounts/claude/account-existing");
        let linked = root.join("elsewhere/claude-work");
        std::fs::create_dir_all(&managed).unwrap();
        std::fs::create_dir_all(&linked).unwrap();
        std::fs::write(managed.join("settings.json"), "{}").unwrap();
        std::fs::write(linked.join("settings.json"), "{}").unwrap();
        let registry = root.join("terminal-profiles.json");
        write_registry(
            &registry,
            &Registry::from([
                ("claude:terminal-work".into(), linked.clone()),
                ("codex:terminal-other".into(), root.join("other-provider")),
            ]),
        )
        .unwrap();
        let found = saved_profile_paths(&root, "claude").unwrap();
        assert_eq!(found.len(), 2);
        assert!(found.contains(&managed) && found.contains(&linked));
        assert!(found
            .into_iter()
            .all(|path| candidate("claude", path).is_ok()));
        assert_eq!(
            std::fs::read_to_string(managed.join("settings.json")).unwrap(),
            "{}"
        );
        // A broken registry is an explicit discovery failure, not "no accounts".
        std::fs::write(&registry, "broken").unwrap();
        assert!(saved_profile_paths(&root, "claude").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn ids_are_stable_provider_scoped_and_accepted_by_account_contract() {
        let path = Path::new("/home/example/.claude-work");
        let id = profile_id("claude", path);
        assert_eq!(id, profile_id("claude", path));
        assert_ne!(id, profile_id("codex", path));
        assert!(id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
        assert!(is_terminal_id(&id));
        assert!(!is_terminal_id("account-existing"));
    }
    #[test]
    fn registry_round_trip_keeps_only_paths() {
        let registry = Registry::from([(
            "claude:terminal-test".into(),
            PathBuf::from("/home/example/.claude-work"),
        )]);
        let bytes = serde_json::to_vec(&registry).unwrap();
        assert_eq!(
            serde_json::from_slice::<Registry>(&bytes).unwrap(),
            registry
        );
        assert!(validate_provider("claude").is_ok());
        assert!(validate_provider("codex").is_ok());
        assert!(validate_provider("other").is_err());
    }

    #[test]
    fn connecting_and_replacing_references_preserves_the_cli_home() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "bycoda-profile-test-{}-{stamp}",
            std::process::id()
        ));
        let profile_dir = root.join(".claude-work");
        std::fs::create_dir_all(&profile_dir).unwrap();
        std::fs::write(profile_dir.join("settings.json"), "{}").unwrap();
        let profile = candidate("claude", profile_dir.clone()).unwrap();
        assert!(profile.id.starts_with(PREFIX));
        assert!(candidate("codex", profile_dir.clone()).is_err());
        assert!(candidate("claude", PathBuf::from("relative-profile")).is_err());
        let path = root.join("registry.json");
        let registry = Registry::from([(format!("claude:{}", profile.id), profile.path)]);
        write_registry(&path, &registry).unwrap();
        assert_eq!(read_registry(&path).unwrap(), registry);
        write_registry(&path, &Registry::new()).unwrap();
        assert!(read_registry(&path).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(profile_dir.join("settings.json")).unwrap(),
            "{}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
