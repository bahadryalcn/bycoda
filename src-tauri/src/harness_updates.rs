use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::Value;

use crate::harness::process_lifecycle::ProcessOwner;
use crate::harness::{
    exec_output_with_env_observed, is_resolved_harness_binary, resolve_gui_binary,
};

/// Returned when another update of the same binary is already running, in any window.
pub(crate) const ALREADY_UPDATING: &str = "harness_update: already updating";
/// Returned when the user cancelled the update before it finished.
pub(crate) const CANCELLED: &str = "harness_update: cancelled";

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

/// The default updater for installations without a known package manager.
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
fn unix_npm_prefix<'a>(binary: &'a Path, provider: &str) -> Option<&'a Path> {
    let bin = binary.parent()?;
    if bin.file_name()? != "bin" {
        return None;
    }
    let package = bin.parent()?;
    let modules = match provider {
        "codex" if package.ends_with("@openai/codex") && binary.file_name()? == "codex.js" => {
            package.parent()?.parent()?
        }
        "opencode" if package.file_name()? == "opencode-ai" => package.parent()?,
        "opencode" if package.ends_with("@opencode/cli") => package.parent()?.parent()?,
        _ => return None,
    };
    if modules.file_name()? != "node_modules" || modules.parent()?.file_name()? != "lib" {
        return None;
    }
    modules.parent()?.parent()
}

#[derive(Debug, PartialEq, Eq)]
enum CodexPackage<'a> {
    Npm(&'a Path),
    Homebrew(&'a Path),
}

fn codex_package<'a>(command: &'a Path, resolved: &'a Path) -> Option<CodexPackage<'a>> {
    if let Some(prefix) = unix_npm_prefix(resolved, "codex") {
        return Some(CodexPackage::Npm(prefix));
    }
    // npm installs its Windows launcher beside node_modules, without a symlink.
    if command.file_name()?.eq_ignore_ascii_case("codex.cmd") {
        let prefix = command.parent()?;
        let entry = "node_modules/@openai/codex/bin/codex.js";
        if prefix.join(entry).is_file()
            && std::fs::read_to_string(command)
                .is_ok_and(|shim| shim.replace('\\', "/").contains(entry))
        {
            return Some(CodexPackage::Npm(prefix));
        }
    }
    let cask = resolved
        .ancestors()
        .find(|path| path.ends_with("Caskroom/codex"))?;
    Some(CodexPackage::Homebrew(cask.parent()?.parent()?))
}

impl CodexPackage<'_> {
    fn updater(&self) -> Result<(PathBuf, &'static [&'static str]), String> {
        match self {
            Self::Npm(_) => {
                let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
                let path = resolve_gui_binary(npm)
                    .filter(|path| path.is_absolute())
                    .ok_or(
                    "npm was not found. Update Codex with the npm installation that owns this CLI.",
                )?;
                Ok((path, &["install", "--global", "@openai/codex@latest"]))
            }
            Self::Homebrew(prefix) => {
                let brew = prefix.join("bin/brew");
                if !brew.is_file() {
                    return Err("Homebrew was not found for this Codex installation. Update the Codex cask from your terminal.".into());
                }
                Ok((brew, &["upgrade", "--cask", "codex"]))
            }
        }
    }
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

/// The updates running now, keyed by resolved binary, so a second window or
/// a double click joins the refusal instead of starting a second package
/// manager on the same install.
static IN_FLIGHT: Mutex<BTreeMap<String, Arc<UpdateSlot>>> = Mutex::new(BTreeMap::new());

fn in_flight() -> MutexGuard<'static, BTreeMap<String, Arc<UpdateSlot>>> {
    IN_FLIGHT.lock().unwrap_or_else(|error| error.into_inner())
}

fn update_key(command: &str) -> String {
    let path = std::fs::canonicalize(command).unwrap_or_else(|_| PathBuf::from(command));
    let key = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        key.to_ascii_lowercase()
    } else {
        key
    }
}

