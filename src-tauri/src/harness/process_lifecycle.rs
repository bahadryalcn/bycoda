//! Original OS resource ownership. A deadline is a stop request, never a join.
use std::io;
use std::ops::{Deref, DerefMut};
use std::process::{Child, Command, ExitStatus};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub(crate) struct OwnedChild {
    child: Child,
    #[cfg(windows)]
    job: Option<Arc<crate::owned_process_job::OwnedProcessJob>>,
}
impl From<Child> for OwnedChild {
    fn from(child: Child) -> Self {
        Self {
            child,
            #[cfg(windows)]
            job: None,
        }
    }
}
impl Deref for OwnedChild {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl DerefMut for OwnedChild {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}
impl OwnedChild {
    pub(crate) fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        {
            let job = Arc::new(
                crate::owned_process_job::OwnedProcessJob::new()
                    .map_err(|_| io::Error::other("Owned process job unavailable"))?,
            );
            let child = job
                .spawn(command)
                .map_err(|_| io::Error::other("Owned process job spawn failed"))?;
            Ok(Self {
                child,
                job: Some(job),
            })
        }
        #[cfg(unix)]
        {
            super::spawn_retrying_text_file_busy(command).map(Into::into)
        }
        #[cfg(not(any(unix, windows)))]
        {
            command.spawn().map(Into::into)
        }
    }
}

#[derive(Clone)]
struct Failure {
    kind: io::ErrorKind,
    message: String,
}
impl Failure {
    fn from(error: io::Error) -> Self {
        Self {
            kind: error.kind(),
            message: error.to_string(),
        }
    }
    fn error(&self) -> io::Error {
        io::Error::new(self.kind, self.message.clone())
    }
}
#[cfg(any(windows, test))]
fn retirement_result(drain: impl FnOnce() -> Result<(), String>) -> Result<(), Failure> {
    drain().map_err(|message| Failure::from(io::Error::other(message)))
}

