//! Explicit reviewed SSH execution. No startup, restore, interactive-terminal
//! input, credential store, connection store, output log or automatic retry.
use crate::{
    ssh_group_defaults::RemoteShellKind,
    ssh_security::{self, SshEndpoint},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const REVIEW_TTL: Duration = Duration::from_secs(120);
const MAX_TARGETS: usize = 16;
const MAX_REVIEWS: usize = 128;
const MAX_ACTIVE_RUNS: usize = 16;

#[derive(Clone)]
pub(crate) struct RunbookSnapshot {
    pub automation_id: String,
    pub revision: u64,
    pub script: String,
    pub shell: RemoteShellKind,
}
#[derive(Clone)]
pub(crate) struct ResolvedTarget {
    pub server_id: String,
    pub endpoint: SshEndpoint,
    pub proxy_grant: Option<Arc<crate::ssh_http_proxy_credentials::HttpProxyGrant>>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionLimits {
    pub concurrency: usize,
    pub timeout_seconds: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TargetState {
    Queued,
    Running,
    Exited,
    Failed,
    Cancelled,
    Unknown,
}
impl TargetState {
    fn terminal(&self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetOutcome {
    pub server_id: String,
    pub state: TargetState,
    pub exit_code: Option<i32>,
    /// Fixed reason codes only: never an SSH stderr or command string.
    pub reason: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunStatus {
    pub run_id: String,
    pub automation_id: String,
    pub revision: u64,
    pub owner: String,
    pub digest: String,
    pub targets: Vec<TargetOutcome>,
}
impl RunStatus {
    pub(crate) fn finished(&self) -> bool {
        self.targets.iter().all(|target| target.state.terminal())
    }
}
pub(crate) enum ClaimResult {
    Claimed,
    Existing(RunStatus),
}
/// The production adapter atomically claims existing automation_runs. It must
/// never persist script/output/credentials and must not restart recovered runs.
pub(crate) trait RunPersistence: Send + Sync + 'static {
    fn claim(&self, status: &RunStatus) -> Result<ClaimResult, String>;
    fn update(&self, status: &RunStatus) -> Result<(), String>;
    fn load(&self, owner: &str, run_id: &str) -> Result<Option<RunStatus>, String>;
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionReview {
    pub review_id: String,
    pub digest: String,
    pub expires_in_seconds: u64,
}
struct Ticket {
    owner: String,
    digest: String,
    expires: Instant,
    alive: Arc<AtomicBool>,
}
#[derive(Default)]
struct Reviews {
    tickets: HashMap<String, Ticket>,
    owners: HashMap<String, Arc<AtomicBool>>,
}
#[derive(Default)]
pub(crate) struct SshExecutionReviews {
    state: Mutex<Reviews>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_:./".contains(&c))
}
pub(crate) fn digest(
    book: &RunbookSnapshot,
    targets: &[ResolvedTarget],
    limits: ExecutionLimits,
) -> Result<String, String> {
    if !valid_id(&book.automation_id)
        || book.revision == 0
        || book.script.trim().is_empty()
        || book.script.len() > 64 * 1024
        || book
            .script
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        || targets.is_empty()
        || targets.len() > MAX_TARGETS
        || !(1..=4).contains(&limits.concurrency)
        || !(1..=86_400).contains(&limits.timeout_seconds)
    {
        return Err("Invalid SSH execution specification".into());
    }
    let mut ids = HashSet::new();
    let mut values = Vec::new();
    for target in targets {
        if !valid_id(&target.server_id) || !ids.insert(&target.server_id) {
            return Err("Choose unique canonical SSH targets".into());
        }
        ssh_security::validate_endpoint(&target.endpoint)?;
        let configuration = target.endpoint.runtime_configuration.as_deref();
        if let Some(configuration) = configuration {
            if !configuration.environment.is_empty() && configuration.shell_kind != Some(book.shell)
            {
                return Err("Runbook and inherited remote environment use different shells".into());
            }
            crate::ssh_environment::prologue(&configuration.environment, book.shell)?;
        }
        values.push(serde_json::json!({"serverId":target.server_id,"endpoint":target.endpoint,"configuration":configuration}));
    }
    let value = serde_json::json!({"automationId":book.automation_id,"revision":book.revision,"script":book.script,"shell":book.shell,"targets":values,"limits":limits});
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&value).map_err(|_| "Invalid execution digest")?)
    ))
}
impl SshExecutionReviews {
    pub(crate) fn preview(
        &self,
        owner: &str,
        book: &RunbookSnapshot,
        targets: &[ResolvedTarget],
        limits: ExecutionLimits,
    ) -> Result<ExecutionReview, String> {
        self.preview_at(owner, book, targets, limits, Instant::now())
    }
    fn preview_at(
        &self,
        owner: &str,
        book: &RunbookSnapshot,
        targets: &[ResolvedTarget],
        limits: ExecutionLimits,
        now: Instant,
    ) -> Result<ExecutionReview, String> {
        if !valid_id(owner) {
            return Err("Invalid native execution owner".into());
        }
        let digest = digest(book, targets, limits)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Execution review store unavailable")?;
        state
            .tickets
            .retain(|_, ticket| ticket.expires > now && ticket.alive.load(Ordering::Acquire));
        if state.tickets.len() >= MAX_REVIEWS
            || (!state.owners.contains_key(owner) && state.owners.len() >= MAX_REVIEWS)
        {
            return Err("Too many pending SSH execution reviews".into());
        }
        let alive = state
            .owners
            .entry(owner.into())
            .or_insert_with(|| Arc::new(AtomicBool::new(true)))
            .clone();
        let review_id = uuid::Uuid::new_v4().to_string();
        state.tickets.insert(
            review_id.clone(),
            Ticket {
                owner: owner.into(),
                digest: digest.clone(),
                expires: now + REVIEW_TTL,
                alive,
            },
        );
        Ok(ExecutionReview {
            review_id,
            digest,
            expires_in_seconds: REVIEW_TTL.as_secs(),
        })
    }
    fn consume(
        &self,
        owner: &str,
        review_id: &str,
        book: &RunbookSnapshot,
        targets: &[ResolvedTarget],
        limits: ExecutionLimits,
    ) -> Result<(String, Arc<AtomicBool>), String> {
        let ticket = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Execution review store unavailable")?;
            let ticket = state
                .tickets
                .get(review_id)
                .ok_or("Execution review expired or already used")?;
            if ticket.owner != owner {
                return Err("Execution review belongs to another native window".into());
            }
            state.tickets.remove(review_id).unwrap()
        };
        if ticket.expires <= Instant::now()
            || !ticket.alive.load(Ordering::Acquire)
            || ticket.digest != digest(book, targets, limits)?
        {
            return Err("Execution target or runbook changed; review again".into());
        }
        Ok((ticket.digest, ticket.alive))
    }
    pub(crate) fn close_window(&self, owner: &str) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(alive) = state.owners.remove(owner) {
                alive.store(false, Ordering::Release);
            }
            state.tickets.retain(|_, ticket| ticket.owner != owner);
        }
    }
}

