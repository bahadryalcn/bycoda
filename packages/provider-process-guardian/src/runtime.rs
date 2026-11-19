//! One provider per guardian. Only its supervisor owns the original Child;
//! control admission never takes the provider stdin writer's IO lock.
use crate::protocol::{
    self, Binding, GuardianReply, ParentCommand, Refusal, Retirement, StartDetail, StartFailure,
    Stream, VERSION,
};
use std::io::{self, BufRead, Read, Write};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use uuid::Uuid;

const WRITE_QUEUE_CAPACITY: usize = 32;
/// How long a leader may outlive its stop request before the supervisor stops
/// waiting for its exit status.
const STOP_DEADLINE: Duration = Duration::from_secs(10);
/// How long unverified retirement waits for provider I/O threads to finish.
const WORKER_JOIN_DEADLINE: Duration = Duration::from_secs(10);

/// The provider must never inherit the parent's private control endpoints.
/// Its three data pipes are installed separately by Command before execution.
pub fn protect_control_handles() -> io::Result<()> {
    #[cfg(unix)]
    for fd in [libc::STDIN_FILENO, libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};
        for handle in [
            std::io::stdin().as_raw_handle(),
            std::io::stdout().as_raw_handle(),
            std::io::stderr().as_raw_handle(),
        ] {
            if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
                return Err(io::Error::last_os_error());
            }
        }
    }
    Ok(())
}

struct Output<W> {
    writer: Mutex<W>,
    broken: AtomicBool,
}
impl<W: Write> Output<W> {
    fn emit(&self, reply: GuardianReply) -> io::Result<()> {
        if self.broken.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Private output unavailable",
            ));
        }
        let result = self
            .writer
            .lock()
            .map_err(|_| io::Error::other("Private output unavailable"))
            .and_then(|mut writer| protocol::write_reply(&mut *writer, &reply));
        if result.is_err() {
            self.broken.store(true, Ordering::Release);
        }
        result
    }
}

struct WriteWork {
    id: u64,
    bytes: Vec<u8>,
}
struct Admission {
    sender: Option<SyncSender<WriteWork>>,
}
struct Control {
    admission: Mutex<Admission>,
    stopping: AtomicBool,
    uncertain: AtomicBool,
    /// Wakes the supervisor out of its blocking wait. One pending wake is enough.
    wake: SyncSender<()>,
}
impl Control {
    fn new(sender: SyncSender<WriteWork>, wake: SyncSender<()>) -> Self {
        Self {
            admission: Mutex::new(Admission {
                sender: Some(sender),
            }),
            stopping: AtomicBool::new(false),
            uncertain: AtomicBool::new(false),
            wake,
        }
    }
    fn stop(&self) {
        // This lock covers only try_send/sender removal, never a blocking write.
        let mut admission = self.admission.lock().unwrap_or_else(|error| {
            self.uncertain.store(true, Ordering::Release);
            error.into_inner()
        });
        self.stopping.store(true, Ordering::Release);
        admission.sender.take();
        // A Full wake already pending will still reach the supervisor after this flag.
        let _ = self.wake.try_send(());
    }
    fn admit(&self, work: WriteWork) -> Result<(), Refusal> {
        let admission = self.admission.lock().map_err(|_| Refusal::Stopping)?;
        let sender = admission.sender.as_ref().ok_or(Refusal::Stopping)?;
        match sender.try_send(work) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err(Refusal::Capacity),
            Err(TrySendError::Disconnected(_)) => Err(Refusal::Stopping),
        }
    }
}

struct Original {
    child: Child,
    #[cfg(windows)]
    job: crate::windows_job::OwnedProcessJob,
}
/// Win32 failure of the owning job, reduced to the bounded wire detail.
#[cfg(windows)]
fn job_detail(error: &crate::windows_job::OwnedJobError) -> StartDetail {
    use crate::windows_job::OwnedJobError;
    match error {
        OwnedJobError::Api { step, code } => {
            let code = i32::try_from(*code).ok().filter(|code| *code != 0);
            let kind = code.map_or(io::ErrorKind::Other, |code| {
                io::Error::from_raw_os_error(code).kind()
            });
            StartDetail::new(step, &format!("{kind:?}"), code)
        }
        OwnedJobError::State(reason) => StartDetail::new(reason, "Other", None),
        other => StartDetail::new(&other.to_string(), "Other", None),
    }
}