/// Exit-poll interval bounds: start tight so short-lived children are seen quickly,
/// then relax so a long-running provider is not woken 200 times a second.
const POLL_MIN: Duration = Duration::from_millis(5);
const POLL_MAX: Duration = Duration::from_millis(250);
fn record_completion(
    state: &mut State,
    result: io::Result<ExitStatus>,
    retirement: Result<(), Failure>,
) {
    state.result = Some(result.map_err(Failure::from));
    state.retirement = Some(retirement);
    state.finalizing = false;
}
struct Stop {
    #[cfg(unix)]
    deadline: Instant,
    killed: bool,
}
struct State {
    child: OwnedChild,
    activated: bool,
    pins: usize,
    exit_seen: Option<Instant>,
    stop: Option<Stop>,
    finalizing: bool,
    reaped: bool,
    result: Option<Result<ExitStatus, Failure>>,
    signal_error: Option<Failure>,
    retirement: Option<Result<(), Failure>>,
}
/// Source-retained evidence; callers cannot reconstruct it from a DTO/bool/PID.
#[derive(Clone)]
pub(crate) struct Retirement {
    owner: Arc<ProcessOwner>,
}
impl Retirement {
    pub(crate) fn require_verified(&self) -> Result<(), String> {
        let state = self
            .owner
            .state
            .lock()
            .map_err(|_| "Original retirement owner unavailable")?;
        if !matches!(&state.result, Some(Ok(_))) {
            return Err("Original process completion unavailable".into());
        }
        match &state.retirement {
            Some(Ok(())) => Ok(()),
            Some(Err(error)) => Err(error.message.clone()),
            None => Err("Original process retirement pending".into()),
        }
    }
}
pub(crate) struct ProcessOwner {
    state: Mutex<State>,
    changed: Condvar,
}
pub(crate) struct ProcessPin {
    owner: Arc<ProcessOwner>,
}
impl Drop for ProcessPin {
    fn drop(&mut self) {
        let mut state = self.owner.state.lock().unwrap_or_else(|e| e.into_inner());
        state.pins -= 1;
        self.owner.changed.notify_all();
    }
}
impl ProcessOwner {
    pub(crate) fn retirement(self: &Arc<Self>) -> Retirement {
        Retirement {
            owner: self.clone(),
        }
    }
    #[cfg(test)]
    pub(crate) fn signals_closed(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stop
            .as_ref()
            .is_some_and(|s| s.killed)
    }
    #[cfg(test)]
    pub(crate) fn exit_observed(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .exit_seen
            .is_some()
    }
    #[cfg(test)]
    pub(crate) fn try_result(&self) -> io::Result<Option<ExitStatus>> {
        let state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("Process owner unavailable"))?;
        match &state.result {
            Some(Ok(status)) => Ok(Some(*status)),
            Some(Err(error)) => Err(error.error()),
            None => Ok(None),
        }
    }
    pub(crate) fn new(child: OwnedChild) -> Self {
        Self {
            state: Mutex::new(State {
                child,
                activated: false,
                pins: 0,
                exit_seen: None,
                stop: None,
                finalizing: false,
                reaped: false,
                result: None,
                signal_error: None,
                retirement: None,
            }),
            changed: Condvar::new(),
        }
    }
    pub(crate) fn pin(self: &Arc<Self>) -> io::Result<ProcessPin> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("Process owner unavailable"))?;
        if state.reaped || state.result.is_some() || state.finalizing {
            return Err(io::Error::other("Original process lifetime is closed"));
        }
        state.pins = state
            .pins
            .checked_add(1)
            .ok_or_else(|| io::Error::other("Process pin capacity"))?;
        Ok(ProcessPin {
            owner: self.clone(),
        })
    }
    /// Only the source's waiter closes setup, after it has enrolled its readers.
    pub(crate) fn activate(&self) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .activated = true;
        self.changed.notify_all();
    }
    pub(crate) fn request_stop(&self) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("Process owner unavailable"))?;
        if state.result.is_some() {
            return Ok(());
        }
        if state.reaped || state.finalizing {
            return Ok(());
        }
        Self::stop_locked(&mut state);
        self.changed.notify_all();
        Ok(())
    }
    fn stop_locked(state: &mut State) {
        if state.stop.is_some() || state.reaped || state.result.is_some() {
            return;
        }
        #[cfg(windows)]
        {
            if let Some(job) = &state.child.job {
                job.terminate();
            } else if let Err(error) = state.child.child.kill() {
                state.signal_error = Some(Failure::from(error));
            }
            state.stop = Some(Stop { killed: true });
        }
        #[cfg(unix)]
        {
            if let Err(error) = signal_original(state, libc::SIGTERM) {
                state.signal_error = Some(Failure::from(error));
            }
            state.stop = Some(Stop {
                deadline: Instant::now() + super::KILL_ESCALATE,
                killed: false,
            });
        }
        #[cfg(not(any(unix, windows)))]
        {
            if let Err(error) = state.child.child.kill() {
                state.signal_error = Some(Failure::from(error));
            }
            state.stop = Some(Stop { killed: true });
        }
    }
    pub(crate) fn wait(&self) -> io::Result<ExitStatus> {
        self.wait_until(None)
            .unwrap_or_else(|| Err(io::Error::other("Process wait did not settle")))
    }
    /// `None` means the deadline passed first; the process is not affected.
    pub(crate) fn wait_timeout(&self, timeout: Duration) -> Option<io::Result<ExitStatus>> {
        self.wait_until(Some(Instant::now() + timeout))
    }
    fn wait_until(&self, deadline: Option<Instant>) -> Option<io::Result<ExitStatus>> {
        let mut poll = POLL_MIN;
        loop {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(_) => return Some(Err(io::Error::other("Process owner unavailable"))),
            };
            if let Some(result) = &state.result {
                return Some(result.clone().map_err(|e| e.error()));
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                return None;
            }
            if state.activated && !state.finalizing {
                #[cfg(windows)]
                if let Some(job) = &state.child.job {
                    job.observe();
                }
                let ready = match observe_exit(&mut state) {
                    Ok(ready) => ready,
                    Err(error) => {
                        // ECHILD/unknown observation ends numeric control. Never reap or
                        // signal a PID after losing our original wait ownership.
                        state.result = Some(Err(Failure::from(error)));
                        self.changed.notify_all();
                        continue;
                    }
                };
                if ready {
                    let seen = *state.exit_seen.get_or_insert_with(Instant::now);
                    // Real inherited-pipe/writer work can outlive the leader. Keep it
                    // pinned, but initiate original group cleanup after the old grace.
                    if state.pins > 0 && seen.elapsed() >= super::EXIT_DRAIN_GRACE {
                        Self::stop_locked(&mut state);
                    }
                }
                #[cfg(unix)]
                if state
                    .stop
                    .as_ref()
                    .is_some_and(|s| !s.killed && Instant::now() >= s.deadline)
                {
                    if let Err(error) = signal_original(&state, libc::SIGKILL) {
                        state.signal_error = Some(Failure::from(error));
                    }
                    state.stop.as_mut().unwrap().killed = true;
                }
                let signals_closed = state.stop.as_ref().is_none_or(|s| s.killed);
                if ready && state.pins == 0 && signals_closed {
                    // WNOWAIT observed this exact unreaped child. No signal worker
                    // exists outside this mutex and none may start after this reap.
                    let result = state.child.child.wait();
                    state.reaped = true;
                    state.finalizing = true;
                    #[cfg(windows)]
                    let job = state.child.job.clone();
                    let signal_error = state.signal_error.clone();
                    drop(state);
                    // A failed tree drain does not change the direct child wait result,
                    // but cannot serve as proof of physical retirement.
                    #[cfg(windows)]
                    let retirement = if result.is_ok() {
                        retirement_result(|| {
                            if let Some(job) = job {
                                job.terminate();
                                job.drain()
                                    .map_err(|error| error.to_string())?
                                    .require_verified()
                                    .map_err(|error| error.to_string())?;
                            }
                            Ok(())
                        })
                    } else {
                        Ok(())
                    };
                    #[cfg(not(windows))]
                    let retirement = Ok(());
                    #[cfg(windows)]
                    if let Some(error) = &signal_error {
                        eprintln!("[harness] ignored process signal error: {}", error.message);
                    }
                    #[cfg(not(windows))]
                    let result = result
                        .and_then(|status| signal_error.map_or(Ok(status), |e| Err(e.error())));
                    let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                    record_completion(&mut state, result, retirement);
                    self.changed.notify_all();
                    continue;
                }
            }
            // Exit is observed by polling (no OS event reaches the condvar), so back off
            // while the child is simply running. Every state change notifies the condvar,
            // and the wait never overshoots a caller deadline, the kill escalation or the
            // drain grace, so stop and exit handling stay as prompt as before.
            let now = Instant::now();
            let mut wait = poll;
            if let Some(deadline) = deadline {
                wait = wait.min(deadline.saturating_duration_since(now));
            }
            #[cfg(unix)]
            if let Some(stop) = state.stop.as_ref().filter(|stop| !stop.killed) {
                wait = wait.min(stop.deadline.saturating_duration_since(now));
            }
            if let Some(seen) = state
                .exit_seen
                .filter(|seen| seen.elapsed() < super::EXIT_DRAIN_GRACE)
            {
                wait = wait.min((seen + super::EXIT_DRAIN_GRACE).saturating_duration_since(now));
            }
            let (guard, timeout) = self
                .changed
                .wait_timeout(state, wait.max(Duration::from_millis(1)))
                .unwrap_or_else(|e| e.into_inner());
            drop(guard);
            poll = if timeout.timed_out() {
                (poll * 2).min(POLL_MAX)
            } else {
                POLL_MIN
            };
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn observe_exit(state: &mut State) -> io::Result<bool> {
    exited_unreaped(state.child.id())
}
/// Non-reaping exit observation of this exact original child.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn exited_unreaped(child: u32) -> io::Result<bool> {
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                child as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == 0 {
            let pid = unsafe { info.si_pid() };
            if pid == 0 {
                return Ok(false);
            }
            if pid as u32 == child
                && matches!(
                    info.si_code,
                    libc::CLD_EXITED | libc::CLD_KILLED | libc::CLD_DUMPED
                )
            {
                return Ok(true);
            }
            return Err(io::Error::other("Original child exit observation changed"));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}
#[cfg(windows)]
fn observe_exit(state: &mut State) -> io::Result<bool> {
    state.child.child.try_wait().map(|status| status.is_some())
}
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn observe_exit(_state: &mut State) -> io::Result<bool> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Original non-reaping process observation unavailable",
    ))
}
#[cfg(unix)]
fn signal_original(state: &State, signal: i32) -> io::Result<()> {
    if state.reaped || state.result.is_some() {
        return Err(io::Error::other("Original process already reaped"));
    }
    let pid = state.child.id() as i32;
    if pid <= 1 {
        return Err(io::Error::other("Invalid original process"));
    }
    // This exact child remains unreaped until all signal phases are sealed.
    let group = unsafe { libc::kill(-pid, signal) };
    let group_error = if group != 0 {
        Some(io::Error::last_os_error())
    } else {
        None
    };
    let leader = unsafe { libc::kill(pid, signal) };
    if leader != 0 {
        let error = io::Error::last_os_error();
        if !no_live_target(state, &error) {
            return Err(error);
        }
    }
    if let Some(error) = group_error {
        if !no_live_target(state, &error) {
            return Err(error);
        }
    }
    Ok(())
}
/// ESRCH: nothing left to signal. Darwin also answers EPERM when the target
/// (or every member of its group) is a zombie; Linux counts the zombie leader
/// and succeeds. Accept that EPERM only while this exact original child is
/// proven exited and still unreaped, so a real permission failure stays an error.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
fn no_live_target(state: &State, error: &io::Error) -> bool {
    match error.raw_os_error() {
        Some(libc::ESRCH) => true,
        #[cfg(target_os = "macos")]
        Some(libc::EPERM) => exited_unreaped(state.child.id()).unwrap_or(false),
        _ => false,
    }
}

