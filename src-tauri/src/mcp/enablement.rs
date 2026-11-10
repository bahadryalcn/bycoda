//! Provider-native MCP enablement without removing server configuration.
use super::{config::write_config, dirs_home, discover, expand_home, jsonc};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[tauri::command]
pub async fn mcp_set_enabled(
    cwd: String,
    provider: String,
    scope: String,
    name: String,
    config_path: String,
    enabled: bool,
    expected_enabled: bool,
    global_only: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = PathBuf::from(dirs_home().ok_or("Home directory not found")?);
        let project = expand_home(&cwd);
        let global_only = global_only.unwrap_or(false);
        if global_only && (provider == "claude" || scope != "user") {
            return Err("This MCP enablement change requires a project".into());
        }
        if !global_only && !project.is_dir() {
            return Err("Project directory does not exist".into());
        }
        let codex_home = std::env::var_os("CODEX_HOME").map(PathBuf::from);
        let opencode = std::env::var_os("OPENCODE_CONFIG").map(PathBuf::from);
        let connections = discover(
            &home,
            (!global_only).then_some(project.as_path()),
            codex_home.as_deref(),
            &super::claude_desktop_config(&home),
            opencode.as_deref(),
        )?;
        let target = connections
            .iter()
            .find(|server| {
                server.provider == provider
                    && server.scope == scope
                    && server.name == name
                    && server.config_path == config_path
            })
            .ok_or("MCP configuration changed; refresh and retry")?;
        if target.enabled != expected_enabled {
            return Err("MCP enablement changed; refresh and retry".into());
        }
        match provider.as_str() {
            "codex" => write_config(Path::new(&config_path), |raw| {
                edit_codex(raw, &name, enabled, expected_enabled)
            }),
            "opencode" => write_config(Path::new(&config_path), |raw| {
                jsonc::edit(raw, |root| {
                    edit_opencode(root, &name, enabled, expected_enabled)
                })
            }),
            "claude" => super::config::write_json_config(&home.join(".claude.json"), |root| {
                edit_claude(
                    root,
                    &project.to_string_lossy(),
                    &name,
                    enabled,
                    expected_enabled,
                )
            }),
            _ => Err("This provider does not support changing MCP enablement here".into()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

fn assert_expected(current: bool, expected: bool) -> Result<(), String> {
    if current != expected {
        return Err("MCP enablement changed; refresh and retry".into());
    }
    Ok(())
}

fn edit_codex(raw: &str, name: &str, enabled: bool, expected: bool) -> Result<String, String> {
    let mut document = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "Existing Codex config is invalid TOML")?;
    let server = document
        .get_mut("mcp_servers")
        .and_then(|servers| servers.get_mut(name))
        .and_then(toml_edit::Item::as_table_like_mut)
        .ok_or("MCP server no longer exists")?;
    let current = match server.get("enabled") {
        Some(item) => item.as_bool().ok_or("enabled must be a boolean")?,
        None => true,
    };
    assert_expected(current, expected)?;
    if let Some(value) = server
        .get_mut("enabled")
        .and_then(toml_edit::Item::as_value_mut)
    {
        let decor = value.decor().clone();
        *value = toml_edit::Value::from(enabled);
        *value.decor_mut() = decor;
    } else {
        server.insert("enabled", toml_edit::value(enabled));
    }
    let encoded = document.to_string();
    Ok(
        if raw.contains("\r\n") && !raw.replace("\r\n", "").contains('\n') {
            encoded.replace("\r\n", "\n").replace('\n', "\r\n")
        } else {
            encoded
        },
    )
}

fn edit_opencode(
    root: &mut Value,
    name: &str,
    enabled: bool,
    expected: bool,
) -> Result<(), String> {
    let mcp = root
        .get_mut("mcp")
        .and_then(Value::as_object_mut)
        .ok_or("MCP server no longer exists")?;
    let version_two = mcp
        .get("servers")
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.values().all(Value::is_object));
    let servers = if version_two {
        mcp.get_mut("servers")
            .and_then(Value::as_object_mut)
            .unwrap()
    } else {
        mcp
    };
    let server = servers
        .get_mut(name)
        .and_then(Value::as_object_mut)
        .ok_or("MCP server no longer exists")?;
    for key in ["enabled", "disabled"] {
        if server.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(format!("{key} must be a boolean"));
        }
    }
    let current = server.get("enabled").and_then(Value::as_bool) != Some(false)
        && server.get("disabled").and_then(Value::as_bool) != Some(true);
    assert_expected(current, expected)?;
    server.remove(if version_two { "enabled" } else { "disabled" });
    server.insert(
        if version_two { "disabled" } else { "enabled" }.into(),
        Value::Bool(if version_two { !enabled } else { enabled }),
    );
    Ok(())
}

pub(super) fn claude_project_key(root: &Value, project: &str) -> Result<String, String> {
    fn normalized(project: &str) -> String {
        if cfg!(windows) {
            let path = project.replace('\\', "/");
            let trimmed = path.trim_end_matches('/');
            if trimmed.len() == 2 && trimmed.ends_with(':') {
                format!("{trimmed}/")
            } else {
                trimmed.to_owned()
            }
        } else {
            project.to_owned()
        }
    }
    let normalized_project = normalized(project);
    let Some(projects) = root.get("projects") else {
        return Ok(normalized_project);
    };
    let projects = projects
        .as_object()
        .ok_or("Claude projects must be an object")?;
    let matches = projects
        .keys()
        .filter(|key| {
            if cfg!(windows) {
                normalized(key).to_lowercase() == normalized_project.to_lowercase()
            } else {
                *key == project
            }
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(normalized_project),
        [key] => Ok((*key).clone()),
        _ => Err(
            "Claude has ambiguous project settings; resolve duplicate project paths first".into(),
        ),
    }
}

pub(super) fn claude_disabled(root: &Value, project: &str, name: &str) -> bool {
    root.get("projects")
        .and_then(|projects| projects.get(project))
        .and_then(|entry| entry.get("disabledMcpServers"))
        .and_then(Value::as_array)
        .is_some_and(|names| names.iter().any(|value| value.as_str() == Some(name)))
}

fn edit_claude(
    root: &mut Value,
    project: &str,
    name: &str,
    enabled: bool,
    expected: bool,
) -> Result<(), String> {
    let project = claude_project_key(root, project)?;
    assert_expected(!claude_disabled(root, &project, name), expected)?;
    let root = root
        .as_object_mut()
        .ok_or("Existing config must be an object")?;
    let projects = root
        .entry("projects")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("projects must be an object")?;
    let project = projects
        .entry(project)
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("Project settings must be an object")?;
    let disabled = project
        .entry("disabledMcpServers")
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
        .ok_or("disabledMcpServers must be an array")?;
    if disabled.iter().any(|entry| !entry.is_string()) {
        return Err("disabledMcpServers must contain names".into());
    }
    disabled.retain(|entry| entry.as_str() != Some(name));
    if !enabled {
        disabled.push(Value::String(name.into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
