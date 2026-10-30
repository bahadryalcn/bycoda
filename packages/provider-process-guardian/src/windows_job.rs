//! One actual Windows job and its captured process handles. No PID grants.
use std::io;
use std::os::windows::io::{AsHandle, AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug)]
pub enum OwnedJobError {
    Unavailable,
}

impl std::fmt::Display for OwnedJobError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Owned process job unavailable")
    }
}
impl std::error::Error for OwnedJobError {}

enum CaptureFailure {
    Coverage,
    Api,
}

/// Limited job-drain observation and strict retirement are different facts.
/// Only this module's original HANDLE/count observations can issue the proof.
pub struct JobDrain {
    verified: Option<VerifiedJobRetirement>,
}
struct VerifiedJobRetirement {
    _private: (),
}
impl JobDrain {
    pub fn require_verified(&self) -> Result<(), OwnedJobError> {
        self.verified
            .as_ref()
            .map(|_| ())
            .ok_or(OwnedJobError::Unavailable)
    }
}

/// A dedicated invocation job owns descendants before Node is allowed to run.
/// It never enrolls or terminates the app's unrelated provider processes.
#[cfg(windows)]
pub struct OwnedProcessJob {
    handle: std::os::windows::io::OwnedHandle,
    members:
        std::sync::Mutex<std::collections::HashMap<(u32, u64), std::os::windows::io::OwnedHandle>>,
    uncertain: AtomicBool,
    operational_failure: AtomicBool,
}
#[cfg(windows)]
impl OwnedProcessJob {
    /// Borrow the original job without exposing a raw ownership constructor.
    pub fn as_handle(&self) -> BorrowedHandle<'_> {
        self.handle.as_handle()
    }
    pub fn new() -> Result<Self, OwnedJobError> {
        create_job()
            .map(|handle| Self {
                handle,
                members: std::sync::Mutex::new(std::collections::HashMap::new()),
                uncertain: AtomicBool::new(false),
                operational_failure: AtomicBool::new(false),
            })
            .map_err(|_| OwnedJobError::Unavailable)
    }
    pub fn spawn(&self, command: &mut Command) -> Result<std::process::Child, OwnedJobError> {
        use std::os::windows::{io::AsRawHandle, process::CommandExt};
        use windows_sys::Win32::System::{
            JobObjects::AssignProcessToJobObject,
            Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_SUSPENDED},
        };
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
        let mut child = command.spawn().map_err(|_| OwnedJobError::Unavailable)?;
        if unsafe { AssignProcessToJobObject(self.handle.as_raw_handle(), child.as_raw_handle()) }
            == 0
        {
            self.terminate();
            let _ = child.kill();
            let _ = child.wait();
            let _ = self.settle();
            return Err(OwnedJobError::Unavailable);
        }
        self.observe();
        if self.uncertain.load(Ordering::Acquire) || resume_child(child.id()).is_err() {
            self.terminate();
            let _ = child.kill();
            let _ = child.wait();
            let _ = self.settle();
            return Err(OwnedJobError::Unavailable);
        }
        Ok(child)
    }
    // Capture kernel handles while members are still visible. TerminateJobObject
    // can remove PID-list entries before the corresponding process is signaled.
    // Missing births remain unknown, never a successful tree-settlement proof.
    pub fn observe(&self) {
        match self.capture_members() {
            Ok(()) => {}
            Err(CaptureFailure::Coverage) => self.uncertain.store(true, Ordering::Release),
            Err(CaptureFailure::Api) => {
                self.uncertain.store(true, Ordering::Release);
                self.operational_failure.store(true, Ordering::Release);
            }
        }
    }
    fn capture_members(&self) -> Result<(), CaptureFailure> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::{
            Foundation::{
                GetLastError, ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_PARAMETER, ERROR_MORE_DATA,
                ERROR_NOT_FOUND, FILETIME,
            },
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
            return Err(match unsafe { GetLastError() } {
                ERROR_MORE_DATA | ERROR_INSUFFICIENT_BUFFER => CaptureFailure::Coverage,
                _ => CaptureFailure::Api,
            });
        }
        let list = unsafe { &*storage.as_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() };
        let count = list.NumberOfProcessIdsInList as usize;
        if count > MAX_MEMBERS || list.NumberOfAssignedProcesses as usize != count {
            return Err(CaptureFailure::Coverage);
        }
        let ids = unsafe { std::slice::from_raw_parts(list.ProcessIdList.as_ptr(), count) };
        let mut members = self.members.lock().map_err(|_| CaptureFailure::Api)?;
        for &pid in ids {
            let pid = u32::try_from(pid).map_err(|_| CaptureFailure::Api)?;
            if pid <= 1 {
                return Err(CaptureFailure::Api);
            }
            let raw = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    pid,
                )
            };
            if raw.is_null() {
                // A member can leave between the PID-list snapshot and OpenProcess.
                // That is missing coverage; access/API failures are a different fact.
                return Err(match unsafe { GetLastError() } {
                    ERROR_INVALID_PARAMETER | ERROR_NOT_FOUND => CaptureFailure::Coverage,
                    _ => CaptureFailure::Api,
                });
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
            {
                return Err(CaptureFailure::Api);
            }
            if member == 0 {
                return Err(CaptureFailure::Coverage);
            }
            if unsafe {
                GetProcessTimes(
                    process.as_raw_handle(),
                    &mut created,
                    &mut exited,
                    &mut kernel,
                    &mut user,
                )
            } == 0
            {
                return Err(CaptureFailure::Api);
            }
            let key = (
                pid,
                ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
            );
            if !members.contains_key(&key) {
                if members.len() >= MAX_MEMBERS {
                    return Err(CaptureFailure::Coverage);
                }
                members.insert(key, process);
            }
        }
        Ok(())
    }
    pub fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        self.observe();
        if unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(
                self.handle.as_raw_handle(),
                1,
            )
        } == 0
        {
            self.operational_failure.store(true, Ordering::Release);
        }
    }
    fn wait_members(&self) -> Result<usize, OwnedJobError> {
        use std::os::windows::io::AsRawHandle;
        let members = self
            .members
            .lock()
            .map_err(|_| OwnedJobError::Unavailable)?;
        for process in members.values() {
            if unsafe {
                windows_sys::Win32::System::Threading::WaitForSingleObject(
                    process.as_raw_handle(),
                    u32::MAX,
                )
            } != 0
            {
                return Err(OwnedJobError::Unavailable);
            }
        }
        Ok(members.len())
    }
    pub fn settle(&self) -> Result<(), OwnedJobError> {
        self.drain()?.require_verified()
    }
    pub fn drain(&self) -> Result<JobDrain, OwnedJobError> {
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
                return Err(OwnedJobError::Unavailable);
            }
            if accounting.ActiveProcesses == 0 {
                // Group accounting alone is not the per-process exit event.
                let members = self.wait_members()?;
                if self.operational_failure.load(Ordering::Acquire) {
                    return Err(OwnedJobError::Unavailable);
                }
                return if self.uncertain.load(Ordering::Acquire)
                    || accounting.TotalProcesses as usize != members
                {
                    Ok(JobDrain { verified: None })
                } else {
                    Ok(JobDrain {
                        verified: Some(VerifiedJobRetirement { _private: () }),
                    })
                };
            }
            self.terminate();
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

