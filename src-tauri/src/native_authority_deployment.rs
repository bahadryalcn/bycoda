//! Native-owned local CLI provisioning. This writes only a transport locator;
//! it is not an actor grant or runtime authentication receipt.
#![allow(dead_code)]

use crate::native_authority_bootstrap::HostBootstrap;
use serde::Deserialize;
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
    let (raw_sha256, executable_size) = fingerprint(&executable)?;
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

/// A dedicated invocation job owns descendants before Node is allowed to run.
/// It never enrolls or terminates the app's unrelated provider processes.
#[cfg(windows)]
struct InvocationJob {
    handle: std::os::windows::io::OwnedHandle,
    members:
        std::sync::Mutex<std::collections::HashMap<(u32, u64), std::os::windows::io::OwnedHandle>>,
    uncertain: AtomicBool,
}
#[cfg(windows)]
impl InvocationJob {
    fn new() -> Result<Self, DeploymentError> {
        crate::windows::create_job()
            .map(|handle| Self {
                handle,
                members: std::sync::Mutex::new(std::collections::HashMap::new()),
                uncertain: AtomicBool::new(false),
            })
            .map_err(|_| DeploymentError::Unavailable)
    }
    fn spawn(&self, command: &mut Command) -> Result<std::process::Child, DeploymentError> {
        use std::os::windows::{io::AsRawHandle, process::CommandExt};
        use windows_sys::Win32::System::{
            JobObjects::AssignProcessToJobObject,
            Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_SUSPENDED},
        };
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
        let mut child = command.spawn().map_err(|_| DeploymentError::Unavailable)?;
        if unsafe { AssignProcessToJobObject(self.handle.as_raw_handle(), child.as_raw_handle()) }
            == 0
        {
            self.terminate();
            let _ = child.kill();
            let _ = child.wait();
            let _ = self.settle();
            return Err(DeploymentError::Unavailable);
        }
        self.observe();
        if self.uncertain.load(Ordering::Acquire)
            || crate::windows::resume_child(child.id()).is_err()
        {
            self.terminate();
            let _ = child.kill();
            let _ = child.wait();
            let _ = self.settle();
            return Err(DeploymentError::Unavailable);
        }
        Ok(child)
    }
    // Capture kernel handles while members are still visible. TerminateJobObject
    // can remove PID-list entries before the corresponding process is signaled.
    // Missing births remain unknown, never a successful tree-settlement proof.
    fn observe(&self) {
        if self.capture_members().is_err() {
            self.uncertain.store(true, Ordering::Release);
        }
    }
    fn capture_members(&self) -> Result<(), DeploymentError> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::{
            Foundation::FILETIME,
            System::{
                JobObjects::{
                    IsProcessInJob, JobObjectBasicProcessIdList, QueryInformationJobObject,
                    JOBOBJECT_BASIC_PROCESS_ID_LIST,
                },
                Threading::{
                    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
                    PROCESS_SYNCHRONIZE,
                },
            },
        };
        const MAX_MEMBERS: usize = 64;
        // usize storage provides the flexible-array structure's required alignment.
        let mut storage = vec![0usize; MAX_MEMBERS + 1];
        if unsafe {
            QueryInformationJobObject(
                self.handle.as_raw_handle(),
                JobObjectBasicProcessIdList,
                storage.as_mut_ptr().cast(),
                (storage.len() * std::mem::size_of::<usize>()) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(DeploymentError::Unavailable);
        }
        let list = unsafe { &*storage.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
        let count = list.NumberOfProcessIdsInList as usize;
        if count > MAX_MEMBERS || list.NumberOfAssignedProcesses as usize != count {
            return Err(DeploymentError::Unavailable);
        }
        let ids = unsafe { std::slice::from_raw_parts(list.ProcessIdList.as_ptr(), count) };
        let mut members = self
            .members
            .lock()
            .map_err(|_| DeploymentError::Unavailable)?;
        for &pid in ids {
            let pid = u32::try_from(pid).map_err(|_| DeploymentError::Unavailable)?;
            let raw = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    pid,
                )
            };
            if raw.is_null() {
                return Err(DeploymentError::Unavailable);
            }
            let process = unsafe { OwnedHandle::from_raw_handle(raw) };
            let mut member = 0;
            let mut created: FILETIME = unsafe { std::mem::zeroed() };
            let mut exited = created;
            let mut kernel = created;
            let mut user = created;
            if unsafe {
                IsProcessInJob(
                    process.as_raw_handle(),
                    self.handle.as_raw_handle(),
                    &mut member,
                )
            } == 0
                || member == 0
                || unsafe {
                    GetProcessTimes(
                        process.as_raw_handle(),
                        &mut created,
                        &mut exited,
                        &mut kernel,
                        &mut user,
                    )
                } == 0
            {
                return Err(DeploymentError::Unavailable);
            }
            let key = (
                pid,
                ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
            );
            if !members.contains_key(&key) {
                if members.len() >= MAX_MEMBERS {
                    return Err(DeploymentError::Unavailable);
                }
                members.insert(key, process);
            }
        }
        Ok(())
    }
    fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        self.observe();
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(
                self.handle.as_raw_handle(),
                1,
            );
        }
    }
    fn wait_members(&self) -> Result<usize, DeploymentError> {
        use std::os::windows::io::AsRawHandle;
        let members = self
            .members
            .lock()
            .map_err(|_| DeploymentError::Unavailable)?;
        for process in members.values() {
            if unsafe {
                windows_sys::Win32::System::Threading::WaitForSingleObject(
                    process.as_raw_handle(),
                    u32::MAX,
                )
            } != 0
            {
                return Err(DeploymentError::Unavailable);
            }
        }
        Ok(members.len())
    }
    fn settle(&self) -> Result<(), DeploymentError> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };
        loop {
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION =
                unsafe { std::mem::zeroed() };
            if unsafe {
                QueryInformationJobObject(
                    self.handle.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    &mut accounting as *mut _ as *mut _,
                    std::mem::size_of_val(&accounting) as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                self.terminate();
                let _ = self.wait_members();
                return Err(DeploymentError::Unavailable);
            }
            if accounting.ActiveProcesses == 0 {
                // Group accounting alone is not the per-process exit event.
                let members = self.wait_members()?;
                return if self.uncertain.load(Ordering::Acquire)
                    || accounting.TotalProcesses as usize != members
                {
                    Err(DeploymentError::Unavailable)
                } else {
                    Ok(())
                };
            }
            self.terminate();
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
                    job.handle.as_raw_handle(),
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
    fn an_unobserved_descendant_birth_never_becomes_successful_settlement() {
        let job = InvocationJob::new().unwrap();
        let mut command = Command::new("cmd.exe");
        command
            .args(["/d", "/c", "cmd.exe /d /c exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut parent = job.spawn(&mut command).unwrap();
        // Intentionally omit the production supervisor's observation loop.
        assert!(parent.wait().unwrap().success());
        assert!(matches!(job.settle(), Err(DeploymentError::Unavailable)));
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
