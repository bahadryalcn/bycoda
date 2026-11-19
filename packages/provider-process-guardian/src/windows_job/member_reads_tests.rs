//! Regression for #1436: a member captured once is not re-opened by later
//! supervision observations. Kept beside `windows_job.rs` so the supervision
//! source stays focused. It reuses the isolated `owned_job_api_child` helper in
//! `tests`, through its `blocked` mode, which prints a ready line and waits.
use super::*;
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;

fn blocked_child() -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "windows_job::tests::owned_job_api_child",
            "--ignored",
            "--nocapture",
        ])
        .env("BYCODA_OWNED_JOB_CHILD_MODE", "blocked")
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

fn captured_handle(job: &OwnedProcessJob, pid: u32) -> *const OwnedHandle {
    job.members
        .lock()
        .unwrap()
        .iter()
        .find_map(|(&(member_pid, _), handle)| {
            (member_pid == pid).then(|| std::sync::Arc::as_ptr(handle))
        })
        .expect("the live member was never captured")
}

#[test]
fn captured_member_is_not_reopened_by_later_observations() {
    let job = OwnedProcessJob::new().unwrap();
    let mut member = job.spawn(&mut blocked_child()).unwrap();
    let mut output = BufReader::new(member.stdout.take().unwrap());
    let mut line = String::new();
    loop {
        line.clear();
        assert_ne!(
            output.read_line(&mut line).unwrap(),
            0,
            "member exited early"
        );
        if line.contains("owned-job-ready") {
            break;
        }
    }
    // spawn() already captured the member. Repeated supervision ticks must not
    // open it again (member handles, IsProcessInJob, GetProcessTimes) nor swap
    // the HANDLE that pins its PID.
    let pid = member.id();
    let opens_before = job.member_opens.lock().unwrap()[&pid];
    let handle_before = captured_handle(&job, pid);
    for _ in 0..5 {
        job.observe();
    }
    assert_eq!(
        job.member_opens.lock().unwrap()[&pid],
        opens_before,
        "later observations re-opened a captured member"
    );
    assert_eq!(captured_handle(&job, pid), handle_before);
    assert!(!job.uncertain.load(Ordering::Acquire));
    member
        .stdin
        .take()
        .unwrap()
        .write_all(b"release\n")
        .unwrap();
    assert!(member.wait().unwrap().success());
    job.settle()
        .expect("captured member retirement stays verified");
}
