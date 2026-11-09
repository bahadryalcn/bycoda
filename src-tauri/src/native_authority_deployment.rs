//! Native-owned local CLI provisioning. This writes only a transport locator;
//! it is not an actor grant or runtime authentication receipt.
#![allow(dead_code)]

use crate::native_authority_bootstrap::HostBootstrap;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const MAX_INPUT: usize = 8192;
const MAX_OUTPUT: usize = 8192;
const MAX_EXECUTABLE: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeploymentError {
    Unavailable,
    InvalidReceipt,
    Cancelled,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    version: u8,
    deployment_id: String,
    generation: String,
    qualified: bool,
}

const CACHE_FILE: &str = "native-authority-deployment-cache.json";

#[derive(Deserialize, Serialize)]
struct FingerprintCache {
    executable: std::path::PathBuf,
    size: u64,
    modified: (u64, u32),
    sha256: String,
    provisioned: Option<(String, String)>,
}

fn read_cache(profile: &Path) -> Option<FingerprintCache> {
    let path = profile.join(CACHE_FILE);
    if std::fs::metadata(&path).ok()?.len() > 16 * 1024 {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn save_cache(profile: &Path, cache: &FingerprintCache) {
    // This is only an optimization; a partial/missing cache is a cache miss.
    if let Ok(bytes) = serde_json::to_vec(cache) {
        let _ = std::fs::write(profile.join(CACHE_FILE), bytes);
    }
}

pub(crate) fn invalidate_cached_provision(profile: &Path) {
    let _ = std::fs::remove_file(profile.join(CACHE_FILE));
}

fn deployment_digest(host: &HostBootstrap, source_profile_id: &str) -> Option<String> {
    let id = uuid::Uuid::parse_str(source_profile_id).ok()?;
    let path = host
        .directory()
        .join("native-authority")
        .join("deployments")
        .join(format!("{id}.json"));
    if std::fs::metadata(&path).ok()?.len() > MAX_INPUT as u64 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(std::fs::read(path).ok()?)))
}

pub(crate) fn provision(
    host: &HostBootstrap,
    application_identifier: &str,
    profile_directory: &Path,
    source_profile_id: &str,
    stop: &AtomicBool,
) -> Result<String, DeploymentError> {
    host.assert_current()
        .map_err(|_| DeploymentError::Unavailable)?;
    let launcher = host
        .description
        .provisioning_launcher
        .as_ref()
        .ok_or(DeploymentError::Unavailable)?;
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|_| DeploymentError::Unavailable)?;
    let profile = profile_directory
        .canonicalize()
        .map_err(|_| DeploymentError::Unavailable)?;
    let stat = std::fs::metadata(&executable).map_err(|_| DeploymentError::Unavailable)?;
    let modified = stat
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .ok_or(DeploymentError::Unavailable)?;
    let stamp = (modified.as_secs(), modified.subsec_nanos());
    let cached = read_cache(&profile).filter(|cache| {
        cache.executable == executable
            && cache.size == stat.len()
            && cache.modified == stamp
            && cache.sha256.len() == 64
            && cache.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    let mut cache = match cached {
        Some(cache) => cache,
        None => {
            let (sha256, size) = fingerprint(&executable)?;
            let cache = FingerprintCache {
                executable: executable.clone(),
                size,
                modified: stamp,
                sha256,
                provisioned: None,
            };
            save_cache(&profile, &cache);
            cache
        }
    };
    let raw_sha256 = &cache.sha256;
    let executable_size = cache.size;
    let platform = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let input = serde_json::to_vec(&json!({
        "version":1,"platform":platform,"canonicalHostDirectory":crate::fs::path_to_js(host.directory()),
        "applicationIdentifier":application_identifier,"canonicalNativeProfileDirectory":crate::fs::path_to_js(&profile),
        "sourceProfileId":source_profile_id,"canonicalGUIExecutablePath":crate::fs::path_to_js(&executable),
        "rawSha256":raw_sha256,"executableSize":executable_size,"helperProtocol":1,
        "sourceBuildMetadata":{"version":env!("CARGO_PKG_VERSION")}
    })).map_err(|_| DeploymentError::Unavailable)?;
    if input.len() > MAX_INPUT || stop.load(Ordering::Acquire) {
        return Err(DeploymentError::Cancelled);
    }
    let input_digest = format!("{:x}", Sha256::digest(&input));
    if cache
        .provisioned
        .as_ref()
        .is_some_and(|(prior_input, prior_deployment)| {
            prior_input == &input_digest
                && deployment_digest(host, source_profile_id).as_ref() == Some(prior_deployment)
        })
    {
        return Ok(source_profile_id.to_string());
    }
    let node = Path::new(&launcher.node_executable)
        .canonicalize()
        .map_err(|_| DeploymentError::Unavailable)?;
    let entry = Path::new(&launcher.entry_path)
        .canonicalize()
        .map_err(|_| DeploymentError::Unavailable)?;
    if !node.is_file() || !entry.is_file() {
        return Err(DeploymentError::Unavailable);
    }
    let mut command = Command::new(node);
    command
        .arg(entry)
        .args(["native-authority-deploy", "--data-dir"])
        .arg(host.directory());
    crate::harness::prepare_gui_child(&mut command);
    let output = run_owned(command, input, stop, Duration::from_secs(20))?;
    host.assert_current()
        .map_err(|_| DeploymentError::Unavailable)?;
    let receipt: Receipt =
        serde_json::from_slice(&output).map_err(|_| DeploymentError::InvalidReceipt)?;
    if receipt.version != 1
        || receipt.qualified
        || receipt.deployment_id != source_profile_id
        || !uuid::Uuid::parse_str(&receipt.generation)
            .is_ok_and(|id| id.to_string() == receipt.generation)
    {
        return Err(DeploymentError::InvalidReceipt);
    }
    cache.provisioned =
        deployment_digest(host, source_profile_id).map(|digest| (input_digest, digest));
    save_cache(&profile, &cache);
    Ok(receipt.deployment_id)
}

fn fingerprint(path: &Path) -> Result<(String, u64), DeploymentError> {
    let mut file = std::fs::File::open(path).map_err(|_| DeploymentError::Unavailable)?;
    let before = file.metadata().map_err(|_| DeploymentError::Unavailable)?;
    if !before.is_file() || before.len() == 0 || before.len() > MAX_EXECUTABLE {
        return Err(DeploymentError::Unavailable);
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut size = 0;
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| DeploymentError::Unavailable)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > before.len() {
            return Err(DeploymentError::Unavailable);
        }
        hash.update(&buffer[..count]);
    }
    let after = file.metadata().map_err(|_| DeploymentError::Unavailable)?;
    if size != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err(DeploymentError::Unavailable);
    }
    Ok((format!("{:x}", hash.finalize()), size))
}

