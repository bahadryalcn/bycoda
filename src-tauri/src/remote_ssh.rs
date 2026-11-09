use crate::ssh_askpass::Askpass;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, PoisonError, TryLockError,
};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    pub port: Option<u16>,
    pub remote_port: u16,
    /// A second way to the same machine, such as its Tailscale address next
    /// to its home-network one. Whichever answers is used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternate: Option<String>,
    /// Set only on the address being dialled: the name its host key is
    /// filed under, so the alternate address uses the primary's known key.
    #[serde(skip)]
    pub host_key_alias: Option<String>,
}

/// Every way to the machine in its preferred order: the saved address, its
/// other address, then the ones its Host taught (`remote_routes`), filtered and
/// ordered by the owner's route settings. The others check the host key filed
/// for the saved address.
pub(crate) fn candidates(target: &SshTarget) -> Vec<SshTarget> {
    let primary = SshTarget {
        alternate: None,
        host_key_alias: target.host_key_alias.clone(),
        ..target.clone()
    };
    let host = |value: &str| {
        value
            .rsplit_once('@')
            .map_or(value, |(_, host)| host)
            .trim()
            .to_ascii_lowercase()
    };
    let mut seen = vec![host(&target.target)];
    let mut others = Vec::new();
    let alternate = target
        .alternate
        .as_deref()
        .map(str::trim)
        .filter(|alternate| !alternate.is_empty() && *alternate != target.target)
        .map(|alternate| (alternate.to_string(), target.port));
    let learned = crate::remote_routes::learned(target)
        .into_iter()
        .map(|route| (route.target, route.port.or(target.port)));
    for (address, port) in alternate.into_iter().chain(learned) {
        if seen.contains(&host(&address)) {
            continue;
        }
        seen.push(host(&address));
        others.push(SshTarget {
            target: address,
            port,
            alternate: None,
            host_key_alias: None,
            ..target.clone()
        });
    }
    if !others.is_empty() {
        let alias = known_host_key_name(&primary);
        for other in &mut others {
            other.host_key_alias = alias.clone();
        }
    }
    crate::remote_routes::arrange(target, std::iter::once(primary).chain(others).collect())
}

/// The addresses to try, in order: `candidates`, each moved ahead of the saved
/// one only when the saved one's SSH port is silent and this one answers. All
/// are checked at once, so an unreachable address costs its timeout only once.
/// A machine with one address and nothing learned has just that one.
pub fn dial_order(target: &SshTarget) -> Vec<SshTarget> {
    let candidates = candidates(target);
    if candidates.len() == 1 {
        return candidates;
    }
    let probes: Vec<_> = candidates
        .iter()
        .cloned()
        .map(|candidate| std::thread::spawn(move || ssh_server_reachable(&candidate)))
        .collect();
    let answers: Vec<Option<bool>> = probes
        .into_iter()
        .map(|probe| probe.join().ok().flatten())
        .collect();
    // The saved address keeps first place unless its port is known to be silent.
    let rank = |index: usize, answer: Option<bool>| match answer {
        Some(true) => 0,
        None if index == 0 => 0,
        None => 1,
        Some(false) => 2,
    };
    let mut order: Vec<(usize, SshTarget)> = candidates.into_iter().enumerate().collect();
    order.sort_by_key(|(index, _)| rank(*index, answers[*index]));
    order.into_iter().map(|(_, dial)| dial).collect()
}

/// The name ssh files the primary address's host key under: its
/// HostKeyAlias when the config sets one, else the host name it dials.
fn known_host_key_name(primary: &SshTarget) -> Option<String> {
    let output = ssh_config_dump(primary)?;
    let mut hostname = None;
    for line in output.lines() {
        match line.split_once(' ') {
            Some(("hostkeyalias", value)) if !value.trim().eq_ignore_ascii_case("none") => {
                return Some(value.trim().to_string());
            }
            Some(("hostname", value)) => hostname = Some(value.trim().to_string()),
            _ => {}
        }
    }
    hostname
}

/// Accepts an empty alternate as none; otherwise it must be a valid target too.
pub fn validate_alternate(
    alternate: Option<&str>,
    port: Option<u16>,
) -> Result<Option<String>, String> {
    match alternate.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) => validate_target(value, port).map(Some),
    }
}

