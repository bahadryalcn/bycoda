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
    /// Read offline from files the CLI wrote; lets the UI dedupe the same account.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<ProfileIdentity>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if matches!(provider, "claude" | "codex" | "grok") {
        Ok(())
    } else {
        Err("Terminal profiles are supported for Claude, Codex and Grok".into())
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
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => match std::fs::symlink_metadata(path)
        {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Registry::new()),
            _ => Err("Could not read terminal profile references".into()),
        },
        Err(e) => Err(e.to_string()),
    }
}

fn write_registry(path: &Path, registry: &Registry) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid registry path")?)
        .map_err(|e| e.to_string())?;
    crate::file_access::durable_write(
        path,
        &serde_json::to_vec_pretty(registry).map_err(|e| e.to_string())?,
    )
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

/// Signed-in evidence only: leftover settings, projects or sessions do not make a profile.
/// Claude on macOS keeps credentials in the Keychain, so a cached `oauthAccount` also counts.
fn has_profile(provider: &str, path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    match provider {
        "claude" => {
            path.join(".credentials.json").exists()
                || std::fs::read_to_string(path.join(".claude.json"))
                    .ok()
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .and_then(|json| {
                        json.get("oauthAccount")?
                            .as_object()?
                            .get("emailAddress")?
                            .as_str()
                            .map(|email| !email.trim().is_empty())
                    })
                    .unwrap_or(false)
        }
        _ => path.join("auth.json").exists(),
    }
}

/// Same shape the account contract accepts (see `provider_account_path`).
fn is_managed_account_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id != "default"
        && !is_terminal_id(id)
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn default_dir(provider: &str) -> Result<PathBuf, String> {
    let (env, folder) = match provider {
        "claude" => ("CLAUDE_CONFIG_DIR", ".claude"),
        "grok" => ("GROK_HOME", ".grok"),
        _ => ("CODEX_HOME", ".codex"),
    };
    std::env::var_os(env)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| crate::dirs_home().map(|home| PathBuf::from(home).join(folder)))
        .ok_or_else(|| "Home directory is unavailable".into())
}

/// `managed_root` is this app's `provider-accounts/<provider>`; folders directly inside
/// it keep their own account id instead of getting a `terminal-` id.
fn candidate(
    provider: &str,
    path: PathBuf,
    managed_root: Option<&Path>,
) -> Result<TerminalProfile, String> {
    if !path.is_absolute() || !has_profile(provider, &path) {
        return Err("Select an existing signed-in Claude, Codex or Grok profile directory".into());
    }
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let default = std::fs::canonicalize(default_dir(provider)?).ok();
    let is_default = default.as_ref() == Some(&path);
    let managed_id = managed_root
        .and_then(|root| std::fs::canonicalize(root).ok())
        .filter(|root| path.parent() == Some(root.as_path()))
        .and_then(|_| path.file_name()?.to_str().map(str::to_owned))
        .filter(|name| is_managed_account_id(name));
    let label = if is_default {
        "Terminal account".to_owned()
    } else {
        path.file_name()
            .map(|name| name.to_string_lossy().trim_start_matches('.').to_owned())
            .unwrap_or_else(|| "Terminal profile".into())
    };
    let identity =
        crate::account_identity::cached_identity(provider, &path).map(|(email, organization)| {
            ProfileIdentity {
                email,
                organization,
            }
        });
    Ok(TerminalProfile {
        id: if is_default {
            "default".into()
        } else if let Some(id) = managed_id {
            id
        } else {
            profile_id(provider, &path)
        },
        provider: provider.into(),
        label,
        path,
        identity,
    })
}

fn managed_root(app_data: &Path, provider: &str) -> PathBuf {
    app_data.join("provider-accounts").join(provider)
}