#[derive(Default)]
struct UpdateSlot {
    cancelled: AtomicBool,
    /// The updater process currently running for this binary, if any.
    owner: Mutex<Option<Arc<ProcessOwner>>>,
}

impl UpdateSlot {
    fn attach(&self, owner: Arc<ProcessOwner>) {
        *self.owner.lock().unwrap_or_else(|error| error.into_inner()) = Some(owner.clone());
        // A cancel that arrived between spawn and attach must still stop it.
        if self.cancelled.load(Ordering::SeqCst) {
            let _ = owner.request_stop();
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let owner = self
            .owner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(owner) = owner {
            // Stopping a finished process is a no-op, so a late cancel is harmless.
            let _ = owner.request_stop();
        }
    }
}

/// Holds the binary's slot for one update. Dropping it, on success, error or
/// panic, frees the binary for the next update.
struct UpdateClaim {
    key: String,
    slot: Arc<UpdateSlot>,
}

impl Drop for UpdateClaim {
    fn drop(&mut self) {
        let mut map = in_flight();
        if map
            .get(&self.key)
            .is_some_and(|slot| Arc::ptr_eq(slot, &self.slot))
        {
            map.remove(&self.key);
        }
    }
}

fn claim_update(command: &str) -> Result<UpdateClaim, String> {
    let key = update_key(command);
    let mut map = in_flight();
    if map.contains_key(&key) {
        return Err(ALREADY_UPDATING.to_string());
    }
    let slot = Arc::new(UpdateSlot::default());
    map.insert(key.clone(), slot.clone());
    Ok(UpdateClaim { key, slot })
}

/// Stops the update of `command` that is running now. Returns false when no
/// update of that binary is in flight, including during the version check and
/// catalog refresh that follow the updater.
#[tauri::command]
pub fn harness_update_cancel(command: String) -> bool {
    let slot = in_flight().get(&update_key(&command)).cloned();
    let Some(slot) = slot else {
        return false;
    };
    slot.cancel();
    true
}

/// Updates the installation containing the resolved binary with stdin closed.
#[tauri::command]
pub async fn harness_update(
    command: String,
    binary_provider: String,
    binary_path: Option<String>,
    target_version: Option<String>,
) -> Result<String, String> {
    let args: Vec<String> = update_args_for_command(&binary_provider, &command)
        .ok_or_else(|| format!("No updater for harness: {binary_provider}"))?
        .iter()
        .map(|arg| arg.to_string())
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        if !is_resolved_harness_binary(&command, Some(&binary_provider), binary_path.as_deref()) {
            return Err("harness_update: not a resolved harness CLI".to_string());
        }
        let claim = claim_update(&command)?;
        let resolved = std::fs::canonicalize(&command).ok();
        let codex = (binary_provider == "codex")
            .then(|| codex_package(Path::new(&command), resolved.as_deref()?))
            .flatten();
        let npm_prefix = (binary_provider == "opencode")
            .then(|| unix_npm_prefix(resolved.as_deref()?, "opencode"))
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
        let execute = |program: &str, args: &[String], prefix: Option<&str>, cwd: Option<&Path>| {
            if claim.slot.cancelled.load(Ordering::SeqCst) {
                return Err(CANCELLED.to_string());
            }
            let env = prefix.map(|prefix| [("NPM_CONFIG_PREFIX", prefix)]);
            let output = exec_output_with_env_observed(
                program,
                args,
                UPDATE_TIMEOUT,
                env.as_slice().as_flattened(),
                cwd,
                |owner| claim.slot.attach(owner),
            );
            if claim.slot.cancelled.load(Ordering::SeqCst) {
                return Err(CANCELLED.to_string());
            }
            let output = output?;
            if output.status.success() && args == ["--version"] {
                return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
            }
            let detail = update_detail(&output.stdout, &output.stderr);
            if output.status.success() {
                return Ok(detail);
            }
            let detail = if detail.is_empty() { "Update failed" } else { &detail };
            let guidance = update_guidance(&binary_provider, codex.is_some(), detail);
            Err(format!(
                "{binary_provider} update failed ({}):\n{detail}{guidance}",
                output.status
            ))
        };
        if let Some(package) = &codex {
            let (program, args) = package.updater()?;
            let prefix = match package {
                CodexPackage::Npm(prefix) => Some(prefix.to_string_lossy()),
                CodexPackage::Homebrew(_) => None,
            };
            // Package managers can read config from the working directory.
            let cwd = program.ancestors().last().filter(|path| path.has_root());
            let args = args.iter().map(ToString::to_string).collect::<Vec<_>>();
            return execute(&program.to_string_lossy(), &args, prefix.as_deref(), cwd);
        }
        let execute = |args: &[String]| execute(&command, args, npm_prefix.as_deref(), None);
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
        execute(&args)
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
) -> Result<String, String> {
    let target_version = numeric_version(target)?;
    let mut version = numeric_version(installed)?;
    // Another window may already have updated this CLI since the check.
    if version >= target_version {
        return Ok(String::new());
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
            let detail = execute(&with_target(&bootstrap))?;
            version = numeric_version(&execute(&["--version".into()])?)?;
            if version.0 != 1 || version < (1, 19, 0) {
                return Err(format!("OpenCode V1 bootstrap did not install a migration-capable version. Retry the update.\n{detail}"));
            }
        }
        let mut args = base_args.to_vec();
        args.push("--major".into());
        let detail = execute(&args)?;
        version = numeric_version(&execute(&["--version".into()])?)?;
        if version.0 < 2 {
            return Err(format!("OpenCode migration did not install V2. Check the installation permissions and retry.\n{detail}"));
        }
        // --major installs latest and ignores target. Keep a newer V2; otherwise
        // finish with the displayed target through V2's own updater.
        if version >= target_version {
            return Ok(detail);
        }
    }
    execute(&with_target(target))
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
fn update_detail(stdout: &[u8], stderr: &[u8]) -> String {
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
    let skip = detail.chars().count().saturating_sub(4000);
    detail.chars().skip(skip).collect()
}

fn update_guidance(provider: &str, codex_package: bool, detail: &str) -> &'static str {
    match provider {
        "codex" if !codex_package => {
            "\nUpdate the Codex CLI using the method that installed it, then check its version in Bycoda."
        }
        "cursor" if matches!(detail, "Checking for updates..." | "Update failed") => {
            "\nCursor CLI did not report a cause. Run agent update (or cursor-agent update) in a terminal for this installation, then check its version in Bycoda."
        }
        _ => "",
    }
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
    fn default_cli_updater_arguments() {
        assert_eq!(update_args("pi"), Some(&["update", "--self"][..]));
        assert_eq!(update_args("opencode"), Some(&["upgrade"][..]));
        assert_eq!(update_args("fx"), Some(&["upgrade"][..]));
        assert_eq!(update_args("cursor"), Some(&["update"][..]));
        assert_eq!(update_args("hermes"), None);
    }

