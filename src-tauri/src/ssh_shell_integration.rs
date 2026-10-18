//! Opt-in, session-only Bash readline integration. No key recording or history
//! persistence. Only policy-approved shell snapshots leave the remote process.
use serde::Serialize;

const MARKER: &[u8] = b"\x1b]777;bycoda;";
#[cfg(all(test, windows))]
#[path = "ssh_shell_native_tests.rs"]
mod native_tests;
#[cfg(all(test, windows))]
#[path = "ssh_shell_powershell_tests.rs"]
mod powershell_native_tests;
pub(crate) const REQUEST_KEYS: &[u8] = b"\x18\x07";
const SAFE_HISTORY: &[&str] = &[
    "cd",
    "git",
    "ls",
    "ls -l",
    "ls -la",
    "pwd",
    "git status",
    "git diff",
    "git log --oneline",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellEvent {
    pub id: String,
    pub status: String,
    pub shell: &'static str,
    pub user: String,
    pub host: String,
    pub prompt_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<String>>,
}
struct Snapshot {
    created: std::time::Instant,
    request_id: String,
    prefix: String,
    values: Vec<String>,
    source: &'static str,
}
struct Pending {
    request_id: String,
    prompt_seq: u64,
    request_seq: u64,
    source: &'static str,
}
pub(crate) struct ShellIntegration {
    mode: &'static str,
    nonce: String,
    buffer: Vec<u8>,
    ready: bool,
    user: String,
    host: String,
    pending: Option<Pending>,
    prompt_seq: u64,
    request_seq: u64,
    snapshot: Option<Snapshot>,
}

fn safe_atom(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}
pub(crate) fn safe_prefix(value: &str) -> bool {
    SAFE_HISTORY
        .iter()
        .any(|candidate| candidate.starts_with(value))
}
fn safe_candidate(prefix: &str, value: &str) -> bool {
    value.starts_with(prefix) && SAFE_HISTORY.contains(&value)
}

// This is a second boundary after filtering inside the remote editor. No shell
// evaluation, quoting, expansions or arbitrary argument-bearing history exports.
fn literal(value: &str) -> bool {
    value.len() <= 256
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " ./_:-".contains(c))
        && ![
            "password",
            "passwd",
            "secret",
            "token",
            "credential",
            ".env",
            ".ssh",
            "private",
        ]
        .iter()
        .any(|part| value.to_ascii_lowercase().contains(part))
}
fn reviewed_line(value: &str) -> bool {
    if !literal(value) {
        return false;
    }
    let words: Vec<_> = value.split(' ').collect();
    match words.as_slice() {
        ["cd" | "ls" | "pwd" | "git" | "docker" | "systemctl"] => true,
        ["ls", "-l" | "-la"] => true,
        ["cd" | "ls", path] => !path.starts_with('-'),
        ["git", "status" | "diff"] | ["git", "log", "--oneline"] => true,
        ["docker", "ps"] | ["docker", "ps", "-a"] => true,
        ["systemctl", "status"] => true,
        ["systemctl", "status", unit] => !unit.starts_with('-'),
        _ => false,
    }
}
fn source_value(source: &str, prefix: &str, value: &str) -> bool {
    if !value.starts_with(prefix) || !literal(prefix) || !literal(value) {
        return false;
    }
    match source {
        "commands" => {
            if value.contains(' ') {
                return reviewed_line(value);
            }
            !value.is_empty()
                && !value.contains(' ')
                && !value.contains('/')
                && !value.starts_with('-')
        }
        "paths" => reviewed_line(value) && (value.starts_with("cd ") || value.starts_with("ls ")),
        "history" => reviewed_line(value),
        _ => safe_candidate(prefix, value),
    }
}

pub(crate) fn request_keys(source: &str) -> Result<&'static [u8], String> {
    match source {
        "reviewed" => Ok(REQUEST_KEYS),
        "commands" => Ok(b"\x18\x0b"),
        "paths" => Ok(b"\x18\x10"),
        "history" => Ok(b"\x18\x19"),
        _ => Err("Unsupported shell suggestion source".into()),
    }
}