pub fn validate_target(target: &str, port: Option<u16>) -> Result<String, String> {
    let target = target.trim();
    if target.is_empty()
        || target.len() > 255
        || target.starts_with('-')
        || port == Some(0)
        || !target
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-@:[ ]".contains(&b) && b != b' ')
        || target.matches('@').count() > 1
        || target.starts_with('@')
        || target.ends_with('@')
    {
        return Err(
            "Enter an SSH hostname or alias, such as user@my-mac-mini, and a valid port.".into(),
        );
    }
    Ok(target.into())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    pub message: String,
    pub confirm: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub message: String,
    pub prompt: Option<Prompt>,
    pub done: bool,
    pub error: Option<String>,
    pub machine: Option<crate::remote::Machine>,
}
struct JobData {
    view: JobView,
    answer: Option<String>,
}
pub struct Job {
    inner: Mutex<JobData>,
    pub cancelled: AtomicBool,
}
impl Job {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(JobData {
                view: JobView {
                    id: uuid::Uuid::new_v4().to_string(),
                    message: "Connecting to SSH and setting up bycoda Host…".into(),
                    prompt: None,
                    done: false,
                    error: None,
                    machine: None,
                },
                answer: None,
            }),
            cancelled: AtomicBool::new(false),
        })
    }
    pub fn view(&self) -> JobView {
        self.inner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .view
            .clone()
    }
    pub fn message(&self, text: &str) {
        self.inner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .view
            .message = text.into();
    }
    pub fn complete(&self, action: impl FnOnce() -> Result<crate::remote::Machine, String>) {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let result = if self.cancelled.load(Ordering::Relaxed) {
            Err("Connection cancelled".into())
        } else {
            action()
        };
        inner.view.done = true;
        inner.view.prompt = None;
        inner.answer = None;
        match result {
            Ok(machine) => {
                inner.view.message = "Connected".into();
                inner.view.machine = Some(machine);
            }
            Err(error) => inner.view.error = Some(error),
        }
    }
    pub fn cancel(&self) {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        if !inner.view.done {
            self.cancelled.store(true, Ordering::Relaxed);
        }
    }
    pub fn answer(&self, id: &str, answer: String) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "SSH prompt is unavailable")?;
        let prompt = inner
            .view
            .prompt
            .as_ref()
            .filter(|p| p.id == id)
            .ok_or("This SSH prompt has expired")?;
        if answer.len() > 8192
            || answer.contains(['\n', '\r', '\0'])
            || (prompt.confirm && answer != "yes" && answer != "no")
        {
            return Err("Invalid SSH prompt response".into());
        }
        inner.answer = Some(answer);
        Ok(())
    }
    fn prompt(&self, message: String, confirm: bool) -> Option<String> {
        let deadline = Instant::now() + Duration::from_secs(120);
        {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            inner.answer = None;
            inner.view.prompt = Some(Prompt {
                id: uuid::Uuid::new_v4().to_string(),
                message,
                confirm,
            });
        }
        loop {
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            if self.cancelled.load(Ordering::Relaxed)
                || Instant::now() >= deadline
                || inner.view.done
            {
                inner.view.prompt = None;
                inner.answer = None;
                return None;
            }
            if let Some(answer) = inner.answer.take() {
                inner.view.prompt = None;
                return Some(answer);
            }
            drop(inner);
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    pub fn askpass(self: &Arc<Self>) -> Result<Askpass, String> {
        let job = self.clone();
        Askpass::start(move |message, confirm| job.prompt(message, confirm))
    }
}

fn command(target: &SshTarget, interactive: bool) -> Command {
    command_with_keepalive(target, interactive, 15)
}

/// ssh uses the first value it gets for an option and command-line `-o` beats
/// `~/.ssh/config`, so these settings hold whatever the user's config says.
/// `keepalive` seconds, three missed replies in a row, end a link that went
/// quiet (sleeping machine, dropped network) instead of leaving ssh hanging.
fn command_with_keepalive(target: &SshTarget, interactive: bool, keepalive: u32) -> Command {
    let mut command = Command::new("ssh");
    command.args([
        "-T",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        &format!("ServerAliveInterval={keepalive}"),
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ForwardX11=no",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-o",
        "PermitLocalCommand=no",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "StrictHostKeyChecking=ask",
        "-o",
        "NumberOfPasswordPrompts=3",
        "-o",
        "ForkAfterAuthentication=no",
    ]);
    command.args([
        "-o",
        if interactive {
            "BatchMode=no"
        } else {
            "BatchMode=yes"
        },
    ]);
    if let Some(port) = target.port {
        command.args(["-p", &port.to_string()]);
    }
    if let Some(identity) = &target.identity_file {
        command.args(["-o", "IdentitiesOnly=yes", "-i", identity]);
    }
    if let Some(alias) = &target.host_key_alias {
        command.args(["-o", &format!("HostKeyAlias={alias}")]);
    }
    // Untranslated messages: failures are classified by their wording.
    command
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::hide_window_console(&mut command);
    command
}

fn capture(mut reader: impl Read + Send + 'static) -> std::sync::mpsc::Receiver<Vec<u8>> {
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0; 4096];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let remaining = (64 * 1024usize).saturating_sub(output.len());
            output.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        let _ = send.send(output);
    });
    receive
}

/// Starts an ssh process the app owns. On Windows it joins the app's job, so it
/// cannot outlive a crashed app.
fn spawn_owned(command: &mut Command) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        crate::windows::spawn_managed(command)
    }
    #[cfg(not(windows))]
    {
        command.spawn()
    }
}