struct Batch {
    status: Mutex<RunStatus>,
    /// Serializes the cancellation decision with child creation only. Never
    /// held during persistence callbacks, stdin writes or child waits.
    spawn_gate: Mutex<()>,
    cancelled: Vec<AtomicBool>,
    owner_alive: Arc<AtomicBool>,
    persistence: Arc<dyn RunPersistence>,
}
impl Batch {
    fn snapshot(&self) -> RunStatus {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    fn cancelled(&self, index: usize) -> bool {
        !self.owner_alive.load(Ordering::Acquire) || self.cancelled[index].load(Ordering::Acquire)
    }
    fn transition(
        &self,
        index: usize,
        state: TargetState,
        exit_code: Option<i32>,
        reason: Option<&str>,
    ) -> bool {
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        status.targets[index].state = state;
        status.targets[index].exit_code = exit_code;
        status.targets[index].reason = reason.map(str::to_owned);
        if self.persistence.update(&status).is_err() {
            status.targets[index].state = TargetState::Unknown;
            status.targets[index].reason = Some("persistence_failed".into());
            for cancelled in &self.cancelled {
                cancelled.store(true, Ordering::Release);
            }
            false
        } else {
            true
        }
    }
}
#[derive(Default)]
pub(crate) struct SshExecutions {
    runs: Mutex<HashMap<String, Arc<Batch>>>,
}
type TargetRunner =
    Arc<dyn Fn(&Batch, usize, &RunbookSnapshot, &ResolvedTarget, ExecutionLimits) + Send + Sync>;
impl SshExecutions {
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn start_fixture(
        self: &Arc<Self>,
        reviews: &SshExecutionReviews,
        owner: &str,
        review_id: &str,
        run_id: String,
        book: RunbookSnapshot,
        targets: Vec<ResolvedTarget>,
        limits: ExecutionLimits,
        persistence: Arc<dyn RunPersistence>,
        options: Vec<String>,
    ) -> Result<RunStatus, String> {
        self.start_with_runner(
            reviews,
            owner,
            review_id,
            run_id,
            book,
            targets,
            limits,
            persistence,
            Arc::new(move |batch, index, book, target, limits| {
                execute_prepared(
                    batch,
                    index,
                    prepare_process_with_options(book, target, &options),
                    limits,
                )
            }),
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn start(
        self: &Arc<Self>,
        reviews: &SshExecutionReviews,
        owner: &str,
        review_id: &str,
        run_id: String,
        book: RunbookSnapshot,
        targets: Vec<ResolvedTarget>,
        limits: ExecutionLimits,
        persistence: Arc<dyn RunPersistence>,
    ) -> Result<RunStatus, String> {
        self.start_with_runner(
            reviews,
            owner,
            review_id,
            run_id,
            book,
            targets,
            limits,
            persistence,
            Arc::new(execute),
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn start_with_runner(
        self: &Arc<Self>,
        reviews: &SshExecutionReviews,
        owner: &str,
        review_id: &str,
        run_id: String,
        book: RunbookSnapshot,
        targets: Vec<ResolvedTarget>,
        limits: ExecutionLimits,
        persistence: Arc<dyn RunPersistence>,
        runner: TargetRunner,
    ) -> Result<RunStatus, String> {
        if !valid_id(&run_id) {
            return Err("Invalid SSH execution run identifier".into());
        }
        // A duplicate request can return metadata after its one-use review was
        // consumed. This path never creates workers or grants execution again.
        let expected_digest = digest(&book, &targets, limits)?;
        let initial = RunStatus {
            run_id: run_id.clone(),
            automation_id: book.automation_id.clone(),
            revision: book.revision,
            owner: owner.into(),
            digest: expected_digest,
            targets: targets
                .iter()
                .map(|target| TargetOutcome {
                    server_id: target.server_id.clone(),
                    state: TargetState::Queued,
                    exit_code: None,
                    reason: None,
                })
                .collect(),
        };
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "Execution registry unavailable")?;
        if let Some(existing) = runs.get(&run_id) {
            let status = existing.snapshot();
            if status.owner != owner || status.digest != initial.digest {
                return Err("Run identifier belongs to another execution".into());
            }
            return Ok(status);
        }
        if let Some(existing) = persistence.load(owner, &run_id)? {
            if existing.owner != owner
                || existing.digest != initial.digest
                || existing.run_id != run_id
            {
                return Err("Run identifier belongs to another execution".into());
            }
            return Ok(existing);
        }
        let active = runs
            .values()
            .filter(|run| !run.snapshot().finished())
            .count();
        if active >= MAX_ACTIVE_RUNS {
            return Err("Too many active SSH executions".into());
        }
        let (_, alive) = reviews.consume(owner, review_id, &book, &targets, limits)?;
        match persistence.claim(&initial)? {
            ClaimResult::Existing(existing) => {
                if existing.owner != owner
                    || existing.digest != initial.digest
                    || existing.run_id != run_id
                {
                    return Err("Run identifier belongs to another execution".into());
                }
                return Ok(existing);
            }
            ClaimResult::Claimed => {}
        }
        if runs.len() >= MAX_REVIEWS {
            runs.retain(|_, run| !run.snapshot().finished());
        }
        let batch = Arc::new(Batch {
            status: Mutex::new(initial.clone()),
            spawn_gate: Mutex::new(()),
            cancelled: targets.iter().map(|_| AtomicBool::new(false)).collect(),
            owner_alive: alive,
            persistence,
        });
        runs.insert(run_id, batch.clone());
        drop(runs);
        let next = Arc::new(AtomicUsize::new(0));
        let targets = Arc::new(targets);
        let book = Arc::new(book);
        for _ in 0..limits.concurrency.min(targets.len()) {
            let batch = batch.clone();
            let targets = targets.clone();
            let book = book.clone();
            let next = next.clone();
            let runner = runner.clone();
            std::thread::spawn(move || loop {
                let index = next.fetch_add(1, Ordering::AcqRel);
                if index >= targets.len() {
                    break;
                }
                if batch.cancelled(index) {
                    batch.transition(
                        index,
                        TargetState::Cancelled,
                        None,
                        Some("cancelled_before_start"),
                    );
                    continue;
                }
                if !batch.transition(index, TargetState::Running, None, None) {
                    continue;
                }
                runner(&batch, index, &book, &targets[index], limits);
            });
        }
        Ok(initial)
    }
    pub(crate) fn status(
        &self,
        owner: &str,
        run_id: &str,
        persistence: &dyn RunPersistence,
    ) -> Result<RunStatus, String> {
        if let Some(run) = self
            .runs
            .lock()
            .map_err(|_| "Execution registry unavailable")?
            .get(run_id)
        {
            let status = run.snapshot();
            if status.owner != owner {
                return Err("Execution belongs to another native window".into());
            }
            return Ok(status);
        }
        let status = persistence
            .load(owner, run_id)?
            .ok_or("Execution not found")?;
        if status.owner != owner || status.run_id != run_id {
            return Err("Execution belongs to another native window or run".into());
        }
        Ok(status)
    }
    pub(crate) fn cancel(
        &self,
        owner: &str,
        run_id: &str,
        server_id: Option<&str>,
    ) -> Result<(), String> {
        let runs = self
            .runs
            .lock()
            .map_err(|_| "Execution registry unavailable")?;
        let run = runs.get(run_id).ok_or("Execution not found")?;
        let status = run.snapshot();
        if status.owner != owner {
            return Err("Execution belongs to another native window".into());
        }
        if server_id.is_some_and(|id| !status.targets.iter().any(|target| target.server_id == id)) {
            return Err("Execution target not found".into());
        }
        let _gate = run.spawn_gate.lock().unwrap_or_else(|e| e.into_inner());
        for (index, target) in status.targets.iter().enumerate() {
            if server_id.is_none_or(|id| target.server_id == id) {
                run.cancelled[index].store(true, Ordering::Release);
            }
        }
        Ok(())
    }
    pub(crate) fn close_window(&self, owner: &str) {
        if let Ok(runs) = self.runs.lock() {
            for run in runs.values() {
                if run.snapshot().owner == owner {
                    let _gate = run.spawn_gate.lock().unwrap_or_else(|e| e.into_inner());
                    run.owner_alive.store(false, Ordering::Release);
                    for cancel in &run.cancelled {
                        cancel.store(true, Ordering::Release);
                    }
                }
            }
        }
    }
    pub(crate) fn shutdown(&self) {
        if let Ok(runs) = self.runs.lock() {
            for run in runs.values() {
                let _gate = run.spawn_gate.lock().unwrap_or_else(|e| e.into_inner());
                for cancel in &run.cancelled {
                    cancel.store(true, Ordering::Release);
                }
            }
        }
    }
}
impl Drop for SshExecutions {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn terminate(child: &mut Child) {
    crate::harness::terminate_all(&[child.id()]);
    let _ = child.kill();
    let _ = child.wait();
}
fn execute(
    batch: &Batch,
    index: usize,
    book: &RunbookSnapshot,
    target: &ResolvedTarget,
    limits: ExecutionLimits,
) {
    execute_prepared(batch, index, prepare_process(book, target), limits);
}
fn execute_prepared(
    batch: &Batch,
    index: usize,
    result: Result<PreparedProcess, String>,
    limits: ExecutionLimits,
) {
    let (mut command, mut input, _endpoint, _proxy) = match result {
        Ok(value) => value,
        Err(_) => {
            batch.transition(index, TargetState::Failed, None, Some("preparation_failed"));
            return;
        }
    };
    let gate = batch.spawn_gate.lock().unwrap_or_else(|e| e.into_inner());
    if batch.cancelled(index) {
        drop(gate);
        input.fill(0);
        batch.transition(
            index,
            TargetState::Cancelled,
            None,
            Some("cancelled_before_start"),
        );
        return;
    }
    #[cfg(windows)]
    let spawned = crate::windows::spawn_managed(&mut command);
    #[cfg(not(windows))]
    let spawned = command.spawn();
    drop(gate);
    let mut child = match spawned {
        Ok(child) => child,
        Err(_) => {
            input.fill(0);
            batch.transition(index, TargetState::Failed, None, Some("spawn_failed"));
            return;
        }
    };
    let mut stdin = child.stdin.take().expect("Execution stdin must be piped");
    let writer = std::thread::spawn(move || {
        let written = stdin.write_all(&input).and_then(|_| stdin.flush());
        input.fill(0);
        written.is_ok()
    });
    let deadline = Instant::now() + Duration::from_secs(limits.timeout_seconds);
    loop {
        if batch.cancelled(index) || Instant::now() >= deadline {
            let cancelled = batch.cancelled(index);
            terminate(&mut child);
            let _ = writer.join();
            batch.transition(
                index,
                if cancelled {
                    TargetState::Cancelled
                } else {
                    TargetState::Unknown
                },
                None,
                Some(if cancelled {
                    "cancel_requested_remote_outcome_unknown"
                } else {
                    "timeout_remote_outcome_unknown"
                }),
            );
            return;
        }
        match child.try_wait() {
            Ok(Some(exit)) => {
                let delivered = writer.join().unwrap_or(false);
                let code = exit.code();
                if !delivered || code.is_none() || code == Some(255) {
                    batch.transition(
                        index,
                        TargetState::Unknown,
                        code,
                        Some("remote_outcome_unknown"),
                    );
                } else {
                    batch.transition(
                        index,
                        if exit.success() {
                            TargetState::Exited
                        } else {
                            TargetState::Failed
                        },
                        code,
                        None,
                    );
                }
                return;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                terminate(&mut child);
                let _ = writer.join();
                batch.transition(
                    index,
                    TargetState::Unknown,
                    None,
                    Some("process_observation_failed"),
                );
                return;
            }
        }
    }
}
type PreparedProcess = (
    Command,
    Vec<u8>,
    SshEndpoint,
    Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
);
fn prepare_process(
    book: &RunbookSnapshot,
    target: &ResolvedTarget,
) -> Result<PreparedProcess, String> {
    prepare_process_with_options(book, target, &[])
}
/// Private seam for owned acceptance trust stores. Production always passes [].
/// Never expose option prefixes to IPC or the runbook payload.
fn prepare_process_with_options(
    book: &RunbookSnapshot,
    target: &ResolvedTarget,
    options: &[String],
) -> Result<PreparedProcess, String> {
    if let Some(configuration) = &target.endpoint.runtime_configuration {
        if !configuration.environment.is_empty() && configuration.shell_kind != Some(book.shell) {
            return Err("Runbook and inherited remote environment use different shells".into());
        }
    }
    let endpoint = ssh_security::prepare_endpoint(target.endpoint.clone())?;
    let proxy =
        ssh_security::start_http_proxy_authorized(&endpoint, target.proxy_grant.as_deref())?;
    let mut args = ssh_security::connection_args(&endpoint)?;
    args.extend([
        "-o".into(),
        "BatchMode=yes".into(),
        "-T".into(),
        "--".into(),
        endpoint.host.clone(),
        match book.shell {
            RemoteShellKind::Posix => "sh -s",
            RemoteShellKind::Powershell => "pwsh -NoLogo -NoProfile -NonInteractive -Command -",
        }
        .into(),
    ]);
    let mut input = endpoint
        .runtime_configuration
        .as_ref()
        .map(|configuration| {
            crate::ssh_environment::prologue(&configuration.environment, book.shell)
        })
        .transpose()?
        .unwrap_or_default();
    input.push_str(&book.script);
    input.push('\n');
    let mut command = Command::new("ssh");
    command
        .args(options)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env("PATH", crate::harness::gui_search_path());
    if let Some(proxy) = &proxy {
        command.envs(proxy.environment());
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    Ok((command, input.into_bytes(), endpoint, proxy))
}

#[cfg(test)]
#[path = "ssh_execution_tests.rs"]
mod tests;