    #[test]
    fn detects_the_installers_that_can_update_legacy_codex_without_loading_its_config() {
        let npm = Path::new("/opt/node/lib/node_modules/@openai/codex/bin/codex.js");
        let brew = Path::new("/opt/homebrew/Caskroom/codex/0.36.0/codex-aarch64-apple-darwin");
        assert_eq!(
            codex_package(npm, npm),
            Some(CodexPackage::Npm(Path::new("/opt/node")))
        );
        assert_eq!(
            codex_package(Path::new("/opt/homebrew/bin/codex"), brew),
            Some(CodexPackage::Homebrew(Path::new("/opt/homebrew")))
        );
        let project = Path::new("/repo/node_modules/@openai/codex/bin/codex.js");
        assert_eq!(codex_package(project, project), None);
        let standalone = Path::new("/opt/bin/codex");
        assert_eq!(codex_package(standalone, standalone), None);
    }

    #[test]
    fn identifies_windows_npm_install_by_its_launcher_and_package() {
        let prefix = tempfile::tempdir().unwrap();
        let bin = prefix.path().join("node_modules/@openai/codex/bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("codex.js"), "").unwrap();
        let shim = prefix.path().join("codex.cmd");
        std::fs::write(&shim, "@echo off").unwrap();
        assert_eq!(codex_package(&shim, &shim), None);
        std::fs::write(
            &shim,
            r#""%dp0%\node_modules\@openai\codex\bin\codex.js" %*"#,
        )
        .unwrap();
        assert_eq!(
            codex_package(&shim, &shim),
            Some(CodexPackage::Npm(prefix.path()))
        );
    }

    #[test]
    fn cursor_failure_without_a_cause_suggests_a_terminal_retry() {
        let only_progress = update_detail(b"Checking for updates...\n", b"");
        assert!(update_guidance("cursor", false, &only_progress).contains("agent update"));
        let actionable = update_detail(b"Checking for updates...\n", b"Permission denied");
        assert_eq!(update_guidance("cursor", false, &actionable), "");
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
            update_detail(
                b"checking\n",
                b"npm ERR! code EACCES\nnpm ERR! permission denied\n\n"
            ),
            "checking\nnpm ERR! code EACCES\nnpm ERR! permission denied"
        );
        assert_eq!(update_detail(b"no write access\n", b""), "no write access");
        assert!(update_detail(b"", b"").is_empty());
        assert_eq!(
            update_detail(
                b"Upgrade failed for bun\nAccess denied: opencode.exe\nFailed\n",
                b""
            ),
            "Upgrade failed for bun\nAccess denied: opencode.exe\nFailed"
        );
        let long = "é".repeat(5000);
        assert_eq!(update_detail(long.as_bytes(), b"").chars().count(), 4000);
    }

