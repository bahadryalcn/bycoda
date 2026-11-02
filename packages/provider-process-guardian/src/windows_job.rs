//! One actual Windows job and its captured process handles. No PID grants.
use std::io;
use std::os::windows::io::{AsHandle, AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

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

/// This port belongs to one original, initially empty job. Its PIDs are only
/// lifecycle correlations, never handles used to signal or authorize a process.
struct JobNotifications {
    port: OwnedHandle,
    key: Box<u8>,
    births: u64,
    exits: u64,
    active: std::collections::HashSet<u32>,
    lifetimes_by_pid: std::collections::HashMap<u32, u64>,
    incomplete: bool,
    #[cfg(test)]
    observed: std::collections::VecDeque<(u32, usize)>,
}

impl JobNotifications {
    fn associate(job: &OwnedHandle) -> Result<Self, OwnedJobError> {
        use windows_sys::Win32::{
            Foundation::INVALID_HANDLE_VALUE,
            System::{
                JobObjects::{
                    JobObjectAssociateCompletionPortInformation, SetInformationJobObject,
                    JOBOBJECT_ASSOCIATE_COMPLETION_PORT,
                },
                IO::CreateIoCompletionPort,
            },
        };
        let raw =
            unsafe { CreateIoCompletionPort(INVALID_HANDLE_VALUE, std::ptr::null_mut(), 0, 0) };
        if raw.is_null() {
            return Err(OwnedJobError::Unavailable);
        }
        let port = unsafe { OwnedHandle::from_raw_handle(raw) };
        // A non-zero-sized allocation keeps the private key stable when the job
        // owner moves. Neither the port nor this key is inherited by providers.
        let key = Box::new(0u8);
        let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: (&*key as *const u8).cast_mut().cast(),
            CompletionPort: port.as_raw_handle(),
        };
        if unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectAssociateCompletionPortInformation,
                &association as *const _ as *const _,
                std::mem::size_of_val(&association) as u32,
            )
        } == 0
        {
            return Err(OwnedJobError::Unavailable);
        }
        Ok(Self {
            port,
            key,
            births: 0,
            exits: 0,
            active: std::collections::HashSet::new(),
            lifetimes_by_pid: std::collections::HashMap::new(),
            incomplete: false,
            #[cfg(test)]
            observed: std::collections::VecDeque::new(),
        })
    }

    fn record(&mut self, message: u32, value: usize) {
        #[cfg(test)]
        {
            if self.observed.len() == 256 {
                self.observed.pop_front();
            }
            self.observed.push_back((message, value));
        }
        use windows_sys::Win32::System::SystemServices::{
            JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS, JOB_OBJECT_MSG_EXIT_PROCESS,
            JOB_OBJECT_MSG_NEW_PROCESS,
        };
        if !matches!(
            message,
            JOB_OBJECT_MSG_NEW_PROCESS
                | JOB_OBJECT_MSG_EXIT_PROCESS
                | JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS
        ) {
            return;
        }
        let Ok(pid) = u32::try_from(value) else {
            self.incomplete = true;
            return;
        };
        if pid <= 1 {
            self.incomplete = true;
            return;
        }
        if message == JOB_OBJECT_MSG_NEW_PROCESS {
            // Notifications carry no creation time. A repeated PID is ambiguous
            // even after EXIT: a delayed old event cannot close a later lifetime.
            if self.active.len() >= 4096 || !self.active.insert(pid) {
                self.incomplete = true;
                return;
            }
            if self.lifetimes_by_pid.len() >= 65_536 && !self.lifetimes_by_pid.contains_key(&pid) {
                self.incomplete = true;
                return;
            }
            let lifetimes = self.lifetimes_by_pid.entry(pid).or_default();
            *lifetimes += 1;
            if *lifetimes != 1 {
                self.incomplete = true;
            }
            self.births += 1;
        } else if self.active.remove(&pid) {
            self.exits += 1;
        } else {
            self.incomplete = true;
        }
    }

    fn observe(&mut self, wait_ms: u32) -> Result<(), OwnedJobError> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, WAIT_TIMEOUT},
            System::IO::GetQueuedCompletionStatus,
        };
        // Bound an ordinary observation; drain repeats until its real census is
        // complete or its bounded notification-delivery wait expires.
        for index in 0..1024 {
            let mut message = 0;
            let mut key = 0;
            let mut value = std::ptr::null_mut();
            if unsafe {
                GetQueuedCompletionStatus(
                    self.port.as_raw_handle(),
                    &mut message,
                    &mut key,
                    &mut value,
                    if index == 0 { wait_ms } else { 0 },
                )
            } == 0
            {
                if unsafe { GetLastError() } == WAIT_TIMEOUT && value.is_null() {
                    return Ok(());
                }
                return Err(OwnedJobError::Unavailable);
            }
            if key != (&*self.key as *const u8) as usize {
                // This port is private and associated with exactly one job.
                // A different sender is not a coverage gap we can reconcile.
                return Err(OwnedJobError::Unavailable);
            }
            self.record(message, value as usize);
        }
        Ok(())
    }

    fn covers(&self, total: u32) -> bool {
        !self.incomplete
            && self.births == u64::from(total)
            && self.exits == self.births
            && self.active.is_empty()
    }

    fn covers_with_waits(&self, total: u32, waited: &WaitedMembers) -> bool {
        self.covers(total)
            || (!self.incomplete
                && self.births == u64::from(total)
                && self.exits + self.active.len() as u64 == self.births
                && self.active.iter().all(|pid| {
                    self.lifetimes_by_pid.get(pid) == Some(&1)
                        && waited.lifetimes_by_pid.get(pid) == Some(&1)
                }))
    }
}