impl ShellIntegration {
    pub(crate) fn new() -> Self {
        Self {
            mode: "bash",
            nonce: uuid::Uuid::new_v4().simple().to_string(),
            buffer: Vec::new(),
            ready: false,
            user: String::new(),
            host: String::new(),
            pending: None,
            prompt_seq: 0,
            request_seq: 0,
            snapshot: None,
        }
    }
    pub(crate) fn for_shell(mode: &str) -> Result<Self, String> {
        let mut integration = Self::new();
        integration.mode = match mode {
            "bash" => "bash",
            "zsh" => "zsh",
            "powershell" => "powershell",
            _ => {
                return Err("Supported shell integration modes are Bash, Zsh and PowerShell".into())
            }
        };
        Ok(integration)
    }
    pub(crate) fn shell_mode(&self) -> &str {
        self.mode
    }
    fn event(&self, id: &str, status: &str) -> ShellEvent {
        ShellEvent {
            id: id.into(),
            status: status.into(),
            shell: self.mode,
            user: self.user.clone(),
            host: self.host.clone(),
            prompt_ready: self.ready,
            request_id: None,
            prefix: None,
            cursor: None,
            suggestions: None,
        }
    }
    pub(crate) fn input_changed(&mut self, id: &str, data: &str) -> ShellEvent {
        self.pending = None;
        self.snapshot = None;
        // Empty-editor cancellation/copy may remain inside the same PSReadLine
        // invocation. Ctrl+C preserves only its EXISTING capability; it cannot
        // enable a busy/password context, and every old snapshot is gone above.
        if data.bytes().any(|b| matches!(b, b'\r' | b'\n'))
            || (self.mode != "powershell" && data.bytes().any(|b| b == 3))
        {
            self.ready = false;
        }
        // A shell's incremental-search editor is not a command insertion
        // context. Its normal Ctrl+R/Ctrl+S still pass through untouched; only a
        // fresh shell prompt can reissue the insertion capability. Printable
        // search queries must not trigger automatic snapshot chords in search.
        if data.bytes().any(|b| matches!(b, 18 | 19)) {
            self.ready = false;
        }
        self.event(id, if self.ready { "ready" } else { "unavailable" })
    }
    #[cfg(test)]
    pub(crate) fn request(&mut self, id: &str) -> Result<(String, ShellEvent), String> {
        self.request_with_source(id, "reviewed")
    }
    pub(crate) fn request_with_source(
        &mut self,
        id: &str,
        source: &str,
    ) -> Result<(String, ShellEvent), String> {
        request_keys(source)?;
        let source = match source {
            "commands" => "commands",
            "paths" => "paths",
            "history" => "history",
            _ => "reviewed",
        };
        self.snapshot = None;
        if !self.ready {
            return Err("Shell suggestions require a verified shell prompt".into());
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        self.request_seq = self
            .request_seq
            .checked_add(1)
            .ok_or("Shell request sequence exhausted")?;
        self.pending = Some(Pending {
            request_id: request_id.clone(),
            prompt_seq: self.prompt_seq,
            request_seq: self.request_seq,
            source,
        });
        Ok((request_id, self.event(id, "ready")))
    }
    pub(crate) fn timeout(&mut self, id: &str, request_id: &str) -> Option<ShellEvent> {
        if self
            .pending
            .as_ref()
            .map(|pending| pending.request_id.as_str())
            != Some(request_id)
        {
            return None;
        }
        self.pending = None;
        self.snapshot = None;
        self.ready = false;
        Some(self.event(id, "unavailable"))
    }
    pub(crate) fn dismiss(&mut self, id: &str) -> ShellEvent {
        self.pending = None;
        self.snapshot = None;
        self.event(id, if self.ready { "ready" } else { "unavailable" })
    }
    pub(crate) fn accept(
        &mut self,
        request_id: &str,
        value: &str,
        command: bool,
    ) -> Result<String, String> {
        if !self.ready {
            return Err("Shell prompt is no longer ready".into());
        }
        let snapshot = self
            .snapshot
            .as_ref()
            .filter(|s| {
                s.request_id == request_id
                    && s.created.elapsed() < std::time::Duration::from_secs(10)
            })
            .ok_or("Suggestions changed; request a fresh shell snapshot")?;
        if command {
            if snapshot.source != "reviewed"
                || !snapshot.prefix.is_empty()
                || value.is_empty()
                || value.len() > 16_384
                || value
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
            {
                return Err(
                    "Command insertion requires an empty, verified shell prompt and a single line"
                        .into(),
                );
            }
        } else if !snapshot.values.iter().any(|candidate| candidate == value) {
            return Err("Suggestion was not issued for this shell prompt".into());
        }
        let suffix = value
            .strip_prefix(&snapshot.prefix)
            .ok_or("Suggestion does not match the shell prefix")?
            .to_string();
        self.snapshot = None;
        self.pending = None;
        // Bracketed paste prevents shell metacharacters from becoming key bindings.
        Ok(format!("\x1b[200~{suffix}\x1b[201~"))
    }

    pub(crate) fn filter(&mut self, id: &str, bytes: &[u8]) -> (Vec<u8>, Vec<ShellEvent>) {
        self.buffer.extend_from_slice(bytes);
        let mut visible = Vec::new();
        let mut events = Vec::new();
        loop {
            let start = self
                .buffer
                .windows(MARKER.len())
                .position(|part| part == MARKER);
            let Some(start) = start else {
                let retain = (1..MARKER.len())
                    .rev()
                    .find(|&n| self.buffer.ends_with(&MARKER[..n]))
                    .unwrap_or(0);
                let end = self.buffer.len() - retain;
                visible.extend(self.buffer.drain(..end));
                break;
            };
            visible.extend(self.buffer.drain(..start));
            let end = self.buffer[MARKER.len()..]
                .iter()
                .position(|b| *b == 7)
                .map(|end| end + MARKER.len());
            let Some(end) = end else {
                if self.buffer.len() > 8192 {
                    self.buffer.clear();
                    self.ready = false;
                    self.snapshot = None;
                    self.pending = None;
                    events.push(self.event(id, "unavailable"));
                }
                break;
            };
            let payload = self.buffer[MARKER.len()..end].to_vec();
            self.buffer.drain(..=end);
            if let Ok(payload) = std::str::from_utf8(&payload) {
                if let Some(event) = self.parse(id, payload) {
                    events.push(event);
                }
            }
        }
        (visible, events)
    }
    fn parse(&mut self, id: &str, payload: &str) -> Option<ShellEvent> {
        let parts: Vec<_> = payload.split(';').collect();
        if parts.first().copied() != Some(self.nonce.as_str()) {
            return None;
        }
        match parts.get(1).copied()? {
            "ready" if parts.len() == 6 && safe_atom(parts[2]) && safe_atom(parts[3]) => {
                let prompt_seq = parts[4].parse::<u64>().ok()?;
                let request_seq = parts[5].parse::<u64>().ok()?;
                if prompt_seq <= self.prompt_seq {
                    return None;
                }
                self.user = parts[2].into();
                self.host = parts[3].into();
                self.ready = true;
                self.pending = None;
                self.snapshot = None;
                self.prompt_seq = prompt_seq;
                self.request_seq = request_seq;
                Some(self.event(id, "ready"))
            }
            "no-match" if parts.len() == 4 && self.ready => {
                let prompt_seq = parts[2].parse::<u64>().ok()?;
                let request_seq = parts[3].parse::<u64>().ok()?;
                if !self
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.prompt_seq == prompt_seq && p.request_seq == request_seq)
                {
                    return None;
                }
                self.pending = None;
                self.snapshot = None;
                Some(self.event(id, "unavailable"))
            }
            "busy" | "unavailable" => {
                if parts.len() == 4 {
                    let prompt_seq = parts[2].parse::<u64>().ok()?;
                    let request_seq = parts[3].parse::<u64>().ok()?;
                    if prompt_seq != self.prompt_seq {
                        return None;
                    }
                    if parts[1] == "unavailable"
                        && !self.pending.as_ref().is_some_and(|p| {
                            p.prompt_seq == prompt_seq && p.request_seq == request_seq
                        })
                    {
                        return None;
                    }
                } else if parts.len() != 2 {
                    return None;
                }
                self.ready = false;
                self.pending = None;
                self.snapshot = None;
                Some(self.event(id, "unavailable"))
            }
            "suggestions"
                if parts.len() == 9
                    && self.ready
                    && parts[2] == self.user
                    && parts[3] == self.host =>
            {
                let prompt_seq = parts[4].parse::<u64>().ok()?;
                let request_seq = parts[5].parse::<u64>().ok()?;
                if !self
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.prompt_seq == prompt_seq && p.request_seq == request_seq)
                {
                    return None;
                }
                let pending = self.pending.take()?;
                let request_id = pending.request_id;
                let prefix = parts[7];
                let cursor = parts[6].parse::<usize>().ok()?;
                if !(if pending.source == "reviewed" {
                    safe_prefix(prefix)
                } else {
                    literal(prefix)
                }) || cursor != prefix.len()
                {
                    self.snapshot = None;
                    self.ready = false;
                    return Some(self.event(id, "unavailable"));
                }
                let values: Vec<String> = parts[8]
                    .split('\t')
                    .filter(|v| !v.is_empty() && source_value(pending.source, prefix, v))
                    .take(12)
                    .map(str::to_string)
                    .collect();
                self.snapshot = Some(Snapshot {
                    created: std::time::Instant::now(),
                    request_id: request_id.clone(),
                    prefix: prefix.into(),
                    values: values.clone(),
                    source: pending.source,
                });
                let mut event = self.event(id, "suggestions");
                event.request_id = Some(request_id);
                event.prefix = Some(prefix.into());
                event.cursor = Some(cursor);
                event.suggestions = Some(values);
                Some(event)
            }
            _ => None,
        }
    }

    pub(crate) fn script(&self) -> String {
        // Bash builtin-only policy filtering occurs BEFORE emitting READLINE_LINE.
        // Existing shell history is never exported wholesale or modified here.
        let source = if self.mode == "powershell" {
            include_str!("ssh_shell_integration.powershell.ps1")
        } else if self.mode == "zsh" {
            include_str!("ssh_shell_integration.zsh")
        } else {
            include_str!("ssh_shell_integration.bash")
        };
        let source = source.replace("__BYCODA_NONCE__", &self.nonce);
        // Compact fixed product source only, preserving line boundaries and
        // here-strings. The user's semantic line is never rewritten here.
        source
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n")
    }
    pub(crate) fn remote_command(&self) -> String {
        self.remote_command_with_prologue(None)
    }
    /// Only the native validated literal-environment builder may supply this
    /// prologue. It joins the fixed integration script before its one encoding.
    pub(crate) fn remote_command_with_prologue(&self, prologue: Option<&str>) -> String {
        let script = match prologue {
            Some(prologue) if !prologue.is_empty() => format!("{prologue}\n{}", self.script()),
            _ => self.script(),
        };
        if self.mode == "powershell" {
            use base64::Engine as _;
            // UTF-8 payload keeps the complete command below cmd.exe's 8191-byte
            // limit. Only fixed syntax/base64 crosses the outer shell boundary;
            // no user text or credential is interpolated into bootstrap code.
            return format!(
                "pwsh -NoLogo -NoProfile -NoExit -Command \"[ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))).Invoke()\"",
                base64::engine::general_purpose::STANDARD.encode(script.as_bytes())
            );
        }
        if self.mode == "zsh" {
            // Only this uniquely-owned temporary rc is written. The outer shell
            // survives the interactive child so its EXIT trap always removes it.
            let outer = format!(
                "set -eu\nbycoda_tmp=$(mktemp -d \"${{TMPDIR:-/tmp}}/bycoda-zsh.XXXXXXXX\")\ncase $bycoda_tmp in \"${{TMPDIR:-/tmp}}\"/bycoda-zsh.*) ;; *) exit 1;; esac\nchmod 700 \"$bycoda_tmp\"\ntrap 'rm -f -- \"$bycoda_tmp/.zshrc\"; rmdir -- \"$bycoda_tmp\"' EXIT\ntrap 'exit 130' INT\ntrap 'exit 129' HUP\ntrap 'exit 143' TERM\nprintf '%s' {} >\"$bycoda_tmp/.zshrc\"\nchmod 600 \"$bycoda_tmp/.zshrc\"\nBYCODA_ZDOTDIR_SET=${{ZDOTDIR+x}} BYCODA_ZDOTDIR_ORIGINAL=${{ZDOTDIR-}} ZDOTDIR=\"$bycoda_tmp\" zsh -d -i",
                crate::remote_ssh::shell_quote(&script)
            );
            return format!("zsh -dfc {}", crate::remote_ssh::shell_quote(&outer));
        }
        let outer = format!(
            "exec bash --noprofile --rcfile /dev/fd/3 -i 3<<<{}",
            crate::remote_ssh::shell_quote(&script)
        );
        format!("bash -c {}", crate::remote_ssh::shell_quote(&outer))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reverse_search_revokes_automatic_request_capability_for_every_shell() {
        for mode in ["bash", "zsh", "powershell"] {
            let mut shell = ShellIntegration::for_shell(mode).unwrap();
            shell.filter("t", &message(&shell, "ready;alice;remote;1;0"));
            assert!(!shell.input_changed("t", "\x12").prompt_ready);
            shell.input_changed("t", "git st");
            assert!(shell.request_with_source("t", "commands").is_err());
            shell.filter("t", &message(&shell, "ready;alice;remote;2;0"));
            assert!(shell.request_with_source("t", "commands").is_ok());
        }
    }
    #[test]
    fn capability_sources_are_bounded_and_not_arbitrary_history_or_shell_programs() {
        assert!(source_value("commands", "dock", "docker"));
        assert!(source_value("commands", "docker p", "docker ps"));
        assert!(source_value("commands", "git st", "git status"));
        assert!(source_value("paths", "cd /var/l", "cd /var/log/"));
        assert!(source_value(
            "history",
            "systemctl st",
            "systemctl status nginx"
        ));
        assert!(source_value("history", "docker ", "docker ps"));
        for value in [
            "curl -H Authorization",
            "ls .env",
            "cd secret-token",
            "git diff --password secret",
            "ls $(whoami)",
            "ls /tmp/a;b",
            "ls /tmp/日本語",
            "docker run x",
            "systemctl restart nginx",
            "ls /tmp/a\nb",
        ] {
            assert!(!source_value("history", "", value), "{value}");
        }
        assert!(!source_value("reviewed", "dock", "docker"));
        assert!(request_keys("unknown").is_err());
    }
    #[test]
    fn source_bound_snapshot_inserts_only_and_cannot_be_used_for_snippets() {
        let mut shell = ShellIntegration::new();
        shell.filter("t", &message(&shell, "ready;alice;remote;1;0"));
        let (request, _) = shell.request_with_source("t", "paths").unwrap();
        let frame = message(
            &shell,
            "suggestions;alice;remote;1;1;9;cd /var/l;cd /var/log/\tdocker ps\tcd .env",
        );
        let (_, events) = shell.filter("t", &frame);
        assert_eq!(events[0].suggestions.as_ref().unwrap(), &["cd /var/log/"]);
        assert!(shell.accept(&request, "printf run", true).is_err());
        assert_eq!(
            shell.accept(&request, "cd /var/log/", false).unwrap(),
            "\x1b[200~og/\x1b[201~"
        );
    }
    #[test]
    fn powershell_mode_uses_transient_bounded_bootstrap_and_scoped_protocol() {
        let mut shell = ShellIntegration::for_shell("powershell").unwrap();
        assert_eq!(shell.shell_mode(), "powershell");
        assert!(shell
            .remote_command()
            .starts_with("pwsh -NoLogo -NoProfile -NoExit -Command "));
        assert!(shell.remote_command().len() < 8191);
        let ready = message(&shell, "ready;alice;remote;1;0");
        assert_eq!(shell.filter("t", &ready).1[0].shell, "powershell");
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;remote;1;1;6;git st;git status");
        shell.filter("t", &response);
        assert_eq!(
            shell.accept(&request, "git status", false).unwrap(),
            "\x1b[200~atus\x1b[201~"
        );
        assert!(!shell.script().contains("AcceptLine("));
        assert!(!shell.script().contains("Set-PSReadLineOption"));
        assert!(shell.script().contains("-ListImported"));
    }
    #[test]
    fn powershell_search_editor_revokes_insertion_until_new_prompt() {
        let mut shell = ShellIntegration::for_shell("powershell").unwrap();
        let ready = message(&shell, "ready;alice;remote;1;0");
        shell.filter("t", &ready);
        shell.input_changed("t", "\x12git");
        assert!(shell.request("t").is_err());
        shell.input_changed("t", "\x1b");
        assert!(shell.request("t").is_err());
        let ready = message(&shell, "ready;alice;remote;2;0");
        shell.filter("t", &ready);
        assert!(shell.request("t").is_ok());
    }
    #[test]
    fn powershell_empty_editor_cancel_keeps_capability_but_drops_snapshots() {
        let mut shell = ShellIntegration::for_shell("powershell").unwrap();
        let ready = message(&shell, "ready;alice;remote;1;0");
        shell.filter("t", &ready);
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;remote;1;1;6;git st;git status");
        shell.filter("t", &response);
        shell.input_changed("t", "\x03");
        assert!(shell.accept(&request, "git status", false).is_err());
        assert!(shell.request("t").is_ok());
        let busy = message(&shell, "busy;1;1");
        shell.filter("t", &busy);
        shell.input_changed("t", "\x03");
        assert!(shell.request("t").is_err());
    }
    #[test]
    fn zsh_reuses_scoped_protocol_and_temporary_bootstrap() {
        assert!(ShellIntegration::for_shell("fish").is_err());
        let mut shell = ShellIntegration::for_shell("zsh").unwrap();
        let ready = message(&shell, "ready;alice;remote;1;0");
        assert_eq!(shell.filter("t", &ready).1[0].shell, "zsh");
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;remote;1;1;6;git st;git status");
        shell.filter("t", &response);
        assert_eq!(
            shell.accept(&request, "git status", false).unwrap(),
            "\x1b[200~atus\x1b[201~"
        );
        let command = shell.remote_command();
        assert!(command.starts_with("zsh -dfc "));
        assert!(command.contains("mktemp -d"));
        assert!(command.contains("chmod 700"));
        assert!(!command.contains("rm -rf"));
        assert!(!shell.script().contains("fc -W"));
    }
    fn message(shell: &ShellIntegration, body: &str) -> Vec<u8> {
        format!("\x1b]777;bycoda;{};{body}\x07", shell.nonce).into_bytes()
    }
    #[test]
    fn nonce_scope_prompt_and_input_invalidation_gate_acceptance() {
        let mut shell = ShellIntegration::new();
        assert!(shell.request("t").is_err());
        let ready = message(&shell, "ready;alice;host-a;1;0");
        let (_, events) = shell.filter("t", &ready);
        assert_eq!(events[0].user, "alice");
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;host-a;1;1;6;git st;git status");
        let (visible, events) = shell.filter("t", &response);
        assert!(visible.is_empty());
        assert_eq!(events[0].prefix.as_deref(), Some("git st"));
        assert_eq!(
            shell.accept(&request, "git status", false).unwrap(),
            "\x1b[200~atus\x1b[201~"
        );
        assert!(shell.accept(&request, "git status", false).is_err());
        let (request, _) = shell.request("t").unwrap();
        shell.filter("t", &response);
        shell.input_changed("t", "x");
        assert!(shell.accept(&request, "git status", false).is_err());
        shell.input_changed("t", "\r");
        assert!(shell.request("t").is_err());
    }
    #[test]
    fn secret_prefixes_mismatched_scope_and_wrong_nonce_never_escape() {
        let mut shell = ShellIntegration::new();
        let ready = message(&shell, "ready;alice;host-a;1;0");
        shell.filter("t", &ready);
        shell.request("t").unwrap();
        let secret = message(
            &shell,
            "suggestions;alice;host-a;1;1;18;export TOKEN=value;export TOKEN=value",
        );
        let (_, events) = shell.filter("t", &secret);
        assert!(events.iter().all(|event| event.prefix.is_none()));
        let (_, events) = shell.filter("t", b"\x1b]777;bycoda;other;ready;bob;other\x07");
        assert!(events.is_empty());
        assert!(!safe_prefix("curl -H Authorization"));
        assert!(!safe_prefix("sudo password"));
        assert!(!safe_candidate("", "echo secret"));
    }
    #[test]
    fn split_osc_is_private_and_arbitrary_command_insert_requires_empty_snapshot() {
        let mut shell = ShellIntegration::new();
        let bytes = message(&shell, "ready;alice;host-a;1;0");
        let (a, _) = shell.filter("t", &bytes[..8]);
        assert!(a.is_empty());
        let (b, event) = shell.filter("t", &bytes[8..]);
        assert!(b.is_empty());
        assert_eq!(event[0].status, "ready");
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;host-a;1;1;0;;ls\tpwd");
        shell.filter("t", &response);
        assert!(shell.accept(&request, "echo x\n", true).is_err());
        assert_eq!(
            shell
                .accept(&request, "printf 'owner reviewed'", true)
                .unwrap(),
            "\x1b[200~printf 'owner reviewed'\x1b[201~"
        );
    }

    #[test]
    fn stale_busy_echooff_and_sensitive_prefixes_fail_closed() {
        let mut shell = ShellIntegration::new();
        let ready = message(&shell, "ready;alice;host-a;1;0");
        shell.filter("t", &ready);
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;host-a;1;1;6;git st;git status");
        shell.filter("t", &response);
        shell.snapshot.as_mut().unwrap().created =
            std::time::Instant::now() - std::time::Duration::from_secs(11);
        assert!(shell.accept(&request, "git status", false).is_err());
        shell.request("t").unwrap();
        shell.filter("t", &response);
        let busy = message(&shell, "busy");
        shell.filter("t", &busy);
        assert!(shell.request("t").is_err());
        assert!(shell.accept(&request, "git status", false).is_err());
        for prefix in [
            "hunter2",
            "export TOKEN=abc",
            "git diff --password secret",
            "ls --password SECRET",
            "cd secret-token",
        ] {
            assert!(!safe_prefix(prefix));
        }
    }

    #[test]
    fn delayed_response_cannot_be_relabelled_as_a_new_request() {
        let mut shell = ShellIntegration::new();
        let ready = message(&shell, "ready;alice;host-a;1;0");
        shell.filter("t", &ready);
        let (request_a, _) = shell.request("t").unwrap();
        shell.input_changed("t", "x");
        let (request_b, _) = shell.request("t").unwrap();
        let response_a = message(&shell, "suggestions;alice;host-a;1;1;6;git st;git status");
        let (_, events) = shell.filter("t", &response_a);
        assert!(events.is_empty());
        assert!(shell.snapshot.is_none());
        assert!(shell.accept(&request_b, "git status", false).is_err());
        let response_b = message(
            &shell,
            "suggestions;alice;host-a;1;2;4;git ;git status\tgit diff",
        );
        let (_, events) = shell.filter("t", &response_b);
        assert_eq!(events[0].request_id.as_deref(), Some(request_b.as_str()));
        assert!(shell.accept(&request_a, "git status", false).is_err());
        assert_eq!(
            shell.accept(&request_b, "git status", false).unwrap(),
            "\x1b[200~status\x1b[201~"
        );
        let fresh = message(&shell, "ready;alice;host-a;2;2");
        shell.filter("t", &fresh);
        let (request_c, _) = shell.request("t").unwrap();
        shell.filter("t", &ready);
        assert_eq!(
            shell.pending.as_ref().unwrap().request_id,
            request_c,
            "duplicate/old ready cannot reset a newer pending request"
        );
    }

    #[test]
    fn policy_no_match_allows_edit_retry_without_executing_or_losing_draft() {
        let mut shell = ShellIntegration::new();
        let ready = message(&shell, "ready;alice;host-a;1;0");
        shell.filter("t", &ready);
        shell.input_changed("t", "docker");
        shell.request("t").unwrap();
        let no_match = message(&shell, "no-match;1;1");
        let (_, events) = shell.filter("t", &no_match);
        assert_eq!(events[0].status, "unavailable");
        assert!(events[0].prompt_ready);
        assert!(shell.ready);
        assert!(shell.snapshot.is_none());
        shell.input_changed("t", "\x15git st");
        let (request, _) = shell.request("t").unwrap();
        let response = message(&shell, "suggestions;alice;host-a;1;2;6;git st;git status");
        shell.filter("t", &response);
        assert_eq!(
            shell.accept(&request, "git status", false).unwrap(),
            "\x1b[200~atus\x1b[201~"
        );
        let (_, events) = shell.filter("t", &message(&shell, "busy;1;2"));
        assert!(!events[0].prompt_ready);
    }
}
