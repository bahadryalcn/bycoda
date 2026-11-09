//! Desktop-side GitHub CLI: a gh already on this computer wins, otherwise a pinned official
//! copy is installed once under the Host data folder (the same layout host/git/gh-runtime.ts
//! reads, so the Host and the desktop share one managed copy).
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Pinned GitHub CLI release. host/git/gh-runtime.ts must carry the same value (tested below).
pub(crate) const GH_CLI_VERSION: &str = "2.103.2";
const RELEASE_URL: &str = "https://github.com/cli/cli/releases/download";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(120);
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_CHECKSUMS_BYTES: u64 = 256 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatus {
    pub connected: bool,
    pub installed: bool,
    pub authenticated: bool,
    /// The pinned copy is downloading or being verified right now.
    pub installing: bool,
    /// Set only when the last automatic install failed; the UI offers a retry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_error: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Asset {
    pub file: String,
    /// Binary path inside the archive.
    pub entry: Vec<String>,
}

/// Release asset for an OS and architecture as Rust names them (`std::env::consts`).
pub(crate) fn asset_for(version: &str, os: &str, arch: &str) -> Option<Asset> {
    let (name, cpu, platform) = match (os, arch) {
        ("windows", "x86_64") => ("windows", "amd64", "win32"),
        ("windows", "aarch64") => ("windows", "arm64", "win32"),
        ("macos", "x86_64") => ("macOS", "amd64", "darwin"),
        ("macos", "aarch64") => ("macOS", "arm64", "darwin"),
        ("linux", "x86_64") => ("linux", "amd64", "linux"),
        ("linux", "aarch64") => ("linux", "arm64", "linux"),
        _ => return None,
    };
    let stem = format!("gh_{version}_{name}_{cpu}");
    Some(if platform == "win32" {
        Asset {
            file: format!("{stem}.zip"),
            entry: vec!["bin".into(), "gh.exe".into()],
        }
    } else {
        Asset {
            file: format!(
                "{stem}.{}",
                if platform == "darwin" {
                    "zip"
                } else {
                    "tar.gz"
                }
            ),
            entry: vec![stem, "bin".into(), "gh".into()],
        }
    })
}

/// Lookup in `gh_<version>_checksums.txt` lines of the form "<sha256>  <file>".
pub(crate) fn checksum_for(checksums: &str, file: &str) -> Option<String> {
    checksums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let digest = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == file && digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| digest.to_ascii_lowercase())
    })
}

fn managed_directory(base: &Path) -> PathBuf {
    base.join("tools").join(format!("gh-{GH_CLI_VERSION}"))
}

/// The managed binary, only when its install marker names the pinned version.
fn managed_program(base: &Path) -> Option<PathBuf> {
    let asset = asset_for(GH_CLI_VERSION, std::env::consts::OS, std::env::consts::ARCH)?;
    let directory = managed_directory(base);
    let marker = std::fs::read_to_string(directory.join(".install-complete")).ok()?;
    if marker.trim() != GH_CLI_VERSION {
        return None;
    }
    let binary = asset
        .entry
        .iter()
        .fold(directory, |path, part| path.join(part));
    binary.is_file().then_some(binary)
}

fn host_base() -> Option<PathBuf> {
    crate::bundled_host::native_authority_profile()
}

/// PATH and the GUI search path first, then the managed copy. None means nothing usable.
fn installed_program() -> Option<PathBuf> {
    crate::harness::resolve_gui_binary("gh").or_else(|| managed_program(&host_base()?))
}

struct InstallState {
    running: bool,
    error: Option<String>,
}

static INSTALL: Mutex<InstallState> = Mutex::new(InstallState {
    running: false,
    error: None,
});

fn install_state() -> std::sync::MutexGuard<'static, InstallState> {
    INSTALL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts the one-time background install unless one is running or gh is already usable.
