use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;

use crate::harness::{exec_output_with_env, is_resolved_harness_binary};

const REGISTRY_URL: &str = "https://registry.npmjs.org";
const CURSOR_INSTALL_URL: &str = "https://cursor.com/install";
const USER_AGENT: &str = "Bycoda";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

/// Where each harness publishes its latest release. Hermes updates to the
/// newest commit rather than a release, and Antigravity's ACP server reports
/// no version, so neither has anything to compare against.
#[derive(Debug, PartialEq)]
enum VersionFeed {
    Npm(&'static str),
    /// A plain-text file whose first line is the version.
    Text(&'static str),
    /// Cursor has no version file. Its install script downloads one pinned
    /// build, and that build is the latest.
    CursorInstallScript,
}

fn version_feed(provider: &str) -> Option<VersionFeed> {
    match provider {
        "claude" => Some(VersionFeed::Npm("@anthropic-ai/claude-code")),
        "codex" => Some(VersionFeed::Npm("@openai/codex")),
        // V2 is published separately; the legacy package still reports V1,
        // which would make an installed V2 appear newer than the release feed.
        "opencode" => Some(VersionFeed::Npm("@opencode/cli")),
        "pi" => Some(VersionFeed::Npm("@earendil-works/pi-coding-agent")),
        "omp" => Some(VersionFeed::Npm("@oh-my-pi/pi-coding-agent")),
        "cursor" => Some(VersionFeed::CursorInstallScript),
        "grok" => Some(VersionFeed::Text("https://x.ai/cli/stable")),
        "fx" => Some(VersionFeed::Text("https://releases.fx.sh/latest.txt")),
        _ => None,
    }
}

fn version_feed_for_installed(
    provider: &str,
    _installed_version: Option<&str>,
) -> Option<VersionFeed> {
    // V1 is offered V2 as well: the updater performs the supported major migration.
    version_feed(provider)
}

/// Each CLI's own updater, which knows how it was installed (native, npm,
/// Homebrew) better than Bycoda could guess from the binary path.
fn update_args(provider: &str) -> Option<&'static [&'static str]> {
    match provider {
        "claude" => Some(&["update"]),
        "codex" => Some(&["update"]),
        "opencode" => Some(&["upgrade"]),
        "pi" => Some(&["update", "--self"]),
        "omp" => Some(&["update"]),
        "cursor" => Some(&["update"]),
        "grok" => Some(&["update"]),
        "fx" => Some(&["upgrade"]),
        _ => None,
    }
}

fn update_args_for_command(provider: &str, command: &str) -> Option<&'static [&'static str]> {
    // Bun's Windows shim is resolved as the CLI. Pass its known install method
    // instead of probing every installed package manager in a GUI child.
    let path = command.replace('\\', "/").to_ascii_lowercase();
    if provider == "opencode"
        && (path.contains("/.bun/bin/") || path.contains("/.bun/install/global/"))
    {
        return Some(&["upgrade", "--method", "bun"]);
    }
    update_args(provider)
}

/// npm's Unix global layout identifies both the package manager and its prefix.
/// A ~/.local/bin symlink alone is ambiguous: OpenCode V1 mistakes it for curl.
fn opencode_npm_prefix(binary: &std::path::Path) -> Option<&std::path::Path> {
    let bin = binary.parent()?;
    if bin.file_name()? != "bin" {
        return None;
    }
    let package = bin.parent()?;
    let modules = if package.file_name()? == "opencode-ai" {
        package.parent()?
    } else if package.file_name()? == "cli" && package.parent()?.file_name()? == "@opencode" {
        package.parent()?.parent()?
    } else {
        return None;
    };
    if modules.file_name()? != "node_modules" || modules.parent()?.file_name()? != "lib" {
        return None;
    }
    modules.parent()?.parent()
}

/// A download plus, for npm installs, a full dependency install.
const UPDATE_TIMEOUT: Duration = Duration::from_secs(300);

static LAUNCH_CHECK_CLAIMED: AtomicBool = AtomicBool::new(false);

/// True for the first caller per app process, so a window opened later in the
/// same run does not repeat the launch check.
#[tauri::command]
pub fn harness_update_check_claim() -> bool {
    !LAUNCH_CHECK_CLAIMED.swap(true, Ordering::SeqCst)
}