/// Ends an ssh process the app started: its process tree first, then the child.
fn stop(child: &mut Child) {
    crate::harness::terminate_all(&[child.id()]);
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostPlatform {
    Unix,
    Windows,
}

const PLATFORM_PROBE: &[&str] = &["echo", "BYCODA_PLATFORM", "$env:OS", "%OS%", "$OS"];

fn parse_platform(output: &str) -> Result<HostPlatform, String> {
    let marker = output
        .rsplit_once("BYCODA_PLATFORM")
        .ok_or("Could not identify the remote shell. Use cmd.exe, PowerShell, or a Unix shell.")?
        .1;
    Ok(
        if marker
            .split_whitespace()
            .any(|word| word.eq_ignore_ascii_case("Windows_NT"))
        {
            HostPlatform::Windows
        } else {
            HostPlatform::Unix
        },
    )
}

pub fn detect_platform(
    target: &SshTarget,
    job: &Arc<Job>,
    askpass: &Askpass,
) -> Result<(HostPlatform, SshTarget), String> {
    job.message("Checking the remote machine…");
    detect_platform_from_dials(dial_order(target), job, |dial| {
        run_remote_command(
            dial,
            String::new(),
            job,
            askpass,
            command(dial, true),
            PLATFORM_PROBE,
        )
        .and_then(|output| parse_platform(&output))
    })
}

/// One failed address keeps its own message; several are each named, so a
/// host-key refusal on the first is not hidden by the fallback's error.
fn dial_failures(mut failures: Vec<(String, String)>) -> String {
    if failures.len() == 1 {
        return failures.remove(0).1;
    }
    failures
        .iter()
        .map(|(target, error)| format!("{target}: {error}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn detect_platform_from_dials(
    dials: Vec<SshTarget>,
    job: &Arc<Job>,
    mut probe: impl FnMut(&SshTarget) -> Result<HostPlatform, String>,
) -> Result<(HostPlatform, SshTarget), String> {
    let mut failures = Vec::new();
    for dial in dials {
        if job.cancelled.load(Ordering::Relaxed) {
            return Err("Connection cancelled".into());
        }
        match probe(&dial) {
            Ok(platform) => return Ok((platform, dial)),
            Err(error) => {
                if job.cancelled.load(Ordering::Relaxed) {
                    return Err(error);
                }
                failures.push((dial.target.clone(), error));
            }
        }
    }
    Err(dial_failures(failures))
}

fn powershell_encoded(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Keep the remote command below cmd.exe's length limit. The actual script is
/// read from UTF-8 stdin as a single block, rather than evaluated line by line.
fn powershell_reader() -> String {
    // Prefer this shell's built-in modules if the SSH environment inherited
    // PowerShell 7 module paths through an intermediate process.
    powershell_encoded("$env:PSModulePath = $PSHOME + '\\Modules;' + $env:PSModulePath; $ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); try { & ([ScriptBlock]::Create([Console]::In.ReadToEnd())) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }")
}

pub fn run_script(
    target: &SshTarget,
    platform: HostPlatform,
    script: String,
    job: &Arc<Job>,
    askpass: &Askpass,
) -> Result<String, String> {
    let dialed = dial_order(target).remove(0);
    let target = &dialed;
    if platform == HostPlatform::Windows {
        let encoded = powershell_reader();
        run_remote_command(
            target,
            script,
            job,
            askpass,
            command(target, true),
            &[
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &encoded,
            ],
        )
    } else {
        run_script_with_command(target, script, job, askpass, command(target, true))
    }
}

fn run_script_with_command(
    target: &SshTarget,
    script: String,
    job: &Arc<Job>,
    askpass: &Askpass,
    command: Command,
) -> Result<String, String> {
    run_remote_command(target, script, job, askpass, command, &["sh", "-l", "-s"])
}

fn run_remote_command(
    target: &SshTarget,
    script: String,
    job: &Arc<Job>,
    askpass: &Askpass,
    mut command: Command,
    remote: &[&str],
) -> Result<String, String> {
    if job.cancelled.load(Ordering::Relaxed) {
        return Err("Connection cancelled".into());
    }
    askpass.configure(&mut command)?;
    command.args(["--", &target.target]).args(remote);
    let mut child =
        spawn_owned(&mut command).map_err(|e| format!("Could not start OpenSSH: {e}"))?;
    let pipes = match (child.stdout.take(), child.stderr.take(), child.stdin.take()) {
        (Some(stdout), Some(stderr), Some(stdin)) => (stdout, stderr, stdin),
        _ => {
            stop(&mut child);
            return Err("OpenSSH process pipes are unavailable".into());
        }
    };
    let stdout = capture(pipes.0);
    let stderr = capture(pipes.1);
    let mut stdin = pipes.2;
    // Detached on purpose: it ends once the child exits and its stdin closes.
    std::thread::spawn(move || stdin.write_all(script.as_bytes()));
    let deadline = Instant::now() + Duration::from_secs(300);
    let result = loop {
        if job.cancelled.load(Ordering::Relaxed) || Instant::now() >= deadline {
            stop(&mut child);
            break Err(if job.cancelled.load(Ordering::Relaxed) {
                "Connection cancelled"
            } else {
                "SSH setup timed out. Check the host's network connection and try again."
            }
            .to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.success()),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                stop(&mut child);
                break Err(error.to_string());
            }
        }
    };
    // A grandchild can keep the pipes open after ssh is gone; the output read so
    // far is used instead of waiting for the pipe to close.
    let give_up = Instant::now() + Duration::from_secs(2);
    let collect = |pipe: std::sync::mpsc::Receiver<Vec<u8>>| {
        let bytes = pipe
            .recv_timeout(give_up.saturating_duration_since(Instant::now()))
            .unwrap_or_default();
        String::from_utf8_lossy(&bytes).to_string()
    };
    let output = collect(stdout);
    let errors = collect(stderr);
    if !result? {
        return Err(format!(
            "SSH setup failed: {}",
            errors.trim().chars().take(4000).collect::<String>()
        ));
    }
    Ok(output)
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn bootstrap_script(platform: HostPlatform) -> String {
    let template = match platform {
        HostPlatform::Unix => include_str!("remote_bootstrap.sh"),
        HostPlatform::Windows => include_str!("remote_bootstrap.ps1"),
    };
    bootstrap_script_from_template(platform, template)
}

fn bootstrap_script_from_template(platform: HostPlatform, template: &str) -> String {
    let version = env!("CARGO_PKG_VERSION");
    // Independent host packages must be configured explicitly at build time.
    // Never install an upstream host into bycoda's isolated data/service paths.
    let url = option_env!("BYCODA_HOST_RELEASE_URL").unwrap_or("");
    match platform {
        // include_str! preserves checkout line endings, including Windows CRLF.
        HostPlatform::Unix => template
            .replace("\r\n", "\n")
            .replace("@@VERSION@@", &shell_quote(version))
            .replace("@@RELEASE@@", &shell_quote(url)),
        HostPlatform::Windows => template
            .replace("@@VERSION@@", &powershell_quote(version))
            .replace("@@RELEASE@@", &powershell_quote(url))
            .replace("@@ACL@@", include_str!("../../host/windows-acl.ps1")),
    }
}

pub fn upgrade_script(platform: HostPlatform, port: u16) -> String {
    let script = bootstrap_script(platform);
    match platform {
        HostPlatform::Unix => {
            format!("BYCODA_HOST_FORCE_UPGRADE=1\nBYCODA_HOST_PORT={port}\n{script}")
        }
        HostPlatform::Windows => format!(
            "$env:BYCODA_HOST_FORCE_UPGRADE = '1'\n$env:BYCODA_HOST_PORT = '{port}'\n{script}"
        ),
    }
}

/// Asks the installed host which loopback port it listens on now.
pub fn connection_info_script(platform: HostPlatform) -> String {
    match platform {
        HostPlatform::Unix => "set -eu\n\"$HOME/.bycoda-host/bin/bycoda-host\" connection-info\n".into(),
        HostPlatform::Windows => "$ErrorActionPreference = 'Stop'\n$base = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bycoda-host'\n$runtime = [IO.File]::ReadAllText((Join-Path $base 'runtime-path')).Trim()\n& (Join-Path $runtime 'node.exe') (Join-Path $runtime 'host.mjs') connection-info\nif ($LASTEXITCODE -ne 0) { throw 'The host is not running.' }\n".into(),
    }
}

pub fn pairing_script(platform: HostPlatform, name: &str) -> String {
    match platform {
        HostPlatform::Unix => format!("set -eu\n\"$HOME/.bycoda-host/bin/bycoda-host\" pair --name {} --json\n", shell_quote(name)),
        HostPlatform::Windows => format!("$ErrorActionPreference = 'Stop'\n$base = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bycoda-host'\n$runtime = [IO.File]::ReadAllText((Join-Path $base 'runtime-path')).Trim()\n& (Join-Path $runtime 'node.exe') (Join-Path $runtime 'host.mjs') pair --name {} --json\nif ($LASTEXITCODE -ne 0) {{ throw 'Host pairing failed.' }}\n", powershell_quote(name)),
    }
}

/// Seconds between ssh's keepalive probes on a tunnel; three unanswered probes
/// end the link, so a silent network is noticed in about 15 seconds.
const TUNNEL_KEEPALIVE_SECS: u32 = 5;
/// How often a tunnel's ssh process is checked for having exited. Keepalives
/// take ~15 s to notice a dead link anyway; 1 s keeps idle tunnels cheap.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);

/// A tunnel whose ssh process ended without the app closing it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelExit {
    pub environment_id: String,
    /// `None` when ssh was killed by a signal.
    pub exit_code: Option<i32>,
    /// The last lines ssh printed, without anything secret.
    pub stderr: String,
}
pub type ExitSink = Arc<dyn Fn(TunnelExit) + Send + Sync>;

/// The last few lines of ssh's stderr, bounded and free of control characters
/// and of anything that looks like a credential.
fn stderr_tail(text: &str) -> String {
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            line.chars()
                .filter(|c| !c.is_control())
                .take(200)
                .collect::<String>()
                .trim()
                .to_string()
        })
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !line.is_empty()
                && !["bearer ", "token=", "password=", "passphrase="]
                    .iter()
                    .any(|secret| lower.contains(secret))
        })
        .collect();
    lines[lines.len().saturating_sub(5)..].join("\n")
}