impl Original {
    /// Failure keeps the failing step and OS error, never a path or message.
    fn spawn(command: &mut Command) -> Result<Self, StartDetail> {
        #[cfg(windows)]
        {
            let job = crate::windows_job::OwnedProcessJob::new().map_err(|e| job_detail(&e))?;
            let child = job.spawn(command).map_err(|e| job_detail(&e))?;
            Ok(Self { child, job })
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::process::CommandExt;
            // The provider leads its own process group on every Unix, so one
            // group signal reaches the shells and servers it started. A
            // descendant that calls setsid/setpgid leaves the group; that is
            // why retirement stays unsupported off Windows rather than verified.
            command.process_group(0);
            #[cfg(target_os = "linux")]
            {
                let parent = unsafe { libc::getpid() };
                unsafe {
                    command.pre_exec(move || {
                        // Linux only: the kernel kills the provider if this
                        // guardian dies. macOS has no equivalent; there the
                        // control-pipe EOF path in `run` retires the group.
                        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                            return Err(io::Error::last_os_error());
                        }
                        if libc::getppid() != parent {
                            libc::_exit(127);
                        }
                        Ok(())
                    });
                }
            }
            command
                .spawn()
                .map(|child| Self { child })
                .map_err(|error| StartDetail::from_io("spawn", &error))
        }
    }
    fn stop(&mut self, uncertain: &AtomicBool) {
        #[cfg(windows)]
        self.job.terminate();
        // The group id is the leader's pid. The leader is still unreaped here
        // (the supervisor only reaps after stop), so its pid cannot be reused.
        #[cfg(unix)]
        if unsafe { libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL) } != 0 {
            uncertain.store(true, Ordering::Release);
        }
        #[cfg(not(windows))]
        if self.child.kill().is_err() {
            uncertain.store(true, Ordering::Release);
        }
        #[cfg(windows)]
        let _ = uncertain;
    }
    fn observe(&self) {
        #[cfg(windows)]
        self.job.observe();
    }
    fn drain(&self) -> Retirement {
        #[cfg(windows)]
        {
            match self.job.drain() {
                Ok(drained) if drained.require_verified().is_ok() => Retirement::Verified,
                _ => Retirement::Unknown,
            }
        }
        #[cfg(not(windows))]
        {
            Retirement::Unsupported
        }
    }
}

struct Active {
    binding: Binding,
    control: Arc<Control>,
    monitor: JoinHandle<()>,
    last_id: u64,
}
impl Active {
    fn operation<W: Write>(
        &mut self,
        version: u8,
        supplied: Binding,
        id: u64,
        data: Option<String>,
        output: &Output<W>,
    ) -> io::Result<()> {
        let reason = if supplied != self.binding {
            Some(Refusal::Identity)
        } else if version != VERSION || id == 0 || id > protocol::MAX_COMMAND_ID {
            Some(Refusal::Invalid)
        } else if id <= self.last_id {
            Some(Refusal::Sequence)
        } else {
            self.last_id = id;
            if let Some(data) = data {
                match protocol::decode_data(&data) {
                    Err(_) => Some(Refusal::Invalid),
                    Ok(bytes) => self.control.admit(WriteWork { id, bytes }).err(),
                }
            } else if self.control.stopping.load(Ordering::Acquire) {
                Some(Refusal::Stopping)
            } else {
                self.control.stop();
                None
            }
        };
        if let Some(reason) = reason {
            reject(output, supplied, id, reason)?;
        }
        Ok(())
    }
}

