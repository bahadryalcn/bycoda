//! One provider per guardian. Only its supervisor owns the original Child;
//! control admission never takes the provider stdin writer's IO lock.
use crate::protocol::{
    self, Binding, GuardianReply, ParentCommand, Refusal, Retirement, StartFailure, Stream, VERSION,
};
use std::io::{self, BufRead, Read, Write};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
#[cfg(not(windows))]
use std::time::Duration;
use uuid::Uuid;

const WRITE_QUEUE_CAPACITY: usize = 32;

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
}
impl Control {
    fn new(sender: SyncSender<WriteWork>) -> Self {
        Self {
            admission: Mutex::new(Admission {
                sender: Some(sender),
            }),
            stopping: AtomicBool::new(false),
            uncertain: AtomicBool::new(false),
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
impl Original {
    fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        {
            let job = crate::windows_job::OwnedProcessJob::new()
                .map_err(|_| io::Error::other("Provider owner unavailable"))?;
            let child = job
                .spawn(command)
                .map_err(|_| io::Error::other("Provider startup unavailable"))?;
            Ok(Self { child, job })
        }
        #[cfg(not(windows))]
        {
            #[cfg(target_os = "linux")]
            {
                use std::os::unix::process::CommandExt;
                let parent = unsafe { libc::getpid() };
                unsafe {
                    command.pre_exec(move || {
                        if libc::setpgid(0, 0) != 0
                            || libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0
                        {
                            return Err(io::Error::last_os_error());
                        }
                        if libc::getppid() != parent {
                            libc::_exit(127);
                        }
                        Ok(())
                    });
                }
            }
            command.spawn().map(|child| Self { child })
        }
    }
    fn stop(&mut self, uncertain: &AtomicBool) {
        #[cfg(windows)]
        self.job.terminate();
        #[cfg(target_os = "linux")]
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

fn supervise<W: Write + Send + 'static>(
    mut original: Original,
    receiver: Receiver<WriteWork>,
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
    let mut stopped = false;
    let status: Option<ExitStatus> = loop {
        original.observe();
        if !stopped && control.stopping.load(Ordering::Acquire) {
            original.stop(&control.uncertain);
            stopped = true;
        }
        match original.child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                #[cfg(windows)]
                original.job.wait_for_activity(50);
                #[cfg(not(windows))]
                thread::sleep(Duration::from_millis(5));
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
    crate::build_receipt::publish_if_verified(build_receipt, retirement, status.is_some());
    for worker in workers {
        if !matches!(worker.join(), Ok(Ok(()))) {
            control.uncertain.store(true, Ordering::Release);
        }
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

fn control_failure(control: &Control) {
    control.uncertain.store(true, Ordering::Release);
    control.stop();
}

fn not_started<W: Write>(
    output: &Output<W>,
    guardian_id: &str,
    parent_id: Option<String>,
    reason: StartFailure,
) -> io::Result<()> {
    output.emit(GuardianReply::Failed {
        version: VERSION,
        guardian_id: guardian_id.into(),
        parent_id: parent_id.clone(),
        reason,
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
        Err(_) => {
            not_started(
                &output,
                guardian_id,
                Some(parent_id),
                StartFailure::SpawnFailed,
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
    let control = Arc::new(Control::new(sender));
    let started = output.emit(GuardianReply::Started {
        version: VERSION,
        guardian_id: binding.guardian_id.clone(),
        parent_id: binding.parent_id.clone(),
        owner_id: binding.owner_id.clone(),
        pid: original.child.id(),
    });
    if let Err(error) = started {
        control_failure(&control);
        supervise(original, receiver, output, binding, control, build_receipt);
        return Err(error);
    }
    // Retain a second owner of the slot until the supervisor actually takes it.
    // A failed thread spawn cannot drop a still-running Child without cleanup.
    let slot = Arc::new(Mutex::new(Some((original, receiver))));
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
            if let Some((original, receiver)) = owned {
                supervise(
                    original,
                    receiver,
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
            if let Some((original, receiver)) = slot
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .take()
            {
                supervise(original, receiver, output, binding, control, build_receipt);
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
                    let _ = not_started(&output, &guardian_id, None, StartFailure::InvalidStart);
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
                        )
                    } else if platform == "unsupported" {
                        not_started(
                            &output,
                            &guardian_id,
                            Some(parent_id),
                            StartFailure::Unsupported,
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