/// Appends ssh's stderr, keeping only its newest 8 KB so the last words survive.
fn append_stderr_tail(errors: &mut String, chunk: &[u8]) {
    errors.push_str(&String::from_utf8_lossy(chunk));
    if errors.len() > 8192 {
        let mut cut = errors.len() - 8192;
        while !errors.is_char_boundary(cut) {
            cut += 1;
        }
        errors.drain(..cut);
    }
}

/// ssh's complaint about the forwarded port: the tunnel works, but nothing
/// listens on the machine's host port.
fn host_refused(stderr: &str) -> bool {
    stderr.lines().any(|line| {
        line.contains("open failed: connect failed")
            && line.to_ascii_lowercase().contains("refused")
    })
}

/// `(host, port)` that `ssh -G` resolved for a target, or `None` when the
/// connection goes through a proxy, where that address is not the one dialled.
fn parse_ssh_config_dump(output: &str) -> Option<(String, u16)> {
    let (mut host, mut port) = (None, None);
    for line in output.lines() {
        let Some((key, value)) = line.split_once(' ') else {
            continue;
        };
        let value = value.trim();
        match key {
            "hostname" => host = Some(value.to_string()),
            "port" => port = value.parse().ok(),
            "proxycommand" | "proxyjump" if !value.eq_ignore_ascii_case("none") => return None,
            _ => {}
        }
    }
    Some((host?, port?))
}