fn start_install() {
    let Some(base) = host_base() else {
        install_state().error = Some("The bycoda data folder is unavailable.".into());
        return;
    };
    {
        let mut state = install_state();
        if state.running {
            return;
        }
        state.running = true;
        state.error = None;
    }
    let spawned = std::thread::Builder::new()
        .name("github-cli-install".into())
        .spawn(move || {
            let result = install(&base);
            let mut state = install_state();
            state.running = false;
            state.error = result.err();
        });
    if let Err(error) = spawned {
        let mut state = install_state();
        state.running = false;
        state.error = Some(format!("GitHub CLI installer could not start: {error}"));
    }
}

/// The gh program for a GitHub call. While it is missing this starts the install and
/// returns the retryable state, never a dead end.
pub(crate) fn gh_program() -> Result<PathBuf, String> {
    if let Some(program) = installed_program() {
        return Ok(program);
    }
    start_install();
    let state = install_state();
    if state.running {
        Err("GitHub CLI is being installed for bycoda. Try again shortly.".into())
    } else {
        Err(state.error.clone().unwrap_or_else(|| {
            "GitHub CLI could not be set up automatically. Check your internet connection and try again."
                .into()
        }))
    }
}

pub(crate) async fn status() -> Result<GitHubStatus, String> {
    tauri::async_runtime::spawn_blocking(status_for)
        .await
        .map_err(|error| error.to_string())
}

fn status_for() -> GitHubStatus {
    let Some(program) = installed_program() else {
        start_install();
        let state = install_state();
        return GitHubStatus {
            connected: false,
            installed: false,
            authenticated: false,
            installing: state.running,
            install_error: state.error.clone(),
        };
    };
    let mut cmd = Command::new(program);
    cmd.args(["auth", "status", "--active", "--hostname", "github.com"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat");
    crate::harness::apply_gui_env(&mut cmd);
    crate::hide_window_console(&mut cmd);
    let authenticated = crate::fs::output_with_timeout(&mut cmd, PROBE_TIMEOUT)
        .map(|output| output.status.success())
        .unwrap_or(false);
    GitHubStatus {
        connected: authenticated,
        installed: true,
        authenticated,
        installing: false,
        install_error: None,
    }
}

fn fetch(url: &str, limit: u64) -> Result<Vec<u8>, String> {
    let response = ureq::get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .call()
        .map_err(|_| {
            "GitHub CLI could not be downloaded. Check your internet connection.".to_string()
        })?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "GitHub CLI download was interrupted. Try again.".to_string())?;
    if bytes.len() as u64 > limit {
        return Err("GitHub CLI download is too large. Try again.".into());
    }
    Ok(bytes)
}

fn install(base: &Path) -> Result<PathBuf, String> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let asset = asset_for(GH_CLI_VERSION, os, arch).ok_or_else(|| {
        format!("GitHub CLI is not published for {os}-{arch}. Install it from cli.github.com.")
    })?;
    let checksums = fetch(
        &format!("{RELEASE_URL}/v{GH_CLI_VERSION}/gh_{GH_CLI_VERSION}_checksums.txt"),
        MAX_CHECKSUMS_BYTES,
    )?;
    let expected = checksum_for(&String::from_utf8_lossy(&checksums), &asset.file)
        .ok_or("GitHub CLI release checksums are unavailable. Try again.")?;
    let archive = fetch(
        &format!("{RELEASE_URL}/v{GH_CLI_VERSION}/{}", asset.file),
        MAX_ARCHIVE_BYTES,
    )?;
    if format!("{:x}", Sha256::digest(&archive)) != expected {
        return Err("GitHub CLI download verification failed. Try again.".into());
    }
    let tools = base.join("tools");
    std::fs::create_dir_all(&tools).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_nanos())
        .unwrap_or_default();
    let stage = tools.join(format!(
        "gh-{GH_CLI_VERSION}.stage-{}-{stamp}",
        std::process::id()
    ));
    std::fs::create_dir_all(&stage).map_err(|error| error.to_string())?;
    let result = install_into(&stage, base, &asset, &archive);
    let _ = std::fs::remove_dir_all(&stage);
    result
}

