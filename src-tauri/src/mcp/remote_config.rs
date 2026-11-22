use std::io::{Read, Write};
use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

use super::{enablement, server_config};

const MAX_REQUEST: u64 = 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    cwd: Option<String>,
    #[serde(flatten)]
    operation: Operation,
}

#[derive(Deserialize)]
#[serde(rename_all_fields = "camelCase", tag = "command", content = "args")]
enum Operation {
    #[serde(rename = "mcp_discover")]
    Discover {},
    #[serde(rename = "codex_mcp_list")]
    CodexList {},
    #[serde(rename = "mcp_add")]
    Add {
        provider: String,
        scope: String,
        name: String,
        config: String,
    },
    #[serde(rename = "mcp_set_enabled")]
    SetEnabled {
        provider: String,
        scope: String,
        name: String,
        config_path: String,
        enabled: bool,
        expected_enabled: bool,
    },
    #[serde(rename = "mcp_server_config_read")]
    Read {
        provider: String,
        scope: String,
        name: String,
        config_path: String,
    },
    #[serde(rename = "mcp_server_config_write")]
    Write {
        provider: String,
        scope: String,
        name: String,
        config_path: String,
        config: String,
        expected_revision: String,
    },
    #[serde(rename = "claude_mcp_remove")]
    ClaudeRemove {
        scope: String,
        name: String,
        config_path: String,
    },
}

impl Operation {
    fn scope(&self) -> Option<&str> {
        match self {
            Self::Add { scope, .. }
            | Self::SetEnabled { scope, .. }
            | Self::Read { scope, .. }
            | Self::Write { scope, .. }
            | Self::ClaudeRemove { scope, .. } => Some(scope),
            Self::Discover {} | Self::CodexList {} => None,
        }
    }
}

async fn run(request: Request) -> Result<Value, String> {
    let global = request.cwd.is_none();
    if global
        && request
            .operation
            .scope()
            .is_some_and(|scope| scope != "user")
    {
        return Err("This MCP scope requires a project.".into());
    }
    let cwd = request
        .cwd
        .or_else(super::dirs_home)
        .ok_or("Home directory not found.")?;
    let path = Path::new(&cwd);
    if !path.is_absolute() || !path.is_dir() {
        return Err("MCP working directory is unavailable.".into());
    }
    let global_only = Some(global);
    let result = match request.operation {
        Operation::Discover {} => serde_json::to_value(super::mcp_discover(cwd, global_only).await?),
        Operation::CodexList {} => serde_json::to_value(
            crate::harness::codex_mcp_list_in_directory(cwd, None).await?,
        ),
        Operation::Add { provider, scope, name, config } => {
            super::add(cwd, provider, scope, name, config, None)
                .await
                .map_err(|_| "The owning PC could not add the MCP server. Check its configuration and provider.")?;
            Ok(Value::Null)
        }
        Operation::SetEnabled { provider, scope, name, config_path, enabled, expected_enabled } => {
            enablement::mcp_set_enabled(cwd, provider, scope, name, config_path, enabled, expected_enabled, global_only).await?;
            Ok(Value::Null)
        }
        Operation::Read { provider, scope, name, config_path } => serde_json::to_value(
            server_config::mcp_server_config_read(cwd, provider, scope, config_path, name, global_only)
                .await
                .map_err(|_| "The owning PC could not read the MCP entry. Refresh its configuration and retry.")?,
        ),
        Operation::Write { provider, scope, name, config_path, config, expected_revision } => serde_json::to_value(
            server_config::mcp_server_config_write(cwd, provider, scope, config_path, name, config, expected_revision, global_only)
                .await
                .map_err(|_| "The owning PC could not save the MCP entry. Check your draft and refresh its configuration before retrying.")?,
        ),
        Operation::ClaudeRemove { scope, name, config_path } => {
            let current = super::mcp_discover(cwd.clone(), global_only).await?;
            if !current.connections.iter().any(|server| {
                server.provider == "claude" && server.scope == scope && server.name == name && server.config_path == config_path
            }) {
                return Err("MCP configuration changed; refresh and retry.".into());
            }
            crate::harness::claude_mcp_remove_in_directory(cwd, name, scope, None)
                .await
                .map_err(|_| "The owning PC could not remove the Claude MCP server.")?;
            Ok(Value::Null)
        }
    };
    result.map_err(|_| "The owning PC could not return MCP configuration.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_host_wire_commands_and_keeps_global_scope_distinct() {
        let discover: Request =
            serde_json::from_value(json!({"command":"mcp_discover","args":{}})).unwrap();
        assert!(discover.cwd.is_none());
        assert!(matches!(discover.operation, Operation::Discover {}));

        let write: Request = serde_json::from_value(json!({
            "cwd": "/owner-project",
            "command":"mcp_server_config_write",
            "args":{
                "provider":"codex", "scope":"user", "name":"test", "configPath":"/profile/main.toml",
                "config":"{}", "expectedRevision":"prior"
            }
        })).unwrap();
        assert_eq!(write.cwd.as_deref(), Some("/owner-project"));
        assert!(
            matches!(write.operation, Operation::Write { expected_revision, .. } if expected_revision == "prior")
        );

        assert!(serde_json::from_value::<Request>(json!({
            "command": "run",
            "args": {"path": "/unknown"}
        }))
        .is_err());
    }
}

/// Private subprocess entry. Paths and provider input arrive over stdin, never argv.
pub fn maybe_run() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("control"))
        || args.next().as_deref() != Some(std::ffi::OsStr::new("mcp-config-helper"))
    {
        return None;
    }
    let mut input = Vec::new();
    let result = if std::io::stdin()
        .take(MAX_REQUEST + 1)
        .read_to_end(&mut input)
        .is_ok()
        && input.len() as u64 <= MAX_REQUEST
    {
        match serde_json::from_slice(&input) {
            Ok(request) => tauri::async_runtime::block_on(run(request)),
            Err(_) => Err("Invalid MCP configuration operation.".into()),
        }
    } else {
        Err("Invalid MCP configuration operation.".into())
    };
    let mut stdout = std::io::stdout().lock();
    let result = serde_json::to_writer(&mut stdout, &result);
    Some(if result.is_ok() && stdout.flush().is_ok() {
        0
    } else {
        1
    })
}
