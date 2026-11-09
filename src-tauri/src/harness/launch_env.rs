//! Environment applied to a provider child before it starts: renderer-chosen launch
//! variables and the per-account configuration directories.
use std::collections::HashMap;
use std::process::Command;

use tauri::AppHandle;

use super::{link_shared_agents, provider_account_dir, HarnessAccount};

/// Renderer-chosen launch environment. Only provider configuration the harness
/// layer owns may pass (OpenCode reads its inline MCP config from this variable, so
/// hub-hosted servers replace the user's own stdio copies); every other key is
/// ignored, and oversized values are dropped rather than truncated.
const LAUNCH_ENV_ALLOWED: &[&str] = &["OPENCODE_CONFIG_CONTENT"];
const LAUNCH_ENV_MAX_BYTES: usize = 64 * 1024;

pub(super) fn apply_launch_env(cmd: &mut Command, env: Option<&HashMap<String, String>>) {
    let Some(env) = env else {
        return;
    };
    for (key, value) in env {
        if LAUNCH_ENV_ALLOWED.contains(&key.as_str()) && value.len() <= LAUNCH_ENV_MAX_BYTES {
            cmd.env(key, value);
        }
    }
}

/// Points a provider child at its account directory and strips ambient credentials.
pub(super) fn apply_provider_account(
    app: &AppHandle,
    cmd: &mut Command,
    account: Option<&HarnessAccount>,
) -> Result<(), String> {
    let Some(account) = account else {
        return Ok(());
    };
    let Some(dir) = provider_account_dir(app, &account.provider, Some(&account.id))? else {
        return Ok(());
    };
    if !crate::provider_terminal_profiles::is_terminal_id(&account.id) {
        if let Ok(shared) = crate::provider_usage::account_config_dir(app, &account.provider, None)
        {
            link_shared_agents(&shared, &dir);
        }
    }
    match account.provider.as_str() {
        "claude" => {
            // Claude scopes both its ordinary config and its macOS Keychain
            // credential to these exact strings. Setting both keeps profiles
            // isolated on every supported platform.
            cmd.env("CLAUDE_CONFIG_DIR", &dir)
                .env("CLAUDE_SECURESTORAGE_CONFIG_DIR", &dir)
                .env_remove("ANTHROPIC_API_KEY")
                .env_remove("ANTHROPIC_AUTH_TOKEN")
                .env_remove("CLAUDE_CODE_OAUTH_TOKEN");
        }
        "codex" => {
            cmd.env("CODEX_HOME", &dir)
                .env_remove("OPENAI_API_KEY")
                .env_remove("CODEX_API_KEY")
                .env_remove("CODEX_ACCESS_TOKEN");
        }
        _ => unreachable!("provider_account_dir validates the provider"),
    }
    Ok(())
}