/// Issued only after waiting the captured original HANDLEs. A missing EXIT can
/// be covered only by a unique lifetime in both this set and the complete job
/// birth census; no PID lookup or current-process inference occurs here.
struct WaitedMembers {
    count: usize,
    lifetimes_by_pid: std::collections::HashMap<u32, usize>,
}

/// A dedicated invocation job owns descendants before Node is allowed to run.
/// It never enrolls or terminates the app's unrelated provider processes.
#[cfg(windows)]
pub struct OwnedProcessJob {
    handle: std::os::windows::io::OwnedHandle,
    notifications: std::sync::Mutex<JobNotifications>,
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
        let handle = create_job().map_err(|_| OwnedJobError::Unavailable)?;
        // Associate while empty, before even the suspended leader is assigned.
        // Association after spawning can miss already-finished descendants.
        let notifications = JobNotifications::associate(&handle)?;
        Ok(Self {
            handle,
            notifications: std::sync::Mutex::new(notifications),
            members: std::sync::Mutex::new(std::collections::HashMap::new()),
            uncertain: AtomicBool::new(false),
            operational_failure: AtomicBool::new(false),
        })
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
        if self.observe_notifications(0).is_err() {
            self.uncertain.store(true, Ordering::Release);
            self.operational_failure.store(true, Ordering::Release);
        }
        match self.capture_members() {
            Ok(()) => {}
            Err(CaptureFailure::Coverage) => self.uncertain.store(true, Ordering::Release),
            Err(CaptureFailure::Api) => {
                self.uncertain.store(true, Ordering::Release);
                self.operational_failure.store(true, Ordering::Release);
            }
        }
    }
    fn observe_notifications(&self, wait_ms: u32) -> Result<(), OwnedJobError> {
        self.notifications
            .lock()
            .map_err(|_| OwnedJobError::Unavailable)?
            .observe(wait_ms)
    }

    fn notifications_cover(
        &self,
        total: u32,
        waited: &WaitedMembers,
    ) -> Result<bool, OwnedJobError> {
        Ok(self
            .notifications
            .lock()
            .map_err(|_| OwnedJobError::Unavailable)?
            .covers_with_waits(total, waited))
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
    fn wait_members(&self) -> Result<WaitedMembers, OwnedJobError> {
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
        let mut lifetimes_by_pid = std::collections::HashMap::new();
        for &(pid, _) in members.keys() {
            *lifetimes_by_pid.entry(pid).or_default() += 1;
        }
        Ok(WaitedMembers {
            count: members.len(),
            lifetimes_by_pid,
        })
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
        let mut delivery_deadline = None;
        loop {
            if self.observe_notifications(0).is_err() {
                self.operational_failure.store(true, Ordering::Release);
            }
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
                let handles_cover = !self.uncertain.load(Ordering::Acquire)
                    && accounting.TotalProcesses as usize == members.count;
                // Job notifications are best-effort and their PIDs can recycle.
                // Only the original private port's fully balanced birth/exit
                // census, reconciled against kernel accounting, can cover a
                // short-lived process that vanished before OpenProcess. An
                // already-waited original HANDLE can independently cover its
                // own missing EXIT packet, only with a unique birth identity.
                // See JOBOBJECT_ASSOCIATE_COMPLETION_PORT and
                // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION in the Windows API.
                // Empty accounting, a NEW/EXIT packet, or elapsed time alone
                // never creates this proof. All captured HANDLE waits still ran.
                if handles_cover || self.notifications_cover(accounting.TotalProcesses, &members)? {
                    return Ok(JobDrain {
                        verified: Some(VerifiedJobRetirement { _private: () }),
                    });
                }
                let deadline = delivery_deadline
                    .get_or_insert_with(|| Instant::now() + Duration::from_secs(1));
                if Instant::now() >= *deadline {
                    return Ok(JobDrain { verified: None });
                }
                if self.observe_notifications(10).is_err() {
                    self.operational_failure.store(true, Ordering::Release);
                }
                continue;
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
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    use windows_sys::Win32::{Foundation::DuplicateHandle, System::Threading::GetCurrentProcess};
    // WinNT.h job access masks; their windows-sys constants live in the optional
    // SystemServices module, which this application otherwise does not require.
    const QUERY_JOB: u32 = 4;
    const TERMINATE_JOB: u32 = 8;

    #[test]
    #[ignore = "isolated job child; invoked only by owned job API regressions"]
    fn owned_job_api_child() {
        match std::env::var("BYCODA_OWNED_JOB_CHILD_MODE").as_deref() {
            Ok("burst") => {
                let count = std::env::var("BYCODA_OWNED_JOB_CHILD_COUNT")
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                for _ in 0..count {
                    let status = child_command()
                        .env_remove("BYCODA_OWNED_JOB_CHILD_MODE")
                        .env_remove("BYCODA_OWNED_JOB_CHILD_COUNT")
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .unwrap();
                    assert!(status.success());
                }
                println!("actual completed descendants: {count}");
            }
            Ok("blocked") => {
                println!("owned-job-ready");
                io::stdout().flush().unwrap();
                let mut release = String::new();
                io::stdin().read_line(&mut release).unwrap();
                assert_eq!(release.trim(), "release");
            }
            _ => {}
        }
        println!("actual owned job output");
    }

    fn child_command() -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "windows_job::tests::owned_job_api_child",
                "--ignored",
                "--nocapture",
            ])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    fn spawn(job: &OwnedProcessJob) -> std::process::Child {
        job.spawn(&mut child_command()).unwrap()
    }

    fn burst(job: &OwnedProcessJob, count: usize) -> std::process::Output {
        job.spawn(
            child_command()
                .env("BYCODA_OWNED_JOB_CHILD_MODE", "burst")
                .env("BYCODA_OWNED_JOB_CHILD_COUNT", count.to_string()),
        )
        .unwrap()
        .wait_with_output()
        .unwrap()
    }

    fn assert_verified(job: &OwnedProcessJob) {
        let drained = job.drain().unwrap();
        let notifications = job.notifications.lock().unwrap();
        assert!(
            drained.require_verified().is_ok(),
            "births={} exits={} active={:?} incomplete={} captured={} uncertain={} packets={:?}",
            notifications.births,
            notifications.exits,
            notifications.active,
            notifications.incomplete,
            job.members.lock().unwrap().len(),
            job.uncertain.load(Ordering::Acquire),
            notifications.observed,
        );
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

    #[test]
    fn short_lived_descendants_between_observations_have_original_exit_proof() {
        // A busy machine can hand a recycled PID to a later descendant. That makes
        // the receipt correctly unverifiable, so retry the burst in a fresh job.
        let mut attempt = 0;
        let job = loop {
            attempt += 1;
            let job = OwnedProcessJob::new().unwrap();
            // Every descendant has already exited before another snapshot is taken.
            // More than the old 64-handle lifetime capacity makes the old polling
            // proof fail deterministically, rather than relying on a timing race.
            let output = burst(&job, 80);
            assert!(output.status.success());
            assert!(String::from_utf8_lossy(&output.stdout)
                .contains("actual completed descendants: 80"));
            assert_eq!(job.members.lock().unwrap().len(), 1);
            let reused = job
                .notifications
                .lock()
                .unwrap()
                .lifetimes_by_pid
                .values()
                .any(|lifetimes| *lifetimes > 1);
            if !reused || attempt == 5 {
                break job;
            }
            assert!(job.drain().unwrap().require_verified().is_err());
        };
        assert_verified(&job);
        // Windows may also add console/helper lifetimes. The verified receipt
        // still reconciles every actual birth against the real kernel total.
        assert!(job.notifications.lock().unwrap().births >= 81);
    }

    #[test]
    fn completed_original_cannot_retire_or_certify_a_running_sibling() {
        let original = OwnedProcessJob::new().unwrap();
        let sibling_job = OwnedProcessJob::new().unwrap();
        let mut sibling = sibling_job
            .spawn(
                child_command()
                    .env("BYCODA_OWNED_JOB_CHILD_MODE", "blocked")
                    .stdin(Stdio::piped()),
            )
            .unwrap();
        let mut sibling_output = BufReader::new(sibling.stdout.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            assert_ne!(sibling_output.read_line(&mut line).unwrap(), 0);
            if line.contains("owned-job-ready") {
                break;
            }
        }
        assert!(burst(&original, 3).status.success());
        assert_verified(&original);
        assert!(sibling.try_wait().unwrap().is_none());
        assert!(!sibling_job.notifications.lock().unwrap().covers(1));
        sibling
            .stdin
            .take()
            .unwrap()
            .write_all(b"release\n")
            .unwrap();
        assert!(sibling.wait().unwrap().success());
        assert_verified(&sibling_job);
    }

    #[test]
    fn empty_job_with_missing_kernel_notifications_stays_unverified() {
        use windows_sys::Win32::System::IO::GetQueuedCompletionStatus;
        let job = OwnedProcessJob::new().unwrap();
        assert!(burst(&job, 3).status.success());
        // Actually remove queued kernel packets without recording them. A zero
        // active-process count cannot hide this missing per-lifetime evidence.
        let notifications = job.notifications.lock().unwrap();
        let mut discarded = 0;
        loop {
            let mut message = 0;
            let mut key = 0;
            let mut value = std::ptr::null_mut();
            if unsafe {
                GetQueuedCompletionStatus(
                    notifications.port.as_raw_handle(),
                    &mut message,
                    &mut key,
                    &mut value,
                    0,
                )
            } == 0
            {
                break;
            }
            discarded += 1;
        }
        drop(notifications);
        assert!(discarded > 0);
        assert!(job.drain().unwrap().require_verified().is_err());
        assert!(job.settle().is_err());
    }

    #[test]
    fn ownership_and_waited_exit_proof_survive_a_different_observer_thread() {
        let job = std::sync::Arc::new(OwnedProcessJob::new().unwrap());
        let observed = job.clone();
        let observer = std::thread::spawn(move || {
            assert!(burst(&observed, 3).status.success());
            observed.observe();
            std::thread::current().id()
        })
        .join()
        .unwrap();
        let drainer = std::thread::spawn(move || {
            assert_verified(&job);
            std::thread::current().id()
        })
        .join()
        .unwrap();
        assert_ne!(observer, drainer);
    }

    #[test]
    fn a_missing_uncaptured_exit_cannot_borrow_another_waited_process() {
        use windows_sys::Win32::System::{
            SystemServices::JOB_OBJECT_MSG_EXIT_PROCESS, IO::GetQueuedCompletionStatus,
        };
        let job = OwnedProcessJob::new().unwrap();
        assert!(burst(&job, 3).status.success());
        let captured: std::collections::HashSet<_> = job
            .members
            .lock()
            .unwrap()
            .keys()
            .map(|&(pid, _)| pid)
            .collect();
        let mut notifications = job.notifications.lock().unwrap();
        let mut dropped = None;
        loop {
            let mut message = 0;
            let mut key = 0;
            let mut value = std::ptr::null_mut();
            if unsafe {
                GetQueuedCompletionStatus(
                    notifications.port.as_raw_handle(),
                    &mut message,
                    &mut key,
                    &mut value,
                    0,
                )
            } == 0
            {
                break;
            }
            assert_eq!(key, (&*notifications.key as *const u8) as usize);
            let pid = value as usize as u32;
            if dropped.is_none()
                && message == JOB_OBJECT_MSG_EXIT_PROCESS
                && !captured.contains(&pid)
            {
                dropped = Some(pid);
            } else {
                notifications.record(message, value as usize);
            }
        }
        drop(notifications);
        let dropped = dropped.expect("actual uncaptured descendant EXIT removed");
        assert!(job.drain().unwrap().require_verified().is_err());
        assert!(!job
            .members
            .lock()
            .unwrap()
            .keys()
            .any(|&(pid, _)| pid == dropped));
    }
}