fn install_into(
    stage: &Path,
    base: &Path,
    asset: &Asset,
    archive: &[u8],
) -> Result<PathBuf, String> {
    let archive_path = stage.join(&asset.file);
    std::fs::write(&archive_path, archive).map_err(|error| error.to_string())?;
    let member = asset.entry.join("/");
    let flags = if asset.file.ends_with(".zip") {
        "-xf"
    } else {
        "-xzf"
    };
    let mut tar = Command::new(tar_program());
    tar.arg(flags)
        .arg(&archive_path)
        .arg("-C")
        .arg(stage)
        .arg(&member);
    crate::hide_window_console(&mut tar);
    let extracted = crate::fs::output_with_timeout(&mut tar, EXTRACT_TIMEOUT)
        .map_err(|_| "GitHub CLI could not be unpacked. Try again.".to_string())?;
    if !extracted.status.success() {
        return Err("GitHub CLI could not be unpacked. Try again.".into());
    }
    let _ = std::fs::remove_file(&archive_path);
    let binary = asset
        .entry
        .iter()
        .fold(stage.to_path_buf(), |path, part| path.join(part));
    if !binary.is_file() {
        return Err("GitHub CLI installation is incomplete.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }
    let mut version = Command::new(&binary);
    version.arg("--version");
    crate::hide_window_console(&mut version);
    let reported = crate::fs::output_with_timeout(&mut version, PROBE_TIMEOUT)
        .map_err(|_| "GitHub CLI installation is incomplete.".to_string())?;
    let text = String::from_utf8_lossy(&reported.stdout);
    if !text
        .trim_start()
        .starts_with(&format!("gh version {GH_CLI_VERSION} "))
    {
        return Err("GitHub CLI installation is incomplete.".into());
    }
    write_synced(&stage.join(".install-complete"), GH_CLI_VERSION.as_bytes())
        .map_err(|error| error.to_string())?;
    let directory = managed_directory(base);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_nanos())
        .unwrap_or_default();
    let previous = directory.with_file_name(format!("gh-{GH_CLI_VERSION}.previous-{stamp}"));
    if directory.exists() {
        // ast-grep-ignore: rust-rename-without-fsync -- moves the previous install aside; the staged marker is synced above and a missing marker reads as not installed
        std::fs::rename(&directory, &previous).map_err(|error| error.to_string())?;
    }
    // ast-grep-ignore: rust-rename-without-fsync -- publishes the staged install whose marker is synced above; an unfinished rename leaves no marker, so it reads as not installed
    if let Err(error) = std::fs::rename(stage, &directory) {
        // Another installer (the Host) may have completed the same version first.
        if managed_program(base).is_none() {
            return Err(error.to_string());
        }
    }
    let _ = std::fs::remove_dir_all(&previous);
    managed_program(base).ok_or_else(|| "GitHub CLI installation is incomplete.".to_string())
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::File::create(path).map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn tar_program() -> PathBuf {
    if cfg!(windows) {
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        PathBuf::from(root).join("System32").join("tar.exe")
    } else {
        PathBuf::from("tar")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_RUNTIME: &str = include_str!("../../host/git/gh-runtime.ts");

    #[test]
    fn pinned_version_matches_the_host_runtime() {
        assert!(
            TS_RUNTIME.contains(&format!(
                "export const GH_CLI_VERSION = \"{GH_CLI_VERSION}\";"
            )),
            "host/git/gh-runtime.ts must pin the same GitHub CLI version"
        );
    }

    #[test]
    fn maps_the_six_supported_targets_to_official_assets() {
        let v = GH_CLI_VERSION;
        let bin = |stem: String| vec![stem, "bin".to_string(), "gh".to_string()];
        let cases: Vec<(&str, &str, String, Vec<String>)> = vec![
            (
                "windows",
                "x86_64",
                format!("gh_{v}_windows_amd64.zip"),
                vec!["bin".into(), "gh.exe".into()],
            ),
            (
                "windows",
                "aarch64",
                format!("gh_{v}_windows_arm64.zip"),
                vec!["bin".into(), "gh.exe".into()],
            ),
            (
                "macos",
                "x86_64",
                format!("gh_{v}_macOS_amd64.zip"),
                bin(format!("gh_{v}_macOS_amd64")),
            ),
            (
                "macos",
                "aarch64",
                format!("gh_{v}_macOS_arm64.zip"),
                bin(format!("gh_{v}_macOS_arm64")),
            ),
            (
                "linux",
                "x86_64",
                format!("gh_{v}_linux_amd64.tar.gz"),
                bin(format!("gh_{v}_linux_amd64")),
            ),
            (
                "linux",
                "aarch64",
                format!("gh_{v}_linux_arm64.tar.gz"),
                bin(format!("gh_{v}_linux_arm64")),
            ),
        ];
        for (os, arch, file, entry) in cases {
            assert_eq!(
                asset_for(v, os, arch),
                Some(Asset { file, entry }),
                "{os}-{arch}"
            );
        }
        assert_eq!(asset_for(v, "linux", "x86"), None);
        assert_eq!(asset_for(v, "freebsd", "x86_64"), None);
    }

    #[test]
    fn reads_the_checksum_for_one_asset_only() {
        let text = format!(
            "{}  gh_2.103.2_linux_amd64.tar.gz\n{} *gh_2.103.2_windows_amd64.zip\nnot-a-sum  x\n",
            "a".repeat(64),
            "B".repeat(64)
        );
        assert_eq!(
            checksum_for(&text, "gh_2.103.2_linux_amd64.tar.gz"),
            Some("a".repeat(64))
        );
        assert_eq!(
            checksum_for(&text, "gh_2.103.2_windows_amd64.zip"),
            Some("b".repeat(64))
        );
        assert_eq!(checksum_for(&text, "gh_2.103.2_macOS_arm64.zip"), None);
    }

    #[test]
    fn managed_copy_counts_only_with_the_pinned_marker_and_binary() {
        let base = std::env::temp_dir().join(format!("bycoda-gh-managed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let asset = asset_for(GH_CLI_VERSION, std::env::consts::OS, std::env::consts::ARCH);
        let Some(asset) = asset else { return };
        let directory = managed_directory(&base);
        std::fs::create_dir_all(&directory).unwrap();
        let binary = asset
            .entry
            .iter()
            .fold(directory.clone(), |p, part| p.join(part));
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, b"gh").unwrap();
        assert_eq!(managed_program(&base), None, "no marker yet");
        std::fs::write(directory.join(".install-complete"), "2.0.0").unwrap();
        assert_eq!(managed_program(&base), None, "other version");
        std::fs::write(directory.join(".install-complete"), GH_CLI_VERSION).unwrap();
        assert_eq!(managed_program(&base), Some(binary));
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Opt-in network smoke test: downloads, verifies and runs the pinned release.
    #[test]
    #[ignore = "network: downloads the pinned GitHub CLI release"]
    fn installs_and_runs_the_pinned_copy() {
        let base = std::env::temp_dir().join(format!("bycoda-gh-smoke-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let program = install(&base).expect("install the pinned GitHub CLI");
        assert_eq!(managed_program(&base), Some(program.clone()));
        let mut version = Command::new(&program);
        version.arg("--version");
        let output = crate::fs::output_with_timeout(&mut version, PROBE_TIMEOUT).unwrap();
        assert!(String::from_utf8_lossy(&output.stdout)
            .starts_with(&format!("gh version {GH_CLI_VERSION} ")));
        let _ = std::fs::remove_dir_all(&base);
    }
}