/// IO threads belong to this actual child owner. Timeout/cancellation kills only
/// this provisioning CLI, then waits/reaps and joins IO; it proves no domain effect.
fn run_owned(
    mut command: Command,
    input: Vec<u8>,
    stop: &AtomicBool,
    timeout: Duration,
) -> Result<Vec<u8>, DeploymentError> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    let job = InvocationJob::new()?;
    #[cfg(windows)]
    let mut child = job.spawn(&mut command)?;
    #[cfg(not(windows))]
    let mut child = command.spawn().map_err(|_| DeploymentError::Unavailable)?;
    let (mut stdin, mut stdout) = match (child.stdin.take(), child.stdout.take()) {
        (Some(stdin), Some(stdout)) => (stdin, stdout),
        _ => {
            #[cfg(windows)]
            job.terminate();
            let _ = child.kill();
            let _ = child.wait();
            #[cfg(windows)]
            let _ = job.settle();
            return Err(DeploymentError::Unavailable);
        }
    };
    let writer = std::thread::Builder::new()
        .name("native-authority-deploy-input".into())
        .spawn(move || stdin.write_all(&input));
    let writer = match writer {
        Ok(value) => value,
        Err(_) => {
            #[cfg(windows)]
            job.terminate();
            let _ = child.kill();
            let _ = child.wait();
            #[cfg(windows)]
            let _ = job.settle();
            return Err(DeploymentError::Unavailable);
        }
    };
    let reader = std::thread::Builder::new()
        .name("native-authority-deploy-output".into())
        .spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .by_ref()
                .take(MAX_OUTPUT as u64 + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
    let reader = match reader {
        Ok(value) => value,
        Err(_) => {
            #[cfg(windows)]
            job.terminate();
            let _ = child.kill();
            let _ = child.wait();
            #[cfg(windows)]
            let _ = job.settle();
            let _ = writer.join();
            return Err(DeploymentError::Unavailable);
        }
    };
    let deadline = Instant::now() + timeout;
    let mut cancelled = false;
    let status = loop {
        #[cfg(windows)]
        job.observe();
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Err(_) => {
                #[cfg(windows)]
                job.terminate();
                let _ = child.kill();
                break child.wait().ok();
            }
            Ok(None) => {}
        }
        if stop.load(Ordering::Acquire) || Instant::now() >= deadline {
            cancelled = true;
            #[cfg(windows)]
            job.terminate();
            let _ = child.kill();
            break child.wait().ok();
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    #[cfg(windows)]
    let tree_settled = job.settle();
    let written = writer.join();
    let output = reader.join();
    if cancelled {
        return Err(DeploymentError::Cancelled);
    }
    #[cfg(windows)]
    if tree_settled.is_err() {
        return Err(DeploymentError::Unavailable);
    }
    if !status.is_some_and(|status| status.success()) || !matches!(written, Ok(Ok(()))) {
        return Err(DeploymentError::Unavailable);
    }
    match output {
        Ok(Ok(bytes)) if bytes.len() <= MAX_OUTPUT => Ok(bytes),
        _ => Err(DeploymentError::Unavailable),
    }
}

#[cfg(windows)]
struct InvocationJob(crate::owned_process_job::OwnedProcessJob);
#[cfg(windows)]
impl std::ops::Deref for InvocationJob {
    type Target = crate::owned_process_job::OwnedProcessJob;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
#[cfg(windows)]
impl InvocationJob {
    fn new() -> Result<Self, DeploymentError> {
        crate::owned_process_job::OwnedProcessJob::new()
            .map(Self)
            .map_err(|_| DeploymentError::Unavailable)
    }
    fn spawn(&self, command: &mut Command) -> Result<std::process::Child, DeploymentError> {
        self.0
            .spawn(command)
            .map_err(|_| DeploymentError::Unavailable)
    }
    fn settle(&self) -> Result<(), DeploymentError> {
        self.0.settle().map_err(|_| DeploymentError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalidating_provision_preserves_cached_fingerprint() {
        let directory =
            std::env::temp_dir().join(format!("bycoda-deploy-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(self.0.join(CACHE_FILE));
                let _ = std::fs::remove_dir(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let cache = FingerprintCache {
            executable: directory.join("app.exe"),
            size: 42,
            modified: (123, 456),
            sha256: "a".repeat(64),
            provisioned: Some(("input".into(), "record".into())),
        };
        save_cache(&directory, &cache);
        assert!(read_cache(&directory).unwrap().provisioned.is_some());
        invalidate_cached_provision(&directory);
        assert!(read_cache(&directory).is_none());
        std::fs::write(directory.join(CACHE_FILE), b"partial").unwrap();
        assert!(read_cache(&directory).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn invocation_job_reaps_its_actual_descendant_without_touching_a_sibling() {
        use std::io::{BufRead, BufReader};
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::{
            JobObjects::IsProcessInJob,
            Threading::{
                OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
                PROCESS_SYNCHRONIZE,
            },
        };
        struct Sibling(std::process::Child);
        impl Drop for Sibling {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let mut unrelated = Command::new("powershell.exe");
        unrelated
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Threading.Thread]::Sleep(10000)",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        crate::harness::prepare_gui_child(&mut unrelated);
        let mut sibling = Sibling(unrelated.spawn().unwrap());
        let job = InvocationJob::new().unwrap();
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command",
            "$p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-Command','[Threading.Thread]::Sleep(10000)') -WindowStyle Hidden -PassThru; [Console]::Out.WriteLine($p.Id); [Threading.Thread]::Sleep(10000)"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut parent = job.spawn(&mut command).unwrap();
        let mut line = String::new();
        BufReader::new(parent.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let pid = line.trim().parse::<u32>().unwrap();
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        assert!(!raw.is_null());
        let descendant = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut member = 0;
        assert_ne!(
            unsafe {
                IsProcessInJob(
                    descendant.as_raw_handle(),
                    job.as_handle().as_raw_handle(),
                    &mut member,
                )
            },
            0
        );
        assert_ne!(member, 0);
        // The production supervisor observes live members on every wait turn.
        // Capture before the parent exits and Windows removes PID-list entries.
        job.observe();
        parent.kill().unwrap();
        parent.wait().unwrap();
        job.settle().unwrap();
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.as_raw_handle(), 0) },
            0
        );
        assert!(sibling.0.try_wait().unwrap().is_none());
    }
    #[cfg(windows)]
    #[test]
    fn settlement_observes_descendant_notifications_without_a_poll_loop() {
        let job = InvocationJob::new().unwrap();
        let mut command = Command::new("cmd.exe");
        command
            .args(["/d", "/c", "cmd.exe /d /c exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut parent = job.spawn(&mut command).unwrap();
        // No explicit polling is required: settlement consumes kernel birth/exit
        // notifications and verifies them against the job's accounting totals.
        assert!(parent.wait().unwrap().success());
        job.settle().unwrap();
    }
    #[test]
    fn owned_local_cli_success_is_bounded_and_joined() {
        let mut command = Command::new(if cfg!(windows) {
            "cmd.exe"
        } else {
            "/bin/echo"
        });
        if cfg!(windows) {
            command.args(["/d", "/c", "echo native-deployment-fixture"]);
        } else {
            command.arg("native-deployment-fixture");
        }
        crate::harness::prepare_gui_child(&mut command);
        let output = run_owned(
            command,
            Vec::new(),
            &AtomicBool::new(false),
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(output).unwrap().trim(),
            "native-deployment-fixture"
        );
    }
    #[test]
    fn owned_local_cli_cancellation_reaps_before_returning() {
        let mut command = Command::new(if cfg!(windows) {
            "powershell.exe"
        } else {
            "/bin/sleep"
        });
        if cfg!(windows) {
            command.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Threading.Thread]::Sleep(10000)",
            ]);
        } else {
            command.arg("10");
        }
        crate::harness::prepare_gui_child(&mut command);
        assert!(matches!(
            run_owned(
                command,
                Vec::new(),
                &AtomicBool::new(true),
                Duration::from_secs(5)
            ),
            Err(DeploymentError::Cancelled)
        ));
    }
}