/// Whether the SSH server's own address accepts a TCP connection: a check
/// that does not depend on ssh's wording. `None` when the address is unknown.
/// Reads the user's config through `ssh -G`, which never connects.
pub(crate) fn ssh_server_reachable(target: &SshTarget) -> Option<bool> {
    let (host, port) = parse_ssh_config_dump(&ssh_config_dump(target)?)?;
    Some(tcp_reachable(&host, port, Duration::from_secs(3)))
}

/// `ssh -G` for a target: the settings ssh would use, without connecting.
/// Capped at 5 seconds and 64 KiB, since a `Match exec` line can hang.
pub(crate) fn ssh_config_dump(target: &SshTarget) -> Option<String> {
    let mut command = Command::new("ssh");
    command.arg("-G");
    if let Some(port) = target.port {
        command.args(["-p", &port.to_string()]);
    }
    command
        .args(["--", &target.target])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::hide_window_console(&mut command);
    let mut child = spawn_owned(&mut command).ok()?;
    let Some(mut stdout) = child.stdout.take() else {
        stop(&mut child);
        return None;
    };
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = (&mut stdout).take(64 * 1024).read_to_end(&mut output);
        let _ = send.send(output);
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let succeeded = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => break false,
        }
    };
    if !succeeded {
        stop(&mut child);
        return None;
    }
    let output = receive.recv_timeout(Duration::from_secs(1)).ok()?;
    Some(String::from_utf8_lossy(&output).into_owned())
}

/// Whether `host:port` accepts a TCP connection within `timeout` per address.
/// Name lookup runs on a worker that is abandoned after 3 seconds, since a
/// broken resolver can hang it.
fn tcp_reachable(host: &str, port: u16, timeout: Duration) -> bool {
    let (send, receive) = std::sync::mpsc::channel();
    let host = host.to_string();
    std::thread::spawn(move || {
        use std::net::ToSocketAddrs;
        let addresses = (host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| addresses.take(8).collect::<Vec<_>>());
        let _ = send.send(addresses);
    });
    let Ok(Ok(addresses)) = receive.recv_timeout(Duration::from_secs(3)) else {
        return false;
    };
    addresses
        .iter()
        .any(|addr| TcpStream::connect_timeout(addr, timeout).is_ok())
}

