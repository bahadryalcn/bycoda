use std::io;
use std::process::{Child, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(super) fn reap(kids: Vec<Arc<super::LivePty>>) {
    for live in &kids {
        live.output.set_enabled(false);
        if let Some(child) = &live.child {
            child.signal(libc::SIGHUP);
            child.signal(libc::SIGTERM);
        }
    }
    // Quit must deliver escalation before the process exits.
    std::thread::sleep(Duration::from_secs(1));
    for live in kids {
        if let Some(child) = &live.child {
            child.signal(libc::SIGKILL);
        }
    }
}

pub(super) struct UnixChild {
    child: Mutex<Child>,
    exited: AtomicBool,
    pid: u32,
}

impl UnixChild {
    pub(super) fn new(child: Child) -> Self {
        Self {
            pid: child.id(),
            child: Mutex::new(child),
            exited: AtomicBool::new(false),
        }
    }

    pub(super) fn signal(&self, signal: libc::c_int) {
        let mut child = self.child.lock().unwrap_or_else(|error| error.into_inner());
        match child.try_wait() {
            Ok(None) => unsafe {
                // The same guard serializes reaping and both signals. Until reaped,
                // even an exited leader retains its PID and process-group identity.
                libc::kill(self.pid as libc::pid_t, signal);
                libc::kill(-(self.pid as libc::pid_t), signal);
            },
            Ok(Some(_)) => {
                self.exited.store(true, Ordering::Release);
                // The shell was reaped, but its background members still hold
                // the group id (setsid makes the shell's pid its pgid).
                signal_populated_group(self.pid, signal);
            }
            Err(_) => {} // Unknown ownership never authorizes a signal.
        }
    }

    pub(super) fn terminate(self: &Arc<Self>) {
        self.signal(libc::SIGHUP);
        self.signal(libc::SIGTERM);
        let child = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(1));
            child.signal(libc::SIGKILL);
        });
    }

    pub(super) fn wait(&self) -> io::Result<ExitStatus> {
        loop {
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let result = unsafe {
                libc::waitid(
                    libc::P_PID,
                    self.pid as libc::id_t,
                    &mut info,
                    libc::WEXITED | libc::WNOWAIT,
                )
            };
            if result == 0 {
                break;
            }
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            let mut child = self.child.lock().unwrap_or_else(|error| error.into_inner());
            return match child.try_wait()? {
                Some(status) => {
                    self.exited.store(true, Ordering::Release);
                    Ok(status)
                }
                None => Err(error),
            };
        }
        let mut child = self.child.lock().unwrap_or_else(|error| error.into_inner());
        let status = child.wait()?;
        self.exited.store(true, Ordering::Release);
        Ok(status)
    }
}

/// After the shell exits, background jobs may keep the PTY open. The reader
/// keeps going while they write; this bounds how long a silent PTY is kept.
const EXIT_IDLE: Duration = Duration::from_secs(30);

/// Signals a process group whose leader was already reaped. Its id cannot be
/// reused while members remain, so the probe only signals a populated group;
/// an empty group is never signalled.
fn signal_populated_group(pid: u32, signal: libc::c_int) {
    let group = -(pid as libc::pid_t);
    unsafe {
        if libc::kill(group, 0) == 0 {
            libc::kill(group, signal);
        }
    }
}

pub(super) fn reader_ready(
    fd: i32,
    child: &UnixChild,
    deadline: &mut Option<Instant>,
    timeout: Duration,
) -> bool {
    if child.exited.load(Ordering::Acquire) && deadline.is_none() {
        *deadline = Some(Instant::now() + EXIT_IDLE);
    }
    let timeout = match deadline {
        Some(end) => {
            let remaining = end.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            timeout.min(remaining)
        }
        None => timeout,
    };
    super::wait_readable(fd, timeout)
}

/// Bytes read after the shell exited renew the idle bound. Readiness alone does
/// not: a hung-up PTY stays readable until its EOF is read.
pub(super) fn output_read(deadline: &mut Option<Instant>) {
    if let Some(end) = deadline {
        *end = Instant::now() + EXIT_IDLE;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::io::AsRawFd;
    use std::process::{Command, Stdio};

    #[test]
    fn exited_child_is_not_signalled_by_late_escalation() {
        let child = Arc::new(UnixChild::new(
            Command::new("/bin/sh")
                .args(["-c", "exit 0"])
                .spawn()
                .unwrap(),
        ));
        child.wait().unwrap();
        child.signal(libc::SIGKILL);
        assert!(child.exited.load(Ordering::Acquire));
    }

    #[test]
    fn descendant_held_pipe_has_bounded_incomplete_drain() {
        let mut process = Command::new("/bin/sh")
            .args(["-c", "sleep 4 & exit 0"])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let pipe = process.stdout.take().unwrap();
        let child = UnixChild::new(process);
        child.wait().unwrap();
        let mut deadline = None;
        while reader_ready(
            pipe.as_raw_fd(),
            &child,
            &mut deadline,
            Duration::from_millis(250),
        ) || deadline.is_none_or(|end| Instant::now() < end)
        {}
        assert!(deadline.is_some());
    }
}