fn reject<W: Write>(
    output: &Output<W>,
    supplied: Binding,
    id: u64,
    reason: Refusal,
) -> io::Result<()> {
    output.emit(GuardianReply::Rejected {
        version: VERSION,
        guardian_id: supplied.guardian_id,
        parent_id: supplied.parent_id,
        owner_id: supplied.owner_id,
        id,
        reason,
    })
}

fn forward<W: Write>(
    mut reader: impl Read,
    stream: Stream,
    output: &Output<W>,
    binding: &Binding,
    control: &Control,
) -> io::Result<()> {
    let mut bytes = vec![0u8; protocol::MAX_DATA_BYTES];
    loop {
        let size = match reader.read(&mut bytes) {
            Ok(0) => return Ok(()),
            Ok(size) => size,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                control.uncertain.store(true, Ordering::Release);
                control.stop();
                return Err(error);
            }
        };
        if let Err(error) = output.emit(GuardianReply::Data {
            version: VERSION,
            guardian_id: binding.guardian_id.clone(),
            parent_id: binding.parent_id.clone(),
            owner_id: binding.owner_id.clone(),
            stream,
            data: protocol::encode_data(&bytes[..size]),
        }) {
            control.uncertain.store(true, Ordering::Release);
            control.stop();
            return Err(error);
        }
    }
}

fn write_provider<W: Write>(
    mut stdin: ChildStdin,
    receiver: Receiver<WriteWork>,
    output: &Output<W>,
    binding: &Binding,
    control: &Control,
) -> io::Result<()> {
    for work in receiver {
        let result = if control.stopping.load(Ordering::Acquire) {
            Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Original writer stopped",
            ))
        } else {
            stdin.write_all(&work.bytes).and_then(|()| stdin.flush())
        };
        let ok = result.is_ok();
        if !ok {
            control.stop();
        }
        if let Err(error) = output.emit(GuardianReply::Written {
            version: VERSION,
            guardian_id: binding.guardian_id.clone(),
            parent_id: binding.parent_id.clone(),
            owner_id: binding.owner_id.clone(),
            id: work.id,
            ok,
        }) {
            control.uncertain.store(true, Ordering::Release);
            control.stop();
            return Err(error);
        }
    }
    Ok(())
}

