//! Read and replace one discovered provider entry with optimistic concurrency.
use super::{config, enablement, jsonc, McpConnection};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const NOT_FOUND: &str = "MCP server not found in this configuration";
const CHANGED: &str = "The configuration changed on disk. Reload it before saving.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub config: String,
    pub revision: String,
}

struct Target {
    provider: String,
    scope: String,
    config_path: String,
    name: String,
    project: PathBuf,
}

impl Target {
    fn authorize(&self, connections: &[McpConnection]) -> Result<(), String> {
        if connections.iter().any(|entry| {
            entry.provider == self.provider
                && entry.scope == self.scope
                && entry.config_path == self.config_path
                && entry.name == self.name
        }) {
            Ok(())
        } else {
            Err(NOT_FOUND.into())
        }
    }

    fn discover(&self, global_only: Option<bool>) -> Result<(), String> {
        let home = PathBuf::from(super::dirs_home().ok_or("Home directory not found")?);
        let codex_home = std::env::var_os("CODEX_HOME").map(PathBuf::from);
        let opencode = std::env::var_os("OPENCODE_CONFIG").map(PathBuf::from);
        self.authorize(&super::discover(
            &home,
            (!global_only.unwrap_or(false)).then_some(self.project.as_path()),
            codex_home.as_deref(),
            &super::claude_desktop_config(&home),
            opencode.as_deref(),
        )?)
    }

    fn json_entry<'a>(&self, root: &'a mut Value) -> Result<&'a mut Value, String> {
        let servers = match (self.provider.as_str(), self.scope.as_str()) {
            ("claude", "local") => {
                let key = enablement::claude_project_key(root, &self.project.to_string_lossy())?;
                root.get_mut("projects")
                    .and_then(|projects| projects.get_mut(&key))
                    .and_then(|project| project.get_mut("mcpServers"))
            }
            ("opencode", _) => {
                let mcp = root.get_mut("mcp").ok_or(NOT_FOUND)?;
                let nested = mcp
                    .get("servers")
                    .and_then(Value::as_object)
                    .is_some_and(|servers| servers.values().all(Value::is_object));
                if nested {
                    mcp.get_mut("servers")
                } else {
                    Some(mcp)
                }
            }
            _ => root.get_mut("mcpServers"),
        };
        servers
            .and_then(|servers| servers.get_mut(&self.name))
            .filter(|entry| entry.is_object())
            .ok_or_else(|| NOT_FOUND.into())
    }

    fn read(&self) -> Result<McpServerConfig, String> {
        let raw = std::fs::read_to_string(&self.config_path).map_err(|e| e.to_string())?;
        if self.provider == "codex" {
            state(&self.toml_entry(&raw)?)
        } else {
            let mut result = None;
            // Use the same strict JSONC parser as writes, including duplicate-key checks.
            jsonc::edit(&raw, |root| {
                result = Some(state(self.json_entry(root)?)?);
                Ok(())
            })?;
            result.ok_or_else(|| NOT_FOUND.into())
        }
    }

    fn toml_entry(&self, raw: &str) -> Result<Value, String> {
        let root: toml::Value = toml::from_str(raw).map_err(|e| format!("Invalid TOML: {e}"))?;
        let entry = root
            .get("mcp_servers")
            .and_then(|servers| servers.get(&self.name))
            .filter(|entry| entry.is_table())
            .ok_or(NOT_FOUND)?;
        serde_json::to_value(entry).map_err(|e| e.to_string())
    }

    fn write(&self, config: &str, expected: &str) -> Result<McpServerConfig, String> {
        let entry = validate(&self.provider, config)?;
        let next = state(&entry)?;
        let check = |current: &Value| -> Result<(), String> {
            if state(current)?.revision != expected {
                Err(CHANGED.into())
            } else {
                Ok(())
            }
        };
        if self.provider == "codex" {
            config::write_config(Path::new(&self.config_path), |raw| {
                check(&self.toml_entry(raw)?)?;
                let mut document = raw
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|e| e.to_string())?;
                let value = toml::Value::try_from(&entry).map_err(|e| e.to_string())?;
                let replacement = toml::to_string(&value)
                    .map_err(|e| e.to_string())?
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|e| e.to_string())?;
                let current = document
                    .get_mut("mcp_servers")
                    .and_then(|servers| servers.get_mut(&self.name))
                    .ok_or(NOT_FOUND)?;
                merge_toml(current, replacement.into_item());
                Ok(document.to_string())
            })?;
        } else {
            config::write_json_config(Path::new(&self.config_path), |root| {
                let current = self.json_entry(root)?;
                check(current)?;
                *current = entry;
                Ok(())
            })?;
        }
        Ok(next)
    }
}