#[derive(Default)]
struct Writes {
    closing: bool,
    active: usize,
    failure: Option<String>,
}
#[derive(Default)]
pub(crate) struct WriteGate {
    state: Mutex<Writes>,
    changed: Condvar,
}
pub(crate) struct WritePermit {
    gate: Arc<WriteGate>,
}
impl WriteGate {
    pub(crate) fn is_closing(&self) -> bool {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).closing
    }
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub(crate) fn admit(self: &Arc<Self>) -> Result<WritePermit, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Original writer owner unavailable")?;
        if state.closing {
            return Err("Original process is closing".into());
        }
        state.active = state
            .active
            .checked_add(1)
            .ok_or("Original writer capacity")?;
        Ok(WritePermit { gate: self.clone() })
    }
    pub(crate) fn close(&self) {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).closing = true;
        self.changed.notify_all();
    }
    pub(crate) fn record_failure(&self, reason: String) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .failure
            .get_or_insert(reason);
    }
    /// `None` means active writers did not finish before the timeout.
    pub(crate) fn drain_timeout(&self, timeout: Duration) -> Option<Result<(), String>> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (state, _) = self
            .changed
            .wait_timeout_while(state, timeout, |s| s.active != 0)
            .unwrap_or_else(|e| e.into_inner());
        (state.active == 0).then(|| state.failure.clone().map_or(Ok(()), Err))
    }
    pub(crate) fn drain(&self) -> Result<(), String> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let state = self
            .changed
            .wait_while(state, |s| s.active != 0)
            .unwrap_or_else(|e| e.into_inner());
        state.failure.clone().map_or(Ok(()), Err)
    }
}
impl Drop for WritePermit {
    fn drop(&mut self) {
        self.gate
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active -= 1;
        self.gate.changed.notify_all();
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read};
    use std::process::Stdio;
    use std::sync::mpsc;