/// Blocks until the leader exits, without reaping it: `WNOWAIT` keeps its pid and
/// process-group id owned by this guardian until the supervisor's `try_wait` reaps it.
#[cfg(unix)]
fn await_exit(pid: u32) -> io::Result<()> {
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        if result == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

/// Blocks until the exit waiter or a stop request wakes the supervisor. After a
/// stop, the wait is capped by the stop deadline so the loop can give up.
#[cfg(unix)]
fn wait_for_wake(wake: &Receiver<()>, stopped_at: Option<Instant>) {
    match stopped_at {
        Some(at) => {
            let _ = wake.recv_timeout(STOP_DEADLINE.saturating_sub(at.elapsed()));
        }
        None => {
            let _ = wake.recv();
        }
    }
}

fn supervise<W: Write + Send + 'static>(
    mut original: Original,
    receiver: Receiver<WriteWork>,
    wake: Receiver<()>,
    output: Arc<Output<W>>,
    binding: Binding,
    control: Arc<Control>,
    build_receipt: Option<crate::build_receipt::BuildReceipt>,
) {
    let mut workers: Vec<JoinHandle<io::Result<()>>> = Vec::new();
    if let Some(stdin) = original.child.stdin.take() {
        let (worker_output, worker_binding, worker_control) =
            (output.clone(), binding.clone(), control.clone());
        match thread::Builder::new()
            .name("provider-guardian-input".into())
            .spawn(move || {
                write_provider(
                    stdin,
                    receiver,
                    &worker_output,
                    &worker_binding,
                    &worker_control,
                )
            }) {
            Ok(worker) => workers.push(worker),
            Err(_) => {
                control_failure(&control);
            }
        }
    } else {
        control_failure(&control);
    }
    for stream in [Stream::Stdout, Stream::Stderr] {
        let reader: Option<Box<dyn Read + Send>> = match stream {
            Stream::Stdout => original
                .child
                .stdout
                .take()
                .map(|reader| Box::new(reader) as Box<dyn Read + Send>),
            Stream::Stderr => original
                .child
                .stderr
                .take()
                .map(|reader| Box::new(reader) as Box<dyn Read + Send>),
        };
        if let Some(reader) = reader {
            let (worker_output, worker_binding, worker_control) =
                (output.clone(), binding.clone(), control.clone());
            match thread::Builder::new()
                .name("provider-guardian-output".into())
                .spawn(move || {
                    forward(
                        reader,
                        stream,
                        &worker_output,
                        &worker_binding,
                        &worker_control,
                    )
                }) {
                Ok(worker) => workers.push(worker),
                Err(_) => {
                    control_failure(&control);
                }
            }
        } else {
            control_failure(&control);
        }
    }
    #[cfg(windows)]
    let _ = &wake;
    #[cfg(unix)]
    let waiter_failed = Arc::new(AtomicBool::new(false));
    #[cfg(unix)]
    {
        let (pid, failed, exit_wake) = (
            original.child.id(),
            waiter_failed.clone(),
            control.wake.clone(),
        );
        let spawned = thread::Builder::new()
            .name("provider-guardian-exit".into())
            .spawn(move || {
                if await_exit(pid).is_err() {
                    failed.store(true, Ordering::Release);
                }
                let _ = exit_wake.try_send(());
            });
        if spawned.is_err() {
            control_failure(&control);
        }
    }
    let mut stopped_at: Option<Instant> = None;
    let status: Option<ExitStatus> = loop {
        original.observe();
        if stopped_at.is_none() && control.stopping.load(Ordering::Acquire) {
            original.stop(&control.uncertain);
            stopped_at = Some(Instant::now());
        }
        // A leader that survives its stop request must not hold this supervisor
        // (and the session's Settled receipt) forever. Report no exit status:
        // retirement is then Unknown, never Verified, and drain still runs.
        if stopped_at.is_some_and(|at| deadline_passed(at, STOP_DEADLINE)) {
            control.uncertain.store(true, Ordering::Release);
            break None;
        }
        match original.child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                #[cfg(windows)]
                original.job.wait_for_activity(50);
                #[cfg(unix)]
                {
                    if waiter_failed.load(Ordering::Acquire) {
                        // Lost exit wait: same owner-loss path as a failed try_wait.
                        control.uncertain.store(true, Ordering::Release);
                        break original.child.wait().ok();
                    }
                    wait_for_wake(&wake, stopped_at);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => {
                control.uncertain.store(true, Ordering::Release);
                // No further numeric stop may follow a lost Unix wait owner.
                #[cfg(windows)]
                original.job.terminate();
                break original.child.wait().ok();
            }
        }
    };
    // Closing admission precedes joining the input worker, so it cannot wait on
    // an otherwise idle receiver after natural provider exit. Accepted tasks drain.
    control.stop();
    // The original leader can exit while enrolled descendants retain its pipes.
    // Retire that retained kernel job before waiting for their actual IO/handles;
    // never send a late numeric Unix signal after the leader was reaped.
    #[cfg(windows)]
    original.job.terminate();
    let mut retirement = original.drain();
    // Physical containment proof is independent of the parent output pipe. A
    // lost parent may break transport while the owned kernel job still drains.
    // A receipt that cannot be written leaves the parent without proof: report
    // Unknown instead of a Verified retirement the parent cannot confirm.
    if crate::build_receipt::publish_if_verified(build_receipt, retirement, status.is_some())
        .is_err()
    {
        retirement = Retirement::Unknown;
    }
    // A verified drain means the job is empty, so every pipe holder is gone and
    // each join returns. An unknown drain or a lost exit status can leave a
    // survivor holding the pipes: bound the wait and report Unknown instead of
    // blocking Settled. Normal exits keep the unbounded join so slow parents
    // still receive every output byte.
    let bounded = status.is_none() || retirement == Retirement::Unknown;
    if !join_workers(workers, bounded.then_some(WORKER_JOIN_DEADLINE)) {
        control.uncertain.store(true, Ordering::Release);
    }
    if status.is_none() || control.uncertain.load(Ordering::Acquire) {
        retirement = Retirement::Unknown;
    }
    let _ = output.emit(GuardianReply::Settled {
        version: VERSION,
        guardian_id: binding.guardian_id,
        parent_id: Some(binding.parent_id),
        owner_id: Some(binding.owner_id),
        exit_code: status.and_then(|value| value.code()),
        retirement,
    });
}