fn validate(provider: &str, config: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(config).map_err(|e| format!("Invalid JSON: {e}"))?;
    if !value.is_object() {
        return Err("Server configuration must be an object".into());
    }
    // Reject duplicate keys in the submitted entry as well as the destination file.
    jsonc::edit(config, |_| Ok(()))?;
    let command = if provider == "opencode" {
        value.get("command").is_some_and(Value::is_array)
    } else {
        value
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
    };
    let url = value
        .get("url")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    if command == url {
        return Err("Server needs either a command or a URL".into());
    }
    Ok(value)
}

fn state(entry: &Value) -> Result<McpServerConfig, String> {
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(object) => {
                let mut keys = object.keys().collect::<Vec<_>>();
                keys.sort();
                Value::Object(
                    keys.into_iter()
                        .map(|key| (key.clone(), canonical(&object[key])))
                        .collect(),
                )
            }
            Value::Array(array) => Value::Array(array.iter().map(canonical).collect()),
            _ => value.clone(),
        }
    }
    let canonical = canonical(entry);
    let encoded = serde_json::to_vec(&canonical).map_err(|e| e.to_string())?;
    Ok(McpServerConfig {
        config: serde_json::to_string_pretty(entry).map_err(|e| e.to_string())?,
        revision: format!("{:x}", Sha256::digest(encoded)),
    })
}

// Retain existing table/key order and decoration for fields that survive the edit.
fn merge_toml(current: &mut toml_edit::Item, next: toml_edit::Item) {
    if let (Some(current), Some(next)) = (current.as_table_like_mut(), next.as_table_like()) {
        let removed = current
            .iter()
            .filter(|(key, _)| !next.contains_key(key))
            .map(|(key, _)| key.to_owned())
            .collect::<Vec<_>>();
        for key in removed {
            current.remove(&key);
        }
        for (key, value) in next.iter() {
            if let Some(existing) = current.get_mut(key) {
                merge_toml(existing, value.clone());
            } else {
                current.insert(key, value.clone());
            }
        }
    } else {
        let decor = current.as_value().map(|value| value.decor().clone());
        *current = next;
        if let (Some(decor), Some(value)) = (decor, current.as_value_mut()) {
            *value.decor_mut() = decor;
        }
    }
}

#[tauri::command]
pub async fn mcp_server_config_read(
    cwd: String,
    provider: String,
    scope: String,
    config_path: String,
    name: String,
    global_only: Option<bool>,
) -> Result<McpServerConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = Target {
            provider,
            scope,
            config_path,
            name,
            project: super::expand_home(&cwd),
        };
        target.discover(global_only)?;
        target.read()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mcp_server_config_write(
    cwd: String,
    provider: String,
    scope: String,
    config_path: String,
    name: String,
    config: String,
    expected_revision: String,
    global_only: Option<bool>,
) -> Result<McpServerConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = Target {
            provider,
            scope,
            config_path,
            name,
            project: super::expand_home(&cwd),
        };
        target.discover(global_only)?;
        target.write(&config, &expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "server_config_tests.rs"]
mod tests;
