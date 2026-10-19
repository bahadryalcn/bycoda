use crate::ssh_askpass::Askpass;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, PoisonError,
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

/// The addresses to try, in order: the one whose SSH port answers first,
/// then the other. A machine with one address has just that one.
pub fn dial_order(target: &SshTarget) -> Vec<SshTarget> {
    let primary = SshTarget {
        alternate: None,
        host_key_alias: target.host_key_alias.clone(),
        ..target.clone()
    };
    let Some(alternate) = target
        .alternate
        .as_deref()
        .map(str::trim)
        .filter(|alternate| !alternate.is_empty() && *alternate != target.target)
    else {
        return vec![primary];
    };
    let second = SshTarget {
        target: alternate.to_string(),
        alternate: None,
        host_key_alias: known_host_key_name(&primary),
        ..target.clone()
    };
    // Both checks at once: an unreachable address costs its timeout only once.
    let probe = |candidate: SshTarget| std::thread::spawn(move || ssh_server_reachable(&candidate));
    let first = probe(primary.clone());
    let other = probe(second.clone());
    let first = first.join().ok().flatten();
    let other = other.join().ok().flatten();
    if first == Some(false) && other == Some(true) {
        vec![second, primary]
    } else {
        vec![primary, second]
    }
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

fn capture(mut reader: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
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
        output
    })
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

fn detect_platform_from_dials(
    dials: Vec<SshTarget>,
    job: &Arc<Job>,
    mut probe: impl FnMut(&SshTarget) -> Result<HostPlatform, String>,
) -> Result<(HostPlatform, SshTarget), String> {
    let mut failure = String::new();
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
                failure = error;
            }
        }
    }
    Err(failure)
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
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start OpenSSH: {e}"))?;
    let pipes = match (child.stdout.take(), child.stderr.take(), child.stdin.take()) {
        (Some(stdout), Some(stderr), Some(stdin)) => (stdout, stderr, stdin),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("OpenSSH process pipes are unavailable".into());
        }
    };
    let stdout = capture(pipes.0);
    let stderr = capture(pipes.1);
    let mut stdin = pipes.2;
    let writer = std::thread::spawn(move || stdin.write_all(script.as_bytes()));
    let deadline = Instant::now() + Duration::from_secs(300);
    let result = loop {
        if job.cancelled.load(Ordering::Relaxed) || Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
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
                let _ = child.kill();
                let _ = child.wait();
                break Err(error.to_string());
            }
        }
    };
    let _ = writer.join();
    let output = String::from_utf8_lossy(&stdout.join().unwrap_or_default()).to_string();
    let errors = String::from_utf8_lossy(&stderr.join().unwrap_or_default()).to_string();
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
/// How often a tunnel's ssh process is checked for having exited.
const WATCH_INTERVAL: Duration = Duration::from_millis(250);

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
fn ssh_server_reachable(target: &SshTarget) -> Option<bool> {
    let (host, port) = parse_ssh_config_dump(&ssh_config_dump(target)?)?;
    Some(tcp_reachable(&host, port, Duration::from_secs(3)))
}