/// Join every worker; `false` if one failed or, with a limit, did not finish in
/// time. Unfinished workers are detached: they end when their pipe closes or the
/// guardian exits after parent EOF.
fn join_workers(workers: Vec<JoinHandle<io::Result<()>>>, limit: Option<Duration>) -> bool {
    let started = Instant::now();
    let mut clean = true;
    for worker in workers {
        if let Some(limit) = limit {
            while !worker.is_finished() {
                if deadline_passed(started, limit) {
                    return false;
                }
                thread::sleep(Duration::from_millis(5));
            }
        }
        if !matches!(worker.join(), Ok(Ok(()))) {
            clean = false;
        }
    }
    clean
}

fn deadline_passed(started: Instant, limit: Duration) -> bool {
    started.elapsed() >= limit
}

fn control_failure(control: &Control) {
    control.uncertain.store(true, Ordering::Release);
    control.stop();
}

fn not_started<W: Write>(
    output: &Output<W>,
    guardian_id: &str,
    parent_id: Option<String>,
    reason: StartFailure,
    detail: Option<StartDetail>,
) -> io::Result<()> {
    output.emit(GuardianReply::Failed {
        version: VERSION,
        guardian_id: guardian_id.into(),
        parent_id: parent_id.clone(),
        reason,
        detail,
    })?;
    output.emit(GuardianReply::Settled {
        version: VERSION,
        guardian_id: guardian_id.into(),
        parent_id,
        owner_id: None,
        exit_code: None,
        retirement: Retirement::NotStarted,
    })
}

fn start<W: Write + Send + 'static>(
    guardian_id: &str,
    parent_id: String,
    mut command: Command,
    output: Arc<Output<W>>,
    build_receipt: Option<crate::build_receipt::BuildReceipt>,
) -> io::Result<Option<Active>> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let original = match Original::spawn(&mut command) {
        Ok(original) => original,
        Err(detail) => {
            not_started(
                &output,
                guardian_id,
                Some(parent_id),
                StartFailure::SpawnFailed,
                Some(detail),
            )?;
            return Ok(None);
        }
    };
    // Issue only after capturing the actual new Child, never from the request.
    let binding = Binding {
        guardian_id: guardian_id.into(),
        parent_id,
        owner_id: Uuid::new_v4().to_string(),
    };
    let (sender, receiver) = mpsc::sync_channel(WRITE_QUEUE_CAPACITY);
    let (wake_sender, wake) = mpsc::sync_channel(1);
    let control = Arc::new(Control::new(sender, wake_sender));
    let started = output.emit(GuardianReply::Started {
        version: VERSION,
        guardian_id: binding.guardian_id.clone(),
        parent_id: binding.parent_id.clone(),
        owner_id: binding.owner_id.clone(),
        pid: original.child.id(),
    });
    if let Err(error) = started {
        control_failure(&control);
        supervise(
            original,
            receiver,
            wake,
            output,
            binding,
            control,
            build_receipt,
        );
        return Err(error);
    }
    // Retain a second owner of the slot until the supervisor actually takes it.
    // A failed thread spawn cannot drop a still-running Child without cleanup.
    let slot = Arc::new(Mutex::new(Some((original, receiver, wake))));
    let (thread_slot, thread_output, thread_binding, thread_control) = (
        slot.clone(),
        output.clone(),
        binding.clone(),
        control.clone(),
    );
    let thread_receipt = build_receipt.clone();
    let monitor = thread::Builder::new()
        .name("provider-guardian-owner".into())
        .spawn(move || {
            let owned = thread_slot
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take();
            if let Some((original, receiver, wake)) = owned {
                supervise(
                    original,
                    receiver,
                    wake,
                    thread_output,
                    thread_binding,
                    thread_control,
                    thread_receipt,
                );
            }
        });
    match monitor {
        Ok(monitor) => Ok(Some(Active {
            binding,
            control,
            monitor,
            last_id: 0,
        })),
        Err(_) => {
            control_failure(&control);
            if let Some((original, receiver, wake)) = slot
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take()
            {
                supervise(
                    original,
                    receiver,
                    wake,
                    output,
                    binding,
                    control,
                    build_receipt,
                );
            }
            Ok(None)
        }
    }
}