#[tauri::command(async)]
pub fn provider_terminal_profiles(
    app: AppHandle,
    provider: String,
) -> Result<Vec<TerminalProfile>, String> {
    validate_provider(&provider)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut paths = vec![default_dir(&provider)?];
    paths.extend(saved_profile_paths(&app_data, &provider)?);
    paths.extend(sibling_managed_paths(&app_data, &provider));
    // Bounded, shallow discovery: standard homes and sibling named profiles.
    // Shell aliases/functions are never executed. Other locations can be selected manually.
    if let Some(home) = crate::dirs_home() {
        paths.extend(home_profile_paths(Path::new(&home), &provider)?);
    }
    let root = managed_root(&app_data, &provider);
    let mut profiles = BTreeMap::new();
    for path in paths {
        if let Ok(profile) = candidate(&provider, path, Some(&root)) {
            profiles.insert(profile.id.clone(), profile);
        }
    }
    Ok(profiles.into_values().collect())
}

/// Directories in home named `.<provider>` plus any suffix (`.claude2`, `.claude-f`).
/// The signed-in evidence check later drops look-alikes such as `.claude-server-commander`.
fn home_profile_paths(home: &Path, provider: &str) -> Result<Vec<PathBuf>, String> {
    let prefix = format!(".{provider}");
    Ok(std::fs::read_dir(home)
        .map_err(|e| e.to_string())?
        .take(2048)
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect())
}