/// What the renderer reads to classify a failed start: ssh's exit status and
/// whether the server's port answered, next to ssh's own words.
fn failure_tag(exit: Option<i32>, reachable: Option<bool>) -> String {
    let mut parts = Vec::new();
    if let Some(code) = exit {
        parts.push(format!("exit {code}"));
    }
    match reachable {
        Some(true) => parts.push("host reachable".into()),
        Some(false) => parts.push("host unreachable".into()),
        None => {}
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}

/// Gives ssh's last words time to arrive after it exits.
fn wait_for_stderr(done: &AtomicBool) {
    for _ in 0..25 {
        if done.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub struct Tunnel {
    child: Arc<Mutex<Child>>,
    pub port: u16,
    stderr: Arc<Mutex<String>>,
    /// Set once ssh's stderr has been read to its end.
    stderr_done: Arc<AtomicBool>,
    /// Set when the app closes the tunnel on purpose, or when its unexpected
    /// exit has been reported: either way nothing more is reported.
    settled: Arc<AtomicBool>,
    /// Where this tunnel leads, so one started for an address the machine no
    /// longer has is never reused. `None` for a tunnel adopted without it.
    target: Option<SshTarget>,
    /// The address ssh actually dialed, one of the target's `candidates`.
    dialed: Option<SshTarget>,
    started: Instant,
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        let mut child = self.child();
        // Only a tunnel still running is closed on purpose. One whose ssh already
        // exited is left for the watcher, which reports that exit.
        if matches!(child.try_wait(), Ok(None)) {
            self.settled.store(true, Ordering::SeqCst);
        }
        stop(&mut child);
    }
}
impl Tunnel {
    fn child(&self) -> std::sync::MutexGuard<'_, Child> {
        self.child.lock().unwrap_or_else(PoisonError::into_inner)
    }
    fn alive(&self) -> bool {
        matches!(self.child().try_wait(), Ok(None))
    }
    /// Takes over a running ssh and collects what it prints to stderr.
    fn adopt(mut child: Child, port: u16) -> Self {
        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_done = Arc::new(AtomicBool::new(false));
        if let Some(mut reader) = child.stderr.take() {
            let (errors, done) = (stderr.clone(), stderr_done.clone());
            std::thread::spawn(move || {
                let mut buffer = [0; 2048];
                while let Ok(count) = reader.read(&mut buffer) {
                    if count == 0 {
                        break;
                    }
                    let mut errors = errors.lock().unwrap_or_else(PoisonError::into_inner);
                    append_stderr_tail(&mut errors, &buffer[..count]);
                }
                done.store(true, Ordering::SeqCst);
            });
        } else {
            stderr_done.store(true, Ordering::SeqCst);
        }
        Self {
            child: Arc::new(Mutex::new(child)),
            port,
            stderr,
            stderr_done,
            settled: Arc::new(AtomicBool::new(false)),
            target: None,
            dialed: None,
            started: Instant::now(),
        }
    }
    /// Reports through `sink`, once, if ssh exits on its own. A tunnel dropped
    /// by the app (disconnect, quit, replacement) is never reported. The thread
    /// ends with the tunnel.
    fn watch(&self, environment_id: String, sink: ExitSink) {
        let (child, stderr) = (self.child.clone(), self.stderr.clone());
        let (stderr_done, settled) = (self.stderr_done.clone(), self.settled.clone());
        std::thread::spawn(move || loop {
            if settled.load(Ordering::SeqCst) {
                return;
            }
            let status = child
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .try_wait();
            match status {
                Ok(None) => std::thread::sleep(WATCH_INTERVAL),
                Ok(Some(status)) => {
                    wait_for_stderr(&stderr_done);
                    if !settled.swap(true, Ordering::SeqCst) {
                        let text = stderr.lock().unwrap_or_else(PoisonError::into_inner);
                        sink(TunnelExit {
                            environment_id,
                            exit_code: status.code(),
                            stderr: stderr_tail(&text),
                        });
                    }
                    return;
                }
                Err(_) => return,
            }
        });
    }
    /// The machine's saved target changed while this tunnel stays the way in
    /// (an address added as its other one): keep it instead of restarting.
    pub fn retarget(&mut self, target: SshTarget) {
        self.target = Some(target);
    }

    /// Tries each of the machine's addresses in turn; the tunnel remembers
    /// the machine's target as saved, whichever address carried it.
    pub fn start(
        target: &SshTarget,
        job: Option<&Arc<Job>>,
        askpass: Option<&Askpass>,
    ) -> Result<Self, String> {
        let mut failures = Vec::new();
        for dial in dial_order(target) {
            match Self::start_with_command(
                &dial,
                job,
                askpass,
                command_with_keepalive(&dial, askpass.is_some(), TUNNEL_KEEPALIVE_SECS),
            ) {
                Ok(mut tunnel) => {
                    tunnel.target = Some(target.clone());
                    tunnel.dialed = Some(dial);
                    return Ok(tunnel);
                }
                Err(error) => {
                    if job.is_some_and(|j| j.cancelled.load(Ordering::Relaxed)) {
                        return Err(error);
                    }
                    failures.push((dial.target.clone(), error));
                }
            }
        }
        Err(dial_failures(failures))
    }

    /// A quiet tunnel over one address of `saved`, as a better way in than the
    /// running one. Never prompts: a route that needs a password is no better.
    pub(crate) fn start_route(dial: &SshTarget, saved: &SshTarget) -> Result<Self, String> {
        let mut tunnel = Self::start_with_command(
            dial,
            None,
            None,
            command_with_keepalive(dial, false, TUNNEL_KEEPALIVE_SECS),
        )?;
        tunnel.target = Some(saved.clone());
        tunnel.dialed = Some(dial.clone());
        Ok(tunnel)
    }

    fn start_with_command(
        target: &SshTarget,
        job: Option<&Arc<Job>>,
        askpass: Option<&Askpass>,
        mut command: Command,
    ) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        if let Some(askpass) = askpass {
            askpass.configure(&mut command)?;
        }
        command.args([
            "-N",
            "-L",
            &format!("127.0.0.1:{port}:127.0.0.1:{}", target.remote_port),
            "--",
            &target.target,
        ]);
        command.stdin(Stdio::null()).stdout(Stdio::null());
        drop(listener);
        let child =
            spawn_owned(&mut command).map_err(|e| format!("Could not start OpenSSH: {e}"))?;
        let mut tunnel = Self::adopt(child, port);
        tunnel.target = Some(target.clone());
        let deadline = Instant::now() + Duration::from_secs(if job.is_some() { 150 } else { 20 });
        loop {
            if job.is_some_and(|j| j.cancelled.load(Ordering::Relaxed)) {
                return Err("Connection cancelled".into());
            }
            if !tunnel.alive() {
                let exit = tunnel
                    .child()
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|status| status.code());
                // Exit 255 is ssh's own failure; whether the server answers on
                // its port tells a dead network from a refused sign-in.
                let reachable = if exit == Some(255) {
                    ssh_server_reachable(target)
                } else {
                    None
                };
                wait_for_stderr(&tunnel.stderr_done);
                return Err(format!(
                    "SSH connection failed{}: {}. Open Settings → Connections and reconnect to check access.",
                    failure_tag(exit, reachable),
                    tunnel.stderr.lock().unwrap_or_else(PoisonError::into_inner).trim()
                ));
            }
            if TcpStream::connect_timeout(
                &([127, 0, 0, 1], port).into(),
                Duration::from_millis(100),
            )
            .is_ok()
            {
                // The port may answer for another listener while ssh is exiting, so
                // ssh must still run after a short re-check. This narrows that window;
                // it does not close it.
                std::thread::sleep(Duration::from_millis(150));
                if tunnel.alive() {
                    return Ok(tunnel);
                }
                continue;
            }
            if Instant::now() >= deadline {
                return Err("SSH timed out connecting to the machine.".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[derive(Default)]
struct Slot {
    tunnel: Option<Tunnel>,
    failure: Option<(Instant, String)>,
    generation: u64,
    environment_id: String,
}

/// A running tunnel that dialed a later address than its machine prefers.
pub(crate) struct LaterRoute {
    pub id: String,
    pub saved: SshTarget,
    /// The preferred addresses ahead of the one in use, best first.
    pub better: Vec<SshTarget>,
    slot: Arc<Mutex<Slot>>,
    generation: u64,
}

pub struct TunnelLease {
    pub endpoint: String,
    slot: Arc<Mutex<Slot>>,
    generation: u64,
}

/// Each machine has its own lock: restarting one machine's tunnel (up to
/// 20 seconds) must not block requests to other machines.
#[derive(Default)]
pub struct Tunnels {
    slots: Mutex<HashMap<String, Arc<Mutex<Slot>>>>,
    /// Told when a tunnel's ssh exits by itself; unset in tests that do not care.
    exit_sink: Mutex<Option<ExitSink>>,
}
impl Tunnels {
    /// A retained lease is not authority after its registry slot is replaced.
    /// Release both locks before performing any RPC or browser socket IO.
    pub(crate) fn is_current(&self, id: &str, lease: &TunnelLease) -> bool {
        let Some(slot) = self.slots().get(id).cloned() else {
            return false;
        };
        if !Arc::ptr_eq(&slot, &lease.slot) {
            return false;
        }
        // Busy means a tunnel start holds the slot: not current, without waiting.
        let Ok(current) = slot.try_lock() else {
            return false;
        };
        current.generation == lease.generation && current.tunnel.as_ref().is_some_and(Tunnel::alive)
    }
    fn slots(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Mutex<Slot>>>> {
        self.slots.lock().unwrap_or_else(PoisonError::into_inner)
    }
    pub fn set_exit_sink(&self, sink: ExitSink) {
        *self
            .exit_sink
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(sink);
    }
    fn watch(&self, environment_id: &str, tunnel: &Tunnel) {
        let sink = self
            .exit_sink
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(sink) = sink {
            tunnel.watch(environment_id.into(), sink);
        }
    }
    pub fn insert(&self, id: String, environment_id: &str, tunnel: Tunnel) {
        self.watch(environment_id, &tunnel);
        // A fresh slot never waits for a reconnect in progress; that attempt's
        // tunnel is dropped with the replaced slot.
        let slot = Slot {
            tunnel: Some(tunnel),
            failure: None,
            generation: 1,
            environment_id: environment_id.into(),
        };
        let old = self.slots().insert(id, Arc::new(Mutex::new(slot)));
        drop(old);
    }
    pub fn remove(&self, id: &str) {
        let old = self.slots().remove(id);
        drop(old);
    }
    /// The tunnel to a machine, started if it is down. With `allow_connect`
    /// off (a background poll while automatic reconnect is off) a missing
    /// tunnel is an immediate error: no ssh is spawned.
    pub fn endpoint(
        &self,
        id: &str,
        environment_id: &str,
        target: &SshTarget,
        allow_connect: bool,
    ) -> Result<TunnelLease, String> {
        let slot = self.slots().entry(id.into()).or_default().clone();
        // A call that may not connect (a cancel, a peek, a background poll) must not
        // queue behind a tunnel start that holds the slot for many seconds: contention
        // reads as unreachable, which those callers already handle.
        let mut current = if allow_connect {
            slot.lock().unwrap_or_else(PoisonError::into_inner)
        } else {
            match slot.try_lock() {
                Ok(guard) => guard,
                Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
                Err(TryLockError::WouldBlock) => {
                    return Err(
                        "Machine is unreachable right now: a connection attempt is in progress."
                            .into(),
                    );
                }
            }
        };
        current.environment_id = environment_id.into();
        if let Some(tunnel) = current.tunnel.as_mut() {
            // A request that read the machine just before its address was edited
            // can start a tunnel to the old one; it is dropped here, not reused.
            let stale = tunnel
                .target
                .as_ref()
                .is_some_and(|started| !same_tunnel_route(started, target));
            if tunnel.alive() && !stale {
                return Ok(TunnelLease {
                    endpoint: format!("http://127.0.0.1:{}", tunnel.port),
                    slot: slot.clone(),
                    generation: current.generation,
                });
            }
        }
        current.tunnel = None;
        if !allow_connect {
            return Err(
                "Machine is unreachable. Automatic reconnect is off; reconnect it yourself.".into(),
            );
        }
        if let Some((when, error)) = &current.failure {
            if when.elapsed() < Duration::from_secs(10) {
                return Err(error.clone());
            }
        }
        match Tunnel::start(target, None, None) {
            Ok(tunnel) => {
                self.watch(environment_id, &tunnel);
                let endpoint = format!("http://127.0.0.1:{}", tunnel.port);
                current.failure = None;
                current.generation = current.generation.wrapping_add(1);
                current.tunnel = Some(tunnel);
                Ok(TunnelLease {
                    endpoint,
                    slot: slot.clone(),
                    generation: current.generation,
                })
            }
            Err(error) => {
                current.failure = Some((Instant::now(), error.clone()));
                Err(error)
            }
        }
    }
    /// Whether ssh reported, since the last time this was asked, that the
    /// machine refused the forwarded connection: the tunnel is fine, but no
    /// host is listening. Reading clears the report so it is not reused.
    pub fn take_host_refusal(&self, id: &str) -> bool {
        let Some(slot) = self.slots().get(id).cloned() else {
            return false;
        };
        // Busy means a tunnel start holds the slot: no report can be read now.
        let current = match slot.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return false,
        };
        let Some(tunnel) = current.tunnel.as_ref() else {
            return false;
        };
        let mut text = tunnel.stderr.lock().unwrap_or_else(PoisonError::into_inner);
        let refused = host_refused(&text);
        if refused {
            text.clear();
        }
        refused
    }
    /// Lets the next request start a tunnel at once instead of repeating the
    /// error of a recent failed attempt.
    pub fn forget_failure(&self, id: &str) {
        let Some(slot) = self.slots().get(id).cloned() else {
            return;
        };
        slot.lock().unwrap_or_else(PoisonError::into_inner).failure = None;
    }
    pub fn invalidate(&self, id: &str, lease: &TunnelLease) {
        let Some(slot) = self.slots().get(id).cloned() else {
            return;
        };
        if !Arc::ptr_eq(&slot, &lease.slot) {
            return;
        }
        let mut current = slot.lock().unwrap_or_else(PoisonError::into_inner);
        if current.generation == lease.generation {
            current.tunnel = None;
            current.failure = None;
        }
    }
    pub fn clear(&self) {
        let old = std::mem::take(&mut *self.slots());
        drop(old);
    }

    /// The address a machine's running tunnel dialed, if it is up.
    pub(crate) fn dialed(&self, id: &str) -> Option<SshTarget> {
        let slot = self.slots().get(id).cloned()?;
        let current = slot.try_lock().ok()?;
        let tunnel = current.tunnel.as_ref().filter(|tunnel| tunnel.alive())?;
        tunnel.dialed.clone()
    }

    /// Tunnels up for at least `settled` over a later address than their
    /// machine prefers. Never waits on a slot: a busy one is skipped until the
    /// next check.
    pub(crate) fn later_routes(&self, settled: Duration) -> Vec<LaterRoute> {
        let slots: Vec<_> = self
            .slots()
            .iter()
            .map(|(id, slot)| (id.clone(), slot.clone()))
            .collect();
        slots
            .into_iter()
            .filter_map(|(id, slot)| {
                let (saved, dialed, generation) = {
                    let current = slot.try_lock().ok()?;
                    let tunnel = current.tunnel.as_ref().filter(|tunnel| tunnel.alive())?;
                    if tunnel.started.elapsed() < settled {
                        return None;
                    }
                    (
                        tunnel.target.clone()?,
                        tunnel.dialed.clone()?,
                        current.generation,
                    )
                };
                let mut better = candidates(&saved);
                // An address the owner turned off is no longer listed: every one is better.
                let rank = better
                    .iter()
                    .position(|dial| dial.target == dialed.target)
                    .unwrap_or(better.len());
                better.truncate(rank);
                (!better.is_empty()).then_some(LaterRoute {
                    id,
                    saved,
                    better,
                    slot,
                    generation,
                })
            })
            .collect()
    }

    /// Puts `tunnel` in place of the one `later` saw, if that one still runs
    /// unchanged. The old tunnel is closed on purpose, so no drop is reported;
    /// leases on it stop being current and their callers reconnect at once.
    pub(crate) fn switch(&self, later: &LaterRoute, tunnel: Tunnel) -> bool {
        let unchanged = self
            .slots()
            .get(&later.id)
            .is_some_and(|slot| Arc::ptr_eq(slot, &later.slot));
        if !unchanged {
            return false;
        }
        let mut current = later.slot.lock().unwrap_or_else(PoisonError::into_inner);
        let running = current.tunnel.as_ref().is_some_and(|old| {
            old.alive()
                && old
                    .target
                    .as_ref()
                    .is_some_and(|target| same_tunnel_route(target, &later.saved))
        });
        if current.generation != later.generation || !running {
            return false;
        }
        let environment_id = current.environment_id.clone();
        self.watch(&environment_id, &tunnel);
        current.generation = current.generation.wrapping_add(1);
        current.failure = None;
        let old = current.tunnel.replace(tunnel);
        drop(current);
        drop(old);
        true
    }
}

/// How this desktop appears in the host's device list.
// A saved authentication change applies to the next SSH handshake. It must not
// tear down an already authenticated tunnel and interrupt active host sessions.
fn same_tunnel_route(left: &SshTarget, right: &SshTarget) -> bool {
    left.target == right.target
        && left.port == right.port
        && left.remote_port == right.remote_port
        && left.alternate == right.alternate
        && left.host_key_alias == right.host_key_alias
}

pub fn device_name() -> String {
    #[cfg(not(windows))]
    let run = |program: &str, args: &[&str]| {
        Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
    };
    #[cfg(target_os = "macos")]
    let name = run("scutil", &["--get", "ComputerName"]).or_else(|| run("hostname", &[]));
    #[cfg(windows)]
    let name = std::env::var("COMPUTERNAME").ok();
    #[cfg(not(any(target_os = "macos", windows)))]
    let name = std::fs::read_to_string("/etc/hostname")
        .ok()
        .or_else(|| run("hostname", &[]));
    let name: String = name
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect();
    if name.is_empty() {
        "bycoda desktop".into()
    } else {
        format!("bycoda on {name}")
    }
}

#[cfg(test)]
#[path = "remote_ssh_tests.rs"]
mod tests;