/// Main thread is the private control reader. After terminal output it remains
/// here until parent EOF; no blocked background control reader is abandoned.
pub fn run<W: Write + Send + 'static>(input: &mut impl BufRead, writer: W) -> io::Result<()> {
    let guardian_id = Uuid::new_v4().to_string();
    let output = Arc::new(Output {
        writer: Mutex::new(writer),
        broken: AtomicBool::new(false),
    });
    let platform = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "unsupported"
    };
    output.emit(GuardianReply::Ready {
        version: VERSION,
        guardian_id: guardian_id.clone(),
        platform: platform.into(),
        containment: if cfg!(windows) {
            "windows-job".into()
        } else {
            "original-child".into()
        },
    })?;
    let mut active: Option<Active> = None;
    let mut attempted = false;
    let result = loop {
        let command = match protocol::read_command(input) {
            Ok(Some(command)) => command,
            Ok(None) => {
                if !attempted {
                    if let Err(error) = output.emit(GuardianReply::Settled {
                        version: VERSION,
                        guardian_id: guardian_id.clone(),
                        parent_id: None,
                        owner_id: None,
                        exit_code: None,
                        retirement: Retirement::NotStarted,
                    }) {
                        break Err(error);
                    }
                }
                break Ok(());
            }
            Err(error) => {
                if !attempted {
                    let _ = not_started(
                        &output,
                        &guardian_id,
                        None,
                        StartFailure::InvalidStart,
                        None,
                    );
                }
                break Err(error);
            }
        };
        let handled = match command {
            ParentCommand::Start {
                version,
                guardian_id: supplied,
                parent_id,
                command,
                args,
                cwd,
                env,
                build_receipt,
            } => {
                if attempted {
                    output.emit(GuardianReply::Failed {
                        version: VERSION,
                        guardian_id: guardian_id.clone(),
                        parent_id: Some(parent_id),
                        reason: StartFailure::InvalidStart,
                        detail: None,
                    })
                } else {
                    attempted = true;
                    if version != VERSION
                        || supplied != guardian_id
                        || !protocol::valid_start(&command, &args, &cwd, &env)
                        || build_receipt
                            .as_ref()
                            .is_some_and(|receipt| !receipt.valid() || !cfg!(windows))
                    {
                        not_started(
                            &output,
                            &guardian_id,
                            Some(parent_id),
                            StartFailure::InvalidStart,
                            None,
                        )
                    } else if platform == "unsupported" {
                        not_started(
                            &output,
                            &guardian_id,
                            Some(parent_id),
                            StartFailure::Unsupported,
                            None,
                        )
                    } else {
                        let mut process = Command::new(command);
                        process.args(args).current_dir(cwd).env_clear().envs(env);
                        match start(
                            &guardian_id,
                            parent_id,
                            process,
                            output.clone(),
                            build_receipt,
                        ) {
                            Ok(owner) => {
                                active = owner;
                                Ok(())
                            }
                            Err(error) => Err(error),
                        }
                    }
                }
            }
            ParentCommand::Write {
                version,
                guardian_id,
                parent_id,
                owner_id,
                id,
                data,
            } => {
                let supplied = Binding {
                    guardian_id,
                    parent_id,
                    owner_id,
                };
                if let Some(owner) = active.as_mut() {
                    owner.operation(version, supplied, id, Some(data), &output)
                } else {
                    reject(&output, supplied, id, Refusal::Identity)
                }
            }
            ParentCommand::Stop {
                version,
                guardian_id,
                parent_id,
                owner_id,
                id,
            } => {
                let supplied = Binding {
                    guardian_id,
                    parent_id,
                    owner_id,
                };
                if let Some(owner) = active.as_mut() {
                    owner.operation(version, supplied, id, None, &output)
                } else {
                    reject(&output, supplied, id, Refusal::Identity)
                }
            }
        };
        if let Err(error) = handled {
            break Err(error);
        }
    };
    if let Some(active) = active {
        active.control.stop();
        if active.monitor.join().is_err() {
            return Err(io::Error::other("Provider owner unavailable"));
        }
    }
    if output.broken.load(Ordering::Acquire) {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "Private output unavailable",
        ));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_passes_only_after_its_limit() {
        let started = Instant::now();
        assert!(!deadline_passed(started, Duration::from_secs(3600)));
        assert!(deadline_passed(started, Duration::ZERO));
    }

    #[test]
    fn bounded_join_gives_up_on_a_worker_that_never_finishes() {
        let (release, blocked) = mpsc::channel::<()>();
        let stuck: JoinHandle<io::Result<()>> = thread::spawn(move || {
            let _ = blocked.recv();
            Ok(())
        });
        let started = Instant::now();
        assert!(!join_workers(vec![stuck], Some(Duration::from_millis(60))));
        assert!(started.elapsed() < Duration::from_secs(5));
        // The detached worker still ends once its blocker is released.
        drop(release);
    }

    #[test]
    fn bounded_join_accepts_finished_workers_and_reports_failed_ones() {
        let done: JoinHandle<io::Result<()>> = thread::spawn(|| Ok(()));
        assert!(join_workers(vec![done], Some(Duration::from_secs(5))));
        let failed: JoinHandle<io::Result<()>> = thread::spawn(|| Err(io::Error::other("x")));
        assert!(!join_workers(vec![failed], Some(Duration::from_secs(5))));
        let unbounded: JoinHandle<io::Result<()>> = thread::spawn(|| Ok(()));
        assert!(join_workers(vec![unbounded], None));
    }

    #[test]
    fn stop_wakes_the_supervisor_instead_of_waiting_for_a_poll() {
        let (sender, _receiver) = mpsc::sync_channel(WRITE_QUEUE_CAPACITY);
        let (wake_sender, wake) = mpsc::sync_channel(1);
        let control = Control::new(sender, wake_sender);
        control.stop();
        assert!(wake.recv_timeout(Duration::from_secs(5)).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn exit_wait_returns_without_reaping_the_leader() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .unwrap();
        await_exit(child.id()).unwrap();
        // WNOWAIT left the exited leader unreaped, so try_wait still reaps it.
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn start_detail_keeps_kind_and_os_code_without_message_text() {
        let error = io::Error::from_raw_os_error(2);
        let detail = StartDetail::from_io("spawn", &error);
        assert_eq!(detail.step, "spawn");
        assert_eq!(detail.kind, "NotFound");
        assert_eq!(detail.code, Some(2));
        let other = StartDetail::from_io("spawn", &io::Error::other(r"secret path C:\x"));
        assert_eq!(other.kind, "Other");
        assert_eq!(other.code, None);
        let long = StartDetail::new(&"s".repeat(500), &"k".repeat(500), None);
        assert_eq!(long.step.len(), protocol::MAX_DETAIL_TEXT);
        assert_eq!(long.kind.len(), protocol::MAX_DETAIL_TEXT);
    }
}