/// Managed folders of sibling bycoda installs (release and dev). They are linked by
/// path, so they get normal `terminal-` ids.
fn sibling_managed_paths(app_data: &Path, provider: &str) -> Vec<PathBuf> {
    let Some(parent) = app_data.parent() else {
        return Vec::new();
    };
    let own = std::fs::canonicalize(managed_root(app_data, provider)).ok();
    let mut paths = Vec::new();
    for identifier in ["com.bycoda.desktop", "com.bycoda.desktop.dev"] {
        let root = managed_root(&parent.join(identifier), provider);
        if own.is_some() && std::fs::canonicalize(&root).ok() == own {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(root) {
            paths.extend(entries.take(256).flatten().map(|entry| entry.path()));
        }
    }
    paths
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
    let managed = managed_root(root, provider);
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
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile = candidate(&provider, path, Some(&managed_root(&app_data, &provider)))?;
    // The default home and managed folders are already addressable by their own id.
    if is_terminal_id(&profile.id) {
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
    fn corrupt_registry_stays_unavailable_and_preserves_evidence() {
        let root =
            std::env::temp_dir().join(format!("bycoda-profile-corrupt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("registry.json");
        std::fs::write(&path, "broken").unwrap();
        assert!(read_registry(&path).is_err());
        assert!(read_registry(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn dangling_registry_symlink_is_not_an_empty_registry() {
        use std::os::unix::fs::symlink;
        let root =
            std::env::temp_dir().join(format!("bycoda-profile-dangling-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("registry.json");
        symlink(root.join("missing"), &path).unwrap();
        assert!(read_registry(&path).is_err());
        assert!(std::fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_registry_replacement_preserves_existing_target() {
        let root =
            std::env::temp_dir().join(format!("bycoda-profile-failure-{}", uuid::Uuid::new_v4()));
        let path = root.join("registry.json");
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("original"), "keep").unwrap();
        assert!(write_registry(&path, &Registry::new()).is_err());
        assert_eq!(
            std::fs::read_to_string(path.join("original")).unwrap(),
            "keep"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
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
        std::fs::write(managed.join(".credentials.json"), "{}").unwrap();
        std::fs::write(linked.join(".credentials.json"), "{}").unwrap();
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
            .all(|path| candidate("claude", path, None).is_ok()));
        assert_eq!(
            std::fs::read_to_string(managed.join(".credentials.json")).unwrap(),
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
        std::fs::write(profile_dir.join(".credentials.json"), "{}").unwrap();
        let profile = candidate("claude", profile_dir.clone(), None).unwrap();
        assert!(profile.id.starts_with(PREFIX));
        assert!(candidate("codex", profile_dir.clone(), None).is_err());
        assert!(candidate("claude", PathBuf::from("relative-profile"), None).is_err());
        let path = root.join("registry.json");
        let registry = Registry::from([(format!("claude:{}", profile.id), profile.path)]);
        write_registry(&path, &registry).unwrap();
        assert_eq!(read_registry(&path).unwrap(), registry);
        write_registry(&path, &Registry::new()).unwrap();
        assert!(read_registry(&path).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(profile_dir.join(".credentials.json")).unwrap(),
            "{}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("bycoda-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn managed_folder_keeps_its_own_id_with_offline_identity() {
        let root = temp_root("profile-managed");
        let managed = managed_root(&root, "claude");
        let dir = managed.join("account-abc");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"ada@example.com","organizationName":"Acme"}}"#,
        )
        .unwrap();
        let profile = candidate("claude", dir.clone(), Some(&managed)).unwrap();
        assert_eq!(profile.id, "account-abc");
        assert_eq!(
            profile.identity,
            Some(ProfileIdentity {
                email: Some("ada@example.com".into()),
                organization: Some("Acme".into())
            })
        );
        // Outside the managed root the same folder is linked by path.
        let other = candidate("claude", dir, None).unwrap();
        assert!(is_terminal_id(&other.id));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn leftover_folders_are_not_profiles() {
        let root = temp_root("profile-leftover");
        std::fs::create_dir_all(root.join("projects")).unwrap();
        std::fs::create_dir_all(root.join("sessions")).unwrap();
        std::fs::write(root.join("settings.json"), "{}").unwrap();
        std::fs::write(root.join("config.toml"), "").unwrap();
        std::fs::write(root.join(".claude.json"), r#"{"numStartups":2}"#).unwrap();
        assert!(!has_profile("claude", &root));
        assert!(!has_profile("codex", &root));
        std::fs::write(
            root.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":" "}}"#,
        )
        .unwrap();
        assert!(!has_profile("claude", &root));
        std::fs::write(
            root.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"a@b.c"}}"#,
        )
        .unwrap();
        assert!(has_profile("claude", &root));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_and_codex_need_auth_json() {
        let root = temp_root("profile-grok");
        assert!(validate_provider("grok").is_ok());
        assert!(!has_profile("grok", &root));
        std::fs::write(root.join("auth.json"), "{}").unwrap();
        assert!(has_profile("grok", &root));
        assert!(has_profile("codex", &root));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn home_scan_accepts_any_suffix_but_only_directories() {
        let home = temp_root("profile-home");
        for name in [
            ".claude",
            ".claude2",
            ".claude-f",
            ".codex_work",
            ".claudeX",
        ] {
            std::fs::create_dir_all(home.join(name)).unwrap();
        }
        std::fs::write(home.join(".claude.json"), "{}").unwrap();
        let mut found: Vec<String> = home_profile_paths(&home, "claude")
            .unwrap()
            .into_iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        found.sort();
        assert_eq!(found, [".claude", ".claude-f", ".claude2", ".claudeX"]);
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn sibling_roots_are_scanned_and_get_terminal_ids() {
        let base = temp_root("profile-sibling");
        let own = base.join("com.bycoda.desktop.dev");
        let sibling = managed_root(&base.join("com.bycoda.desktop"), "claude");
        std::fs::create_dir_all(managed_root(&own, "claude")).unwrap();
        let foreign = sibling.join("account-foreign");
        std::fs::create_dir_all(&foreign).unwrap();
        std::fs::write(foreign.join(".credentials.json"), "{}").unwrap();
        let found = sibling_managed_paths(&own, "claude");
        assert_eq!(found, vec![foreign.clone()]);
        let profile = candidate("claude", foreign, Some(&managed_root(&own, "claude"))).unwrap();
        assert!(is_terminal_id(&profile.id));
        std::fs::remove_dir_all(base).unwrap();
    }
}