/// `ssh -G` for a target: the settings ssh would use, without connecting.
fn ssh_config_dump(target: &SshTarget) -> Option<String> {
    let mut command = Command::new("ssh");
    command.arg("-G");
    if let Some(port) = target.port {
        command.args(["-p", &port.to_string()]);
    }
    command
        .args(["--", &target.target])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    crate::hide_window_console(&mut command);
    let output = command.output().ok().filter(|o| o.status.success())?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn tcp_reachable(host: &str, port: u16, timeout: Duration) -> bool {
    use std::net::ToSocketAddrs;
    (host, port)
        .to_socket_addrs()
        .is_ok_and(|mut addrs| addrs.any(|addr| TcpStream::connect_timeout(&addr, timeout).is_ok()))
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
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        self.settled.store(true, Ordering::SeqCst);
        let mut child = self.child();
        let _ = child.kill();
        let _ = child.wait();
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
                    if errors.len() < 8192 {
                        errors.push_str(&String::from_utf8_lossy(&buffer[..count]));
                    }
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
        let mut failure = String::new();
        for dial in dial_order(target) {
            match Self::start_with_command(
                &dial,
                job,
                askpass,
                command_with_keepalive(&dial, askpass.is_some(), TUNNEL_KEEPALIVE_SECS),
            ) {
                Ok(mut tunnel) => {
                    tunnel.target = Some(target.clone());
                    return Ok(tunnel);
                }
                Err(error) => {
                    if job.is_some_and(|j| j.cancelled.load(Ordering::Relaxed)) {
                        return Err(error);
                    }
                    failure = error;
                }
            }
        }
        Err(failure)
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
        let child = command
            .spawn()
            .map_err(|e| format!("Could not start OpenSSH: {e}"))?;
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
                return Ok(tunnel);
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
        let mut current = slot.lock().unwrap_or_else(PoisonError::into_inner);
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
        let current = slot.lock().unwrap_or_else(PoisonError::into_inner);
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
mod tests {
    #[test]
    fn job_remains_readable_and_writable_after_mutex_poison() {
        let job = Job::new();
        let poisoned = job.clone();
        assert!(std::thread::spawn(move || {
            let _guard = poisoned.inner.lock().unwrap();
            panic!("simulate worker panic");
        })
        .join()
        .is_err());
        job.message("Recovered");
        assert_eq!(job.view().message, "Recovered");
    }

    #[test]
    fn setup_falls_back_after_ssh_failure_and_keeps_the_selected_host_key() {
        let primary = SshTarget {
            target: "me@home".into(),
            port: None,
            remote_port: 3774,
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        };
        let alternate = SshTarget {
            target: "me@tailnet".into(),
            host_key_alias: Some("home".into()),
            ..primary.clone()
        };
        let mut attempted = Vec::new();
        let (platform, selected) =
            detect_platform_from_dials(vec![primary, alternate], &Job::new(), |dial| {
                attempted.push(dial.target.clone());
                if dial.target == "me@home" {
                    Err("SSH connection refused".into())
                } else {
                    Ok(HostPlatform::Unix)
                }
            })
            .unwrap();
        assert_eq!(attempted, ["me@home", "me@tailnet"]);
        assert_eq!(platform, HostPlatform::Unix);
        let script_dial = dial_order(&selected).remove(0);
        assert_eq!(script_dial.target, "me@tailnet");
        assert_eq!(script_dial.host_key_alias.as_deref(), Some("home"));
    }

    #[test]
    fn cancelled_setup_does_not_try_another_address() {
        let job = Job::new();
        job.cancel();
        let target = SshTarget {
            target: "me@home".into(),
            port: None,
            remote_port: 3774,
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        };
        let result = detect_platform_from_dials(vec![target], &job, |_| {
            panic!("cancelled setup must not connect")
        });
        assert_eq!(result.unwrap_err(), "Connection cancelled");
    }
    use super::*;

    #[test]
    fn stale_requests_cannot_invalidate_a_newer_tunnel() {
        let tunnels = Tunnels::default();
        let slot = |generation| {
            Arc::new(Mutex::new(Slot {
                tunnel: None,
                failure: Some((Instant::now(), "keep".into())),
                generation,
            }))
        };
        let old = slot(1);
        tunnels.slots().insert("host".into(), old.clone());
        let old_lease = TunnelLease {
            endpoint: String::new(),
            slot: old,
            generation: 1,
        };
        let newer = slot(2);
        tunnels.slots().insert("host".into(), newer.clone());
        tunnels.invalidate("host", &old_lease);
        assert!(newer.lock().unwrap().failure.is_some());
        let stale_lease = TunnelLease {
            endpoint: String::new(),
            slot: newer.clone(),
            generation: 1,
        };
        tunnels.invalidate("host", &stale_lease);
        assert!(newer.lock().unwrap().failure.is_some());
        tunnels.invalidate(
            "host",
            &TunnelLease {
                generation: 2,
                ..stale_lease
            },
        );
        assert!(newer.lock().unwrap().failure.is_none());
    }
    #[test]
    fn a_requested_reconnect_forgets_the_cached_failure() {
        let tunnels = Tunnels::default();
        let slot = Arc::new(Mutex::new(Slot {
            tunnel: None,
            failure: Some((Instant::now(), "SSH connection failed".into())),
            generation: 1,
        }));
        tunnels.slots().insert("host".into(), slot.clone());
        tunnels.forget_failure("other");
        assert!(slot.lock().unwrap().failure.is_some());
        tunnels.forget_failure("host");
        assert!(slot.lock().unwrap().failure.is_none());
    }
    // scripts/checks/test-remote-ssh.py creates an isolated sshd, host and keypair.
    // This test uses the production tunnel lifecycle and shell transport.
    #[test]
    #[ignore = "requires the isolated loopback SSH fixture"]
    fn loopback_transport_preserves_host_and_reconnects() {
        let required = |key| std::env::var(key).expect("Run scripts/checks/test-remote-ssh.py");
        let target = SshTarget {
            target: required("BYCODA_TEST_SSH_TARGET"),
            port: Some(required("BYCODA_TEST_SSH_PORT").parse().unwrap()),
            remote_port: required("BYCODA_TEST_HOST_PORT").parse().unwrap(),
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        };
        let make_command = || {
            let mut command = command(&target, false);
            command.args([
                "-F",
                "/dev/null",
                "-i",
                &required("BYCODA_TEST_SSH_KEY"),
                "-o",
                "IdentitiesOnly=yes",
                "-o",
                &format!("UserKnownHostsFile={}", required("BYCODA_TEST_KNOWN_HOSTS")),
            ]);
            command
        };
        let job = Job::new();
        let askpass = job.askpass().unwrap();
        let detected = run_remote_command(
            &target,
            String::new(),
            &job,
            &askpass,
            make_command(),
            PLATFORM_PROBE,
        )
        .unwrap();
        assert_eq!(parse_platform(&detected).unwrap(), HostPlatform::Unix);
        let output = run_script_with_command(
            &target,
            "printf 'remote-script-ok\\n'\n".into(),
            &job,
            &askpass,
            make_command(),
        )
        .unwrap();
        assert_eq!(output.trim(), "remote-script-ok");
        let environment = required("BYCODA_TEST_ENVIRONMENT");
        for _ in 0..2 {
            let tunnel = Tunnel::start_with_command(&target, None, None, make_command()).unwrap();
            let response = ureq::post(&format!("http://127.0.0.1:{}/rpc", tunnel.port))
                .set(
                    "Authorization",
                    &format!("Bearer {}", required("BYCODA_TEST_TOKEN")),
                )
                .send_string(r#"{"version":1,"method":"environment.describe"}"#)
                .unwrap();
            let value: serde_json::Value = serde_json::from_reader(response.into_reader()).unwrap();
            assert_eq!(value["result"]["environmentId"], environment);
            drop(tunnel);
            // A client disappearing must not kill the independently owned host.
            assert!(TcpStream::connect(("127.0.0.1", target.remote_port)).is_ok());
        }
    }
    /// A harmless stand-in for ssh: prints `boom` to stderr and exits with 3.
    fn short_lived_child() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "echo boom 1>&2 & exit 3"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "echo boom >&2; exit 3"]);
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }
    /// A stand-in that keeps running until it is killed.
    fn long_lived_child() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }
    fn exit_events() -> (Tunnels, std::sync::mpsc::Receiver<TunnelExit>) {
        let tunnels = Tunnels::default();
        let (sender, receiver) = std::sync::mpsc::channel();
        let sender = Mutex::new(sender);
        tunnels.set_exit_sink(Arc::new(move |exit| {
            let _ = sender.lock().unwrap().send(exit);
        }));
        (tunnels, receiver)
    }
    #[test]
    fn an_unexpected_ssh_exit_is_reported_once_with_its_status_and_last_words() {
        let (tunnels, events) = exit_events();
        tunnels.insert("m".into(), "env", Tunnel::adopt(short_lived_child(), 1));
        let exit = events.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(exit.environment_id, "env");
        assert_eq!(exit.exit_code, Some(3));
        assert_eq!(exit.stderr, "boom");
        // Dropping the dead tunnel afterwards says nothing more.
        tunnels.remove("m");
        assert!(events.recv_timeout(Duration::from_millis(700)).is_err());
    }
    #[test]
    fn closing_replacing_or_clearing_a_tunnel_on_purpose_reports_nothing() {
        let (tunnels, events) = exit_events();
        tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 1));
        // Replacement by a fresh tunnel, then a disconnect, then app quit.
        tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 2));
        tunnels.remove("m");
        tunnels.insert("n".into(), "env", Tunnel::adopt(long_lived_child(), 3));
        tunnels.clear();
        assert!(events.recv_timeout(Duration::from_millis(900)).is_err());
    }
    #[test]
    fn removing_a_machines_tunnel_clears_its_failure_and_reports_nothing() {
        let (tunnels, events) = exit_events();
        tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 1));
        tunnels.slots().get("m").unwrap().lock().unwrap().failure =
            Some((Instant::now(), "old address failed".into()));
        tunnels.remove("m");
        assert!(tunnels.slots().get("m").is_none());
        assert!(events.recv_timeout(Duration::from_millis(700)).is_err());
    }
    #[test]
    fn a_tunnel_started_for_another_address_is_not_reused() {
        let tunnels = Tunnels::default();
        let target = |host: &str| SshTarget {
            target: host.into(),
            port: None,
            remote_port: 3774,
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        };
        let mut tunnel = Tunnel::adopt(long_lived_child(), 4321);
        tunnel.target = Some(target("me@old"));
        tunnels.insert("m".into(), "env", tunnel);
        let Ok(lease) = tunnels.endpoint("m", "env", &target("me@old"), false) else {
            panic!("same address reuses the tunnel")
        };
        assert_eq!(lease.endpoint, "http://127.0.0.1:4321");
        let error = tunnels
            .endpoint("m", "env", &target("me@new"), false)
            .err()
            .expect("the old tunnel is dropped, not reused");
        assert!(error.starts_with("Machine is unreachable"));
        let slot = tunnels.slots().get("m").unwrap().clone();
        assert!(slot.lock().unwrap().tunnel.is_none());
    }
    #[test]
    fn a_missing_tunnel_is_not_started_when_connecting_is_not_allowed() {
        let tunnels = Tunnels::default();
        let target = SshTarget {
            target: "nowhere.invalid".into(),
            port: None,
            remote_port: 3774,
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        };
        let started = Instant::now();
        let error = tunnels
            .endpoint("m", "env", &target, false)
            .err()
            .expect("no tunnel exists");
        assert!(error.starts_with("Machine is unreachable. Automatic reconnect is off"));
        assert!(started.elapsed() < Duration::from_secs(1), "spawned ssh");
        // Nothing is cached, so a user-initiated attempt is not answered with it.
        let slot = tunnels.slots().get("m").unwrap().clone();
        assert!(slot.lock().unwrap().failure.is_none());
    }
    #[test]
    fn saved_identity_is_used_for_setup_tunnels_and_alternate_addresses() {
        let target = SshTarget {
            target: "alice@host.invalid".into(),
            port: Some(2222),
            remote_port: 3776,
            alternate: Some("alice@alternate.invalid".into()),
            host_key_alias: None,
            identity_file: Some("C:/keys/saved key".into()),
        };
        let decoded: SshTarget =
            serde_json::from_str(&serde_json::to_string(&target).unwrap()).unwrap();
        for interactive in [false, true] {
            let command = command(&decoded, interactive);
            let args: Vec<String> = command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert!(args
                .windows(2)
                .any(|pair| pair == ["-i", "C:/keys/saved key"]));
            assert!(args.contains(&"IdentitiesOnly=yes".into()));
        }
        assert!(dial_order(&decoded)
            .iter()
            .all(|dial| dial.identity_file == target.identity_file));
        let legacy: SshTarget =
            serde_json::from_str(r#"{"target":"host.invalid","port":22,"remotePort":3776}"#)
                .unwrap();
        assert!(legacy.identity_file.is_none());
        let mut tunnel = Tunnel::adopt(long_lived_child(), 4321);
        tunnel.target = Some(decoded.clone());
        let tunnels = Tunnels::default();
        tunnels.insert("saved".into(), "env", tunnel);
        let changed_key = SshTarget {
            identity_file: Some("C:/keys/replacement".into()),
            ..decoded
        };
        assert_eq!(
            tunnels
                .endpoint("saved", "env", &changed_key, false)
                .unwrap()
                .endpoint,
            "http://127.0.0.1:4321"
        );
    }

    #[test]
    fn tunnels_use_fast_keepalives_without_blocking_interactive_auth() {
        let target = SshTarget {
            target: "me@host".into(),
            port: Some(2222),
            remote_port: 3774,
            alternate: None,
            host_key_alias: None,
            identity_file: None,
        };
        let args = |command: &Command| -> Vec<String> {
            command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect()
        };
        let tunnel = args(&command_with_keepalive(
            &target,
            false,
            TUNNEL_KEEPALIVE_SECS,
        ));
        for option in [
            "ServerAliveInterval=5",
            "ServerAliveCountMax=3",
            "ExitOnForwardFailure=yes",
            "ConnectTimeout=15",
            "BatchMode=yes",
        ] {
            assert!(tunnel.contains(&option.to_string()), "{option}");
        }
        // Setup commands keep the slower probes; an interactive attempt may prompt.
        let setup = args(&command(&target, true));
        assert!(setup.contains(&"ServerAliveInterval=15".to_string()));
        assert!(setup.contains(&"BatchMode=no".to_string()));
        let probe = command(&target, false);
        let env = |name: &str| {
            probe
                .get_envs()
                .find(|(key, _)| *key == name)
                .and_then(|(_, value)| value.map(|v| v.to_string_lossy().into_owned()))
        };
        assert_eq!(env("LC_ALL").as_deref(), Some("C"));
        assert_eq!(env("LANG").as_deref(), Some("C"));
    }
    #[test]
    fn ssh_stderr_is_reduced_to_a_few_safe_lines() {
        let noisy = "one\ntwo\x07\nBearer abc.def\nthree\nfour\nfive\nsix\nPASSWORD=hunter2\n";
        assert_eq!(stderr_tail(noisy), "two\nthree\nfour\nfive\nsix");
        assert_eq!(stderr_tail(&"x".repeat(500)).len(), 200);
        assert_eq!(stderr_tail(""), "");
    }
    #[test]
    fn a_refused_forward_is_told_from_a_dead_tunnel() {
        assert!(host_refused(
            "channel 2: open failed: connect failed: Connection refused\n"
        ));
        assert!(host_refused(
            "channel 0: open failed: connect failed: No connection could be made because the target machine actively refused it.\n"
        ));
        assert!(!host_refused(
            "ssh: connect to host mini port 22: Connection refused\n"
        ));
        assert!(!host_refused(""));
        let tunnels = Tunnels::default();
        let tunnel = Tunnel::adopt(long_lived_child(), 1);
        tunnel
            .stderr
            .lock()
            .unwrap()
            .push_str("channel 3: open failed: connect failed: Connection refused\n");
        tunnels.insert("m".into(), "env", tunnel);
        assert!(tunnels.take_host_refusal("m"));
        assert!(!tunnels.take_host_refusal("m"), "a report is used once");
        assert!(!tunnels.take_host_refusal("other"));
    }
    #[test]
    fn ssh_config_dumps_give_the_address_ssh_would_dial() {
        let dump = "user me\nhostname 10.0.0.7\nport 2200\nidentityfile ~/.ssh/id_ed25519\n";
        assert_eq!(parse_ssh_config_dump(dump), Some(("10.0.0.7".into(), 2200)));
        assert_eq!(
            parse_ssh_config_dump("hostname a\nport 22\nproxycommand none\nproxyjump none\n"),
            Some(("a".into(), 22))
        );
        for proxied in ["proxyjump bastion", "proxycommand nc %h %p"] {
            assert_eq!(
                parse_ssh_config_dump(&format!("hostname a\nport 22\n{proxied}\n")),
                None
            );
        }
        assert_eq!(parse_ssh_config_dump("hostname a\n"), None);
        assert_eq!(parse_ssh_config_dump(""), None);
    }
    #[test]
    fn a_machine_with_two_addresses_dials_the_one_that_answers_first() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let target = SshTarget {
            target: "me@nowhere.invalid".into(),
            port: Some(port),
            remote_port: 3774,
            alternate: Some("me@127.0.0.1".into()),
            host_key_alias: None,
            identity_file: None,
        };
        let order = dial_order(&target);
        assert_eq!(
            order
                .iter()
                .map(|dial| dial.target.as_str())
                .collect::<Vec<_>>(),
            ["me@127.0.0.1", "me@nowhere.invalid"]
        );
        // The other address checks the host key filed for the saved one.
        assert_eq!(order[0].host_key_alias.as_deref(), Some("nowhere.invalid"));
        assert_eq!(order[1].host_key_alias, None);
        assert!(order.iter().all(|dial| dial.alternate.is_none()));

        drop(listener);
        let order = dial_order(&target);
        assert_eq!(order[0].target, "me@nowhere.invalid");

        let single = SshTarget {
            alternate: None,
            ..target.clone()
        };
        assert_eq!(dial_order(&single).len(), 1);
        let blank = SshTarget {
            alternate: Some("  ".into()),
            ..target
        };
        assert_eq!(dial_order(&blank).len(), 1);
    }

    #[test]
    fn the_other_address_is_checked_like_the_first() {
        assert_eq!(validate_alternate(None, None), Ok(None));
        assert_eq!(validate_alternate(Some("  "), None), Ok(None));
        assert_eq!(
            validate_alternate(Some(" me@100.64.0.5 "), None),
            Ok(Some("me@100.64.0.5".into()))
        );
        assert!(validate_alternate(Some("-oProxyCommand=x"), None).is_err());
    }

    #[test]
    fn tcp_reachability_and_failure_tags() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(tcp_reachable("127.0.0.1", port, Duration::from_secs(2)));
        drop(listener);
        assert!(!tcp_reachable("127.0.0.1", port, Duration::from_secs(2)));
        assert_eq!(
            failure_tag(Some(255), Some(true)),
            " (exit 255, host reachable)"
        );
        assert_eq!(
            failure_tag(Some(255), Some(false)),
            " (exit 255, host unreachable)"
        );
        assert_eq!(failure_tag(None, None), "");
    }
    #[test]
    fn ssh_targets_cannot_inject_options_or_shell_commands() {
        for target in [
            "home",
            "me@mac-mini.local",
            "user@192.168.1.4",
            "user@[::1]",
        ] {
            assert!(validate_target(target, None).is_ok());
        }
        for target in [
            "",
            "-oProxyCommand=bad",
            "host;touch /tmp/x",
            "host\nname",
            "$(whoami)",
            "user@host command",
            "host/../../x",
            "ssh://user@host",
            "a@b@c",
        ] {
            assert!(validate_target(target, None).is_err(), "{target}");
        }
        assert!(validate_target("host", Some(0)).is_err());
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }
    #[test]
    fn unix_bootstrap_accepts_windows_checkout_line_endings() {
        let lf_template = include_str!("remote_bootstrap.sh").replace("\r\n", "\n");
        let crlf_template = lf_template.replace('\n', "\r\n");
        let script = bootstrap_script_from_template(HostPlatform::Unix, &crlf_template);
        assert!(script.starts_with("set -eu\n"));
        assert!(!script.contains('\r'));
        assert_eq!(
            script,
            bootstrap_script_from_template(HostPlatform::Unix, &lf_template)
        );
    }
    #[test]
    fn bootstrap_is_versioned_and_only_explicit_upgrade_restarts_the_host() {
        let script = bootstrap_script(HostPlatform::Unix);
        assert!(script.contains("BASE=\"$HOME/.bycoda-host\""));
        assert!(script.contains("ENTRY=\"$BASE/bin/bycoda-host\""));
        assert!(script.contains("BYCODA_HOST_PORT:-3776"));
        assert!(script.contains("bycoda host distribution is not configured"));
        assert!(!script.contains("github.com/bahadryalcn/bycoda"));
        assert!(!script.contains('\r'));
        assert!(!script.contains("@@"));
        assert!(script.contains("--proto '=https'"));
        assert!(script.contains("checksum mismatch"));
        assert!(script.contains("\"$FORCE_UPGRADE\" = 1"));
        assert!(script.contains("service uninstall"));
        assert!(upgrade_script(HostPlatform::Unix, 3774).starts_with("BYCODA_HOST_FORCE_UPGRADE=1"));
        assert!(!upgrade_script(HostPlatform::Unix, 3774).contains('\r'));
        assert!(upgrade_script(HostPlatform::Windows, 3774)
            .starts_with("$env:BYCODA_HOST_FORCE_UPGRADE = '1'"));
    }
    #[test]
    fn remote_platform_probe_handles_cmd_powershell_and_unix() {
        assert_eq!(
            parse_platform("BYCODA_PLATFORM $env:OS Windows_NT $OS\r\n").unwrap(),
            HostPlatform::Windows
        );
        assert_eq!(
            parse_platform("BYCODA_PLATFORM\r\nWindows_NT\r\n%OS%\r\n").unwrap(),
            HostPlatform::Windows
        );
        assert_eq!(
            parse_platform("BYCODA_PLATFORM :OS %OS%\n").unwrap(),
            HostPlatform::Unix
        );
        assert!(parse_platform("unrecognized shell").is_err());
        assert!(powershell_reader().len() < 4096);
        let script = bootstrap_script(HostPlatform::Windows);
        assert!(!script.contains("@@"));
        assert!(script.contains("checksum mismatch"));
        assert!(script.contains("Protect-BycodaDirectory"));
        assert!(pairing_script(HostPlatform::Windows, "Nick's $PC").contains("'Nick''s $PC'"));
    }
    #[cfg(windows)]
    #[test]
    fn windows_shells_detect_the_platform_and_accept_utf8_scripts() {
        for (program, args) in [
            ("cmd.exe", vec!["/D", "/C"]),
            (
                "powershell.exe",
                vec!["-NoProfile", "-NonInteractive", "-Command"],
            ),
        ] {
            let output = Command::new(program)
                .env_remove("PSModulePath")
                .args(args)
                .arg(PLATFORM_PROBE.join(" "))
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(
                parse_platform(&String::from_utf8_lossy(&output.stdout)).unwrap(),
                HostPlatform::Windows
            );
        }
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &powershell_reader(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all("Write-Output '日本語 🖥'\n".as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "日本語 🖥");
    }
    #[test]
    fn device_names_are_bounded_single_lines() {
        let name = device_name();
        assert!(name.starts_with("bycoda"));
        assert!(name.chars().count() <= 100);
        assert!(!name.chars().any(char::is_control));
    }
    #[test]
    fn answers_must_match_the_current_prompt() {
        let job = Job::new();
        assert!(job.answer("old", "yes".into()).is_err());
        let waiter = job.clone();
        let thread = std::thread::spawn(move || waiter.prompt("Trust this host?".into(), true));
        while job.view().prompt.is_none() {
            std::thread::sleep(Duration::from_millis(5));
        }
        let prompt = job.view().prompt.unwrap();
        assert!(job.answer(&prompt.id, "arbitrary".into()).is_err());
        job.answer(&prompt.id, "yes".into()).unwrap();
        assert_eq!(thread.join().unwrap(), Some("yes".into()));
        assert!(job.answer(&prompt.id, "yes".into()).is_err());
    }
}