#[tauri::command]
pub async fn harness_latest_version(
    provider: String,
    installed_version: Option<String>,
) -> Result<String, String> {
    let feed = version_feed_for_installed(&provider, installed_version.as_deref())
        .ok_or_else(|| format!("No update feed for harness: {provider}"))?;
    tauri::async_runtime::spawn_blocking(move || match feed {
        VersionFeed::Npm(package) => {
            let text = fetch_text(
                &format!("{REGISTRY_URL}/{package}/latest"),
                "application/json",
            )?;
            let body: Value = serde_json::from_str(&text)
                .map_err(|error| format!("npm registry returned invalid JSON: {error}"))?;
            latest_version(&body).ok_or_else(|| "npm registry returned no version".to_string())
        }
        VersionFeed::Text(url) => first_line_version(&fetch_text(url, "text/plain")?)
            .ok_or_else(|| format!("{url} returned no version")),
        VersionFeed::CursorInstallScript => {
            cursor_script_version(&fetch_text(CURSOR_INSTALL_URL, "text/plain")?)
                .ok_or_else(|| "Cursor install script names no build".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn fetch_text(url: &str, accept: &str) -> Result<String, String> {
    ureq::AgentBuilder::new()
        .timeout(HTTP_TIMEOUT)
        .build()
        .get(url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", accept)
        .call()
        .map_err(|error| format!("{url} request failed: {error}"))?
        .into_string()
        .map_err(|error| format!("{url} response unreadable: {error}"))
}

/// Runs the harness's self-update against the binary Bycoda resolved for
/// it. stdin is closed, so an updater that stops to ask fails instead of
/// hanging.
#[tauri::command]
pub async fn harness_update(
    command: String,
    binary_provider: String,
    binary_path: Option<String>,
    target_version: Option<String>,
) -> Result<(), String> {
    let args: Vec<String> = update_args_for_command(&binary_provider, &command)
        .ok_or_else(|| format!("No updater for harness: {binary_provider}"))?
        .iter()
        .map(|arg| arg.to_string())
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        if !is_resolved_harness_binary(&command, Some(&binary_provider), binary_path.as_deref()) {
            return Err("harness_update: not a resolved harness CLI".to_string());
        }
        let resolved = std::fs::canonicalize(&command).ok();
        let npm_prefix = (binary_provider == "opencode")
            .then(|| resolved.as_deref().and_then(opencode_npm_prefix))
            .flatten()
            .map(|prefix| prefix.to_string_lossy().into_owned());
        let args = if npm_prefix.is_some() {
            vec![
                "upgrade".to_string(),
                "--method".to_string(),
                "npm".to_string(),
            ]
        } else {
            args
        };
        // Updating with the machine's default prefix can install a second copy
        // while leaving the binary Bycoda actually uses unchanged.
        let env: Vec<_> = npm_prefix
            .as_deref()
            .map(|prefix| vec![("NPM_CONFIG_PREFIX", prefix)])
            .unwrap_or_default();
        let execute = |args: &[String]| {
            let output = exec_output_with_env(&command, args, None, UPDATE_TIMEOUT, &env)?;
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
            }
            Err(format!(
                "{binary_provider} update failed ({}):\n{}",
                output.status,
                update_failure(&output.stdout, &output.stderr)
            ))
        };
        if binary_provider == "opencode" {
            if let Some(target) = target_version.as_deref() {
                validate_update_target(target)?;
                let installed = execute(&["--version".into()])?;
                if numeric_version(&installed)?.0 == 1 && numeric_version(target)?.0 >= 2 {
                    // Upstream removes the V1 package. A package-internal override
                    // would become invalid; require its stable launcher instead.
                    let path = command.replace('\\', "/").to_ascii_lowercase();
                    if path.contains("/node_modules/opencode-ai/") {
                        return Err("OpenCode migration requires the stable opencode launcher path, not a file inside node_modules/opencode-ai. Update the binary path in Settings and retry.".into());
                    }
                }
                return update_opencode(target, &args, &installed, || {
                    let text = fetch_text(&format!("{REGISTRY_URL}/opencode-ai/latest"), "application/json")?;
                    let body: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                    latest_version(&body).ok_or_else(|| "No OpenCode V1 bootstrap version returned".into())
                }, execute);
            }
        }
        execute(&args).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn numeric_version(text: &str) -> Result<(u64, u64, u64), String> {
    text.split(|c: char| !c.is_ascii_digit() && c != '.')
        .find_map(|part| {
            let mut parts = part.split('.');
            let version = (
                parts.next()?.parse().ok()?,
                parts.next()?.parse().ok()?,
                parts.next()?.parse().ok()?,
            );
            parts.next().is_none().then_some(version)
        })
        .ok_or_else(|| format!("OpenCode reported an invalid version: {}", text.trim()))
}

/// V1 cannot install a V2 target with ordinary upgrade. Bootstrap the migration
/// command if needed, then verify each stage: V1 sometimes exits zero on failure.
fn update_opencode(
    target: &str,
    base_args: &[String],
    installed: &str,
    legacy_release: impl FnOnce() -> Result<String, String>,
    mut execute: impl FnMut(&[String]) -> Result<String, String>,
) -> Result<(), String> {
    let target_version = numeric_version(target)?;
    let mut version = numeric_version(installed)?;
    // Another window may already have updated this CLI since the check.
    if version >= target_version {
        return Ok(());
    }
    let with_target = |target: &str| {
        let mut args = base_args.to_vec();
        args.insert(1, target.to_string());
        args
    };
    if version.0 == 1 && target_version.0 >= 2 {
        if version < (1, 19, 0) {
            let bootstrap = legacy_release()?;
            validate_update_target(&bootstrap)?;
            let expected = numeric_version(&bootstrap)?;
            if expected.0 != 1 || expected < (1, 19, 0) {
                return Err("No OpenCode V1 release supporting migration is available".into());
            }
            execute(&with_target(&bootstrap))?;
            version = numeric_version(&execute(&["--version".into()])?)?;
            if version.0 != 1 || version < (1, 19, 0) {
                return Err("OpenCode V1 bootstrap did not install a migration-capable version. Retry the update.".into());
            }
        }
        let mut args = base_args.to_vec();
        args.push("--major".into());
        execute(&args)?;
        version = numeric_version(&execute(&["--version".into()])?)?;
        if version.0 < 2 {
            return Err("OpenCode migration did not install V2. Check the installation permissions and retry.".into());
        }
        // --major installs latest and ignores target. Keep a newer V2; otherwise
        // finish with the displayed target through V2's own updater.
        if version >= target_version {
            return Ok(());
        }
    }
    execute(&with_target(target)).map(|_| ())
}

fn validate_update_target(target: &str) -> Result<(), String> {
    let version = target.strip_prefix('v').unwrap_or(target);
    if version.len() > 128
        || !version.starts_with(|c: char| c.is_ascii_digit())
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
    {
        return Err("harness_update: invalid target version".to_string());
    }
    Ok(())
}

/// Keep both streams: OpenCode ends with a generic "Failed" after printing the
/// actual package-manager error. Bound the tail sent to the UI.
fn update_failure(stdout: &[u8], stderr: &[u8]) -> String {
    let detail = [stdout, stderr]
        .iter()
        .map(|bytes| {
            String::from_utf8_lossy(bytes)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if detail.is_empty() {
        return "Update failed".to_string();
    }
    let skip = detail.chars().count().saturating_sub(4000);
    detail.chars().skip(skip).collect()
}

fn latest_version(body: &Value) -> Option<String> {
    let version = body.get("version")?.as_str()?.trim();
    (!version.is_empty()).then(|| version.to_string())
}

fn first_line_version(text: &str) -> Option<String> {
    let version = text.lines().next()?.trim();
    version
        .chars()
        .any(|c| c.is_ascii_digit())
        .then(|| version.to_string())
}

/// Reads the build from the download URL the script uses, such as
/// `https://downloads.cursor.com/lab/2026.09.28-64d2043/${OS}/...`.
fn cursor_script_version(script: &str) -> Option<String> {
    const PREFIX: &str = "downloads.cursor.com/lab/";
    let start = script.find(PREFIX)? + PREFIX.len();
    let build = script[start..].split('/').next()?;
    let valid = build.starts_with(|c: char| c.is_ascii_digit())
        && build
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    valid.then(|| build.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_only_harnesses_with_a_release_feed() {
        assert_eq!(
            version_feed("claude"),
            Some(VersionFeed::Npm("@anthropic-ai/claude-code"))
        );
        assert_eq!(
            version_feed("omp"),
            Some(VersionFeed::Npm("@oh-my-pi/pi-coding-agent"))
        );
        assert_eq!(
            version_feed("cursor"),
            Some(VersionFeed::CursorInstallScript)
        );
        assert_eq!(
            version_feed("fx"),
            Some(VersionFeed::Text("https://releases.fx.sh/latest.txt"))
        );
        assert_eq!(version_feed("hermes"), None);
        assert_eq!(version_feed("antigravity"), None);
        assert_eq!(version_feed("../../evil"), None);
    }

    #[test]
    fn every_feed_has_an_updater() {
        for provider in [
            "claude", "codex", "opencode", "pi", "omp", "cursor", "grok", "fx",
        ] {
            assert!(version_feed(provider).is_some(), "{provider} feed");
            assert!(update_args(provider).is_some(), "{provider} updater");
        }
    }

    #[test]
    fn opencode_checks_the_v2_release_channel() {
        assert_eq!(
            version_feed("opencode"),
            Some(VersionFeed::Npm("@opencode/cli"))
        );
    }

    #[test]
    fn opencode_offers_v2_for_both_installed_major_versions() {
        for version in ["1.18.33", "1.19.0"] {
            assert_eq!(
                version_feed_for_installed("opencode", Some(version)),
                Some(VersionFeed::Npm("@opencode/cli"))
            );
        }
        for version in [Some("2.1.4"), None] {
            assert_eq!(
                version_feed_for_installed("opencode", version),
                Some(VersionFeed::Npm("@opencode/cli"))
            );
        }
        assert_eq!(
            version_feed_for_installed("codex", Some("1.0.0")),
            Some(VersionFeed::Npm("@openai/codex"))
        );
    }

    #[test]
    fn migrates_old_v1_through_a_bootstrap_without_downgrading_newer_v2() {
        let mut calls = Vec::new();
        let mut versions = ["1.19.4", "2.1.5"].into_iter();
        update_opencode(
            "2.1.4",
            &["upgrade".into(), "--method".into(), "bun".into()],
            "1.18.33",
            || Ok("1.19.4".into()),
            |args| {
                calls.push(args.to_vec());
                Ok(if args == ["--version"] {
                    versions.next().unwrap().into()
                } else {
                    String::new()
                })
            },
        )
        .unwrap();
        assert_eq!(
            calls,
            vec![
                vec!["upgrade", "1.19.4", "--method", "bun"],
                vec!["--version"],
                vec!["upgrade", "--method", "bun", "--major"],
                vec!["--version"],
            ]
        );
    }

    #[test]
    fn migration_capable_v1_skips_bootstrap_and_finishes_an_older_v2() {
        let mut calls = Vec::new();
        update_opencode(
            "2.1.4",
            &["upgrade".into()],
            "1.19.0",
            || panic!("unnecessary bootstrap"),
            |args| {
                calls.push(args.to_vec());
                Ok(if args == ["--version"] {
                    "opencode v2.1.3".into()
                } else {
                    String::new()
                })
            },
        )
        .unwrap();
        assert_eq!(
            calls,
            vec![
                vec!["upgrade", "--major"],
                vec!["--version"],
                vec!["upgrade", "2.1.4"]
            ]
        );
    }

    #[test]
    fn v2_updates_use_the_pinned_target_without_major_migration() {
        let mut calls = Vec::new();
        update_opencode(
            "2.1.4",
            &["upgrade".into()],
            "opencode v2.1.3",
            || panic!("unnecessary bootstrap"),
            |args| {
                calls.push(args.to_vec());
                Ok(String::new())
            },
        )
        .unwrap();
        assert_eq!(calls, vec![vec!["upgrade", "2.1.4"]]);
    }

    #[test]
    fn stale_update_targets_do_not_downgrade_an_existing_v2() {
        update_opencode(
            "2.1.4",
            &["upgrade".into()],
            "opencode v2.1.5",
            || panic!("unnecessary bootstrap"),
            |_| panic!("a newer installed version must not be changed"),
        )
        .unwrap();
    }

    #[test]
    fn migration_stops_when_bootstrap_or_major_update_silently_fails() {
        for installed in ["1.18.33", "1.19.4"] {
            let mut calls = Vec::new();
            let result = update_opencode(
                "2.1.4",
                &["upgrade".into()],
                installed,
                || Ok("1.19.4".into()),
                |args| {
                    calls.push(args.to_vec());
                    Ok(if args == ["--version"] {
                        installed.into()
                    } else {
                        "Upgrade failed".into()
                    })
                },
            );
            assert!(result.is_err());
            assert_eq!(calls.len(), 2);
        }
    }

    #[test]
    fn updates_only_through_each_cli_own_updater() {
        assert_eq!(update_args("pi"), Some(&["update", "--self"][..]));
        assert_eq!(update_args("opencode"), Some(&["upgrade"][..]));
        assert_eq!(update_args("fx"), Some(&["upgrade"][..]));
        assert_eq!(update_args("cursor"), Some(&["update"][..]));
        assert_eq!(update_args("hermes"), None);
    }

    #[test]
    fn opencode_bun_installs_skip_package_manager_autodetection() {
        for command in [
            r"C:\Users\owner\.bun\bin\opencode.exe",
            "/home/owner/.bun/install/global/node_modules/@opencode/cli/bin/opencode",
        ] {
            assert_eq!(
                update_args_for_command("opencode", command),
                Some(&["upgrade", "--method", "bun"][..])
            );
        }
        assert_eq!(
            update_args_for_command("opencode", "/usr/local/bin/opencode"),
            Some(&["upgrade"][..])
        );
        assert_eq!(
            update_args_for_command("claude", "/home/owner/.bun/bin/claude"),
            Some(&["update"][..])
        );
    }

    #[test]
    fn preserves_updater_diagnostics_before_the_generic_footer() {
        assert_eq!(
            update_failure(
                b"checking\n",
                b"npm ERR! code EACCES\nnpm ERR! permission denied\n\n"
            ),
            "checking\nnpm ERR! code EACCES\nnpm ERR! permission denied"
        );
        assert_eq!(update_failure(b"no write access\n", b""), "no write access");
        assert_eq!(update_failure(b"", b""), "Update failed");
        assert_eq!(
            update_failure(
                b"Upgrade failed for bun\nAccess denied: opencode.exe\nFailed\n",
                b""
            ),
            "Upgrade failed for bun\nAccess denied: opencode.exe\nFailed"
        );
        let long = "é".repeat(5000);
        assert_eq!(update_failure(long.as_bytes(), b"").chars().count(), 4000);
    }

    #[test]
    fn npm_global_binary_layout_preserves_the_install_prefix() {
        use std::path::Path;
        for binary in [
            "/Users/owner/.local/lib/node_modules/opencode-ai/bin/opencode.exe",
            "/Users/owner/.local/lib/node_modules/@opencode/cli/bin/opencode",
        ] {
            assert_eq!(
                opencode_npm_prefix(Path::new(binary)),
                Some(Path::new("/Users/owner/.local"))
            );
        }
        for binary in [
            "/Users/owner/.local/bin/opencode",
            "/Users/owner/.bun/install/global/node_modules/@opencode/cli/bin/opencode",
            "/project/node_modules/opencode-ai/bin/opencode",
            "/opt/lib/node_modules/other-cli/bin/opencode",
        ] {
            assert_eq!(opencode_npm_prefix(Path::new(binary)), None);
        }
    }

    #[test]
    fn update_targets_cannot_be_options_or_commands() {
        for target in ["1.19.4", "v2.1.4", "2.1.4-beta.1+build"] {
            assert!(validate_update_target(target).is_ok());
        }
        for target in ["", "--major", "latest", "2.1.4; echo bad", "../2.1.4"] {
            assert!(validate_update_target(target).is_err());
        }
    }

    #[test]
    fn reads_version_from_registry_payload() {
        assert_eq!(
            latest_version(&json!({ "name": "@opencode/cli", "version": "2.0.26" })),
            Some("2.0.26".to_string())
        );
        assert_eq!(latest_version(&json!({ "version": " " })), None);
        assert_eq!(latest_version(&json!({})), None);
    }

    #[test]
    fn reads_version_from_a_text_feed() {
        assert_eq!(first_line_version("1.0.46\n"), Some("1.0.46".to_string()));
        assert_eq!(first_line_version("v0.0.12"), Some("v0.0.12".to_string()));
        assert_eq!(first_line_version("<html>"), None);
        assert_eq!(first_line_version(""), None);
    }

    #[test]
    fn reads_build_from_cursor_install_script() {
        let script = "TEMP=x\nDOWNLOAD_URL=\"https://downloads.cursor.com/lab/2026.09.28-64d2043/${OS}/${ARCH}/agent-cli-package.tar.gz\"\n";
        assert_eq!(
            cursor_script_version(script),
            Some("2026.09.28-64d2043".to_string())
        );
        assert_eq!(cursor_script_version("echo no download here"), None);
        assert_eq!(
            cursor_script_version("downloads.cursor.com/lab/$(evil)/x"),
            None
        );
    }
}