    #[test]
    fn npm_global_binary_layout_preserves_the_install_prefix() {
        use std::path::Path;
        for binary in [
            "/Users/owner/.local/lib/node_modules/opencode-ai/bin/opencode.exe",
            "/Users/owner/.local/lib/node_modules/@opencode/cli/bin/opencode",
        ] {
            assert_eq!(
                unix_npm_prefix(Path::new(binary), "opencode"),
                Some(Path::new("/Users/owner/.local"))
            );
        }
        for binary in [
            "/Users/owner/.local/bin/opencode",
            "/Users/owner/.bun/install/global/node_modules/@opencode/cli/bin/opencode",
            "/project/node_modules/opencode-ai/bin/opencode",
            "/opt/lib/node_modules/other-cli/bin/opencode",
        ] {
            assert_eq!(unix_npm_prefix(Path::new(binary), "opencode"), None);
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
    fn a_second_update_of_the_same_binary_is_refused_until_the_first_ends() {
        let binary = "harness-updates-test/single-flight/opencode";
        let first = claim_update(binary).unwrap();
        assert_eq!(
            claim_update(binary).err().as_deref(),
            Some(ALREADY_UPDATING)
        );
        drop(first);
        assert!(claim_update(binary).is_ok());
    }

    #[test]
    fn different_binaries_update_independently() {
        let first = claim_update("harness-updates-test/independent/claude").unwrap();
        let second = claim_update("harness-updates-test/independent/codex");
        assert!(second.is_ok());
        drop(first);
    }

    #[test]
    fn cancel_reports_only_an_update_that_is_running() {
        let binary = "harness-updates-test/cancel/grok";
        assert!(!harness_update_cancel(binary.to_string()));
        let claim = claim_update(binary).unwrap();
        assert!(harness_update_cancel(binary.to_string()));
        assert!(claim.slot.cancelled.load(Ordering::SeqCst));
        drop(claim);
        assert!(!harness_update_cancel(binary.to_string()));
    }

    #[test]
    fn a_cancelled_slot_is_released_so_the_next_update_can_run() {
        let binary = "harness-updates-test/cancel-release/fx";
        let claim = claim_update(binary).unwrap();
        harness_update_cancel(binary.to_string());
        drop(claim);
        assert!(claim_update(binary).is_ok());
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