pub fn create_job() -> io::Result<OwnedHandle> {
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = OwnedHandle::from_raw_handle(raw);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }
}

pub fn resume_child(pid: u32) -> io::Result<()> {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        },
        Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
    };
    // Stable Rust does not expose Child's primary-thread handle. The suspended
    // process has not run user code, so find that thread in the OS snapshot.
    unsafe {
        let raw = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let snapshot = OwnedHandle::from_raw_handle(raw);
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut found = Thread32First(snapshot.as_raw_handle(), &mut entry);
        while found != 0 {
            if entry.th32OwnerProcessID == pid {
                let raw = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if raw.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let thread = OwnedHandle::from_raw_handle(raw);
                if ResumeThread(thread.as_raw_handle()) == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                return Ok(());
            }
            found = Thread32Next(snapshot.as_raw_handle(), &mut entry);
        }
        Err(io::Error::other("Managed child has no primary thread"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::process::Stdio;
    use windows_sys::Win32::{Foundation::DuplicateHandle, System::Threading::GetCurrentProcess};
    // WinNT.h job access masks; their windows-sys constants live in the optional
    // SystemServices module, which this application otherwise does not require.
    const QUERY_JOB: u32 = 4;
    const TERMINATE_JOB: u32 = 8;

    #[test]
    #[ignore = "isolated job child; invoked only by owned job API regressions"]
    fn owned_job_api_child() {
        println!("actual owned job output");
    }

    fn spawn(job: &OwnedProcessJob) -> std::process::Child {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "windows_job::tests::owned_job_api_child",
                "--ignored",
                "--nocapture",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        job.spawn(&mut command).unwrap()
    }

    fn restricted_handle(job: &OwnedProcessJob, rights: u32) -> OwnedHandle {
        let mut duplicate = std::ptr::null_mut();
        assert_ne!(
            unsafe {
                DuplicateHandle(
                    GetCurrentProcess(),
                    job.handle.as_raw_handle(),
                    GetCurrentProcess(),
                    &mut duplicate,
                    rights,
                    0,
                    0,
                )
            },
            0,
            "duplicate private fixture handle"
        );
        unsafe { OwnedHandle::from_raw_handle(duplicate) }
    }

    #[test]
    fn actual_capture_api_failure_stays_failed_after_access_and_child_output_recover() {
        let mut job = OwnedProcessJob::new().unwrap();
        let child = spawn(&job);
        // Real kernel ACCESS_DENIED at the capture query, not a manufactured
        // missing-birth bit. Restore rights afterwards: the old failure persists.
        let restricted = restricted_handle(&job, TERMINATE_JOB);
        let original = std::mem::replace(&mut job.handle, restricted);
        job.observe();
        let restricted = std::mem::replace(&mut job.handle, original);
        drop(restricted);
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("actual owned job output"));
        job.observe();
        assert!(
            job.drain().is_err(),
            "an API failure is not only incomplete proof"
        );
        assert!(job.settle().is_err());
    }

    #[test]
    fn actual_termination_api_failure_cannot_become_settled_after_natural_close() {
        let mut job = OwnedProcessJob::new().unwrap();
        let child = spawn(&job);
        // Query remains available, but TerminateJobObject really fails with this
        // private handle. The original child can still finish normally on its own.
        let restricted = restricted_handle(&job, QUERY_JOB);
        let original = std::mem::replace(&mut job.handle, restricted);
        job.terminate();
        let restricted = std::mem::replace(&mut job.handle, original);
        drop(restricted);
        assert!(child.wait_with_output().unwrap().status.success());
        assert!(job.drain().is_err());
        assert!(job.settle().is_err());
    }
}