    #[test]
    fn owned_group_escalation_keeps_unreaped_leader_until_inherited_pipe_is_released() {
        let mut command = Command::new("sh");
        command.args(["-c", "trap 'exit 0' TERM; sh -c 'trap \"\" TERM; echo $$; while true; do sleep 1; done' & wait"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        super::super::isolate_child(&mut command);
        let mut child = OwnedChild::spawn(&mut command).unwrap();
        let stdout = child.stdout.take().unwrap();
        let owner = Arc::new(ProcessOwner::new(child));
        let pin = owner.pin().unwrap();
        let (ready, observed) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            let _pin = pin;
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            ready.send(line.trim().parse::<u32>().unwrap()).unwrap();
            let mut rest = Vec::new();
            reader.read_to_end(&mut rest).unwrap();
        });
        let _actual_descendant = observed.recv_timeout(Duration::from_secs(5)).unwrap();
        owner.activate();
        owner.request_stop().unwrap();
        let waiting = owner.clone();
        let (returned, completion) = mpsc::channel();
        let waiter = std::thread::spawn(move || {
            returned.send(waiting.wait()).unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !owner.exit_observed() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(
            owner.try_result().unwrap().is_none(),
            "the leader must remain unreaped during escalation"
        );
        assert!(completion.recv_timeout(Duration::from_millis(20)).is_err());
        assert!(completion
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .is_ok());
        reader.join().unwrap();
        waiter.join().unwrap();
        owner.request_stop().unwrap();
        assert!(owner.pin().is_err());
    }
}

#[cfg(test)]
mod retirement_tests {
    use super::*;

    #[test]
    fn successful_child_wait_does_not_hide_failed_tree_retirement() {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.args(["/C", "exit", "0"]);
            crate::hide_window_console(&mut command);
            command
        };
        #[cfg(unix)]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "exit 0"]);
            command
        };
        let child = OwnedChild::spawn(&mut command).unwrap();
        let owner = Arc::new(ProcessOwner::new(child));
        owner.activate();
        let status = owner.wait().unwrap();
        assert!(status.success());
        assert!(owner.retirement().require_verified().is_ok());
        record_completion(
            &mut owner.state.lock().unwrap(),
            Ok(status),
            retirement_result(|| Err("injected drain failure".into())),
        );
        assert!(owner.wait().unwrap().success());
        assert_eq!(
            owner.retirement().require_verified().unwrap_err(),
            "injected drain failure"
        );
        assert!(retirement_result(|| Ok(())).is_ok());
    }
}
