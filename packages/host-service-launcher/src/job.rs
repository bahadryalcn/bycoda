//! Binds the Host's lifetime to the launcher's. The launcher joins a kill-on-close
//! job object before it starts any child, so every Host process inherits membership
//! and Windows ends them all when the launcher dies for any reason (End Task, task
//! re-registration, crash). Joining before spawning leaves no window in which a
//! descendant could start outside the job.
use std::io;

/// Keep this alive for the life of the launcher; closing it ends every Host process.
#[cfg(windows)]
pub struct LifetimeJob {
    _handle: std::os::windows::io::OwnedHandle,
}
#[cfg(not(windows))]
pub struct LifetimeJob;

#[cfg(windows)]
pub fn bind_children_to_launcher() -> io::Result<LifetimeJob> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::GetCurrentProcess,
    };
    // shortcut: same job setup as provider-process-guardian's windows_job; that crate
    // carries unrelated dependencies, so share it only if both move into a common crate.
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
            || AssignProcessToJobObject(job.as_raw_handle(), GetCurrentProcess()) == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(LifetimeJob { _handle: job })
    }
}

/// Process groups and parent-death signals differ per platform; the orphaned-Host
/// risk is the Windows Task Scheduler launcher, so other targets keep plain spawning.
#[cfg(not(windows))]
pub fn bind_children_to_launcher() -> io::Result<LifetimeJob> {
    Ok(LifetimeJob)
}
