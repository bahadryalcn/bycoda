//! Bounded, redacted start diagnostics for the owned OpenCode process. The
//! spawn error kind and the last bytes of stderr explain a failed start, but
//! stderr can echo the generated password, tokens or the user's home path, so
//! nothing leaves this module unredacted or unbounded.
use regex::Regex;
use std::io::{self, Read};
use std::process::ExitStatus;
use std::sync::{mpsc, Condvar, Mutex, OnceLock};
use std::time::Duration;

/// Most redacted stderr text attached to one start error.
const TAIL_BYTES: usize = 4096;
/// Raw bytes retained while reading; larger than `TAIL_BYTES` so redaction sees
/// whole secrets before the result is cut down.
const RAW_WINDOW_BYTES: usize = 16 * 1024;
/// Grace for the stderr reader to reach EOF after the child has exited.
const EXIT_DRAIN: Duration = Duration::from_millis(250);
const DETAIL_BYTES: usize = 320;
const REDACTED: &str = "[redacted]";

pub(super) enum StartEvent {
    Endpoint(String),
    Exited(String),
}

#[derive(Default)]
struct TailState {
    raw: Vec<u8>,
    truncated: bool,
    closed: bool,
}
/// Last bytes of the child's stderr. The reader thread never blocks on a full
/// buffer: old bytes are dropped instead.
#[derive(Default)]
pub(super) struct StderrTail {
    state: Mutex<TailState>,
    closed: Condvar,
}
impl StderrTail {
    /// Read until EOF or error, keeping only the newest `RAW_WINDOW_BYTES`.
    pub(super) fn collect<R: Read>(&self, mut reader: R) {
        let mut chunk = [0u8; 4096];
        loop {
            let read = match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            };
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.raw.extend_from_slice(&chunk[..read]);
            if state.raw.len() > RAW_WINDOW_BYTES {
                let excess = state.raw.len() - RAW_WINDOW_BYTES;
                state.raw.drain(..excess);
                state.truncated = true;
            }
        }
        self.state.lock().unwrap_or_else(|e| e.into_inner()).closed = true;
        self.closed.notify_all();
    }

    /// Redacted, single-line, at most `TAIL_BYTES` of the newest stderr. With
    /// `settle`, first waits that long for the reader to reach EOF.
    pub(super) fn snapshot(&self, secrets: &[&str], settle: Option<Duration>) -> String {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let state = match settle {
            Some(settle) => {
                self.closed
                    .wait_timeout_while(state, settle, |state| !state.closed)
                    .unwrap_or_else(|e| e.into_inner())
                    .0
            }
            None => state,
        };
        let mut text = String::from_utf8_lossy(&state.raw).into_owned();
        if state.truncated {
            // The window starts mid-line: that fragment could hold the tail of
            // a secret that redaction can no longer recognise.
            text = text
                .split_once('\n')
                .map_or_else(String::new, |(_, rest)| rest.to_owned());
        }
        drop(state);
        let redacted = redact(&text, secrets, home_directory().as_deref());
        newest_lines(&redacted, TAIL_BYTES)
    }
}

fn home_directory() -> Option<String> {
    let home = crate::fs::expand_home("~").to_string_lossy().into_owned();
    (home != "~" && home.len() > 1).then_some(home)
}

fn patterns() -> &'static [(Regex, &'static str)] {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            (r"://[^/\s:@]+:[^/\s@]+@", "://[redacted]@"),
            (
                r"(?i)(authorization\s*[:=]\s*)(?:(?:basic|bearer)\s+)?\S+",
                "${1}[redacted]",
            ),
            (r"(?i)\b(basic|bearer)\s+[A-Za-z0-9._~+/=-]{8,}", "${1} [redacted]"),
            (
                r#"(?i)\b([a-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|credential)[a-z0-9_.-]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)"#,
                "${1}${2}[redacted]",
            ),
        ]
        .into_iter()
        .filter_map(|(pattern, replacement)| Some((Regex::new(pattern).ok()?, replacement)))
        .collect()
    })
}

/// Remove exact secrets, the home directory and credential-shaped text.
pub(super) fn redact(text: &str, secrets: &[&str], home: Option<&str>) -> String {
    let mut out = text.to_owned();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        out = out.replace(secret, REDACTED);
    }
    if let Some(home) = home {
        let variants = [
            home.to_owned(),
            home.replace('\\', "/"),
            home.replace('/', "\\"),
        ];
        for variant in &variants {
            if let Ok(pattern) = Regex::new(&format!("(?i){}", regex::escape(variant))) {
                out = pattern.replace_all(&out, "~").into_owned();
            }
        }
    }
    for (pattern, replacement) in patterns() {
        out = pattern.replace_all(&out, *replacement).into_owned();
    }
    out
}

/// Printable lines joined with " | ", keeping the newest whole-char tail.
fn newest_lines(text: &str, limit: usize) -> String {
    let joined = text
        .lines()
        .map(|line| {
            line.chars()
                .filter(|c| !c.is_control() || *c == '\t')
                .collect::<String>()
        })
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    if joined.len() <= limit {
        return joined;
    }
    let mut start = joined.len() - limit;
    while !joined.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &joined[start..])
}

/// Spawn failure reason: error kind plus the OS/job code, never a path.
pub(super) fn spawn_failure_detail(error: &io::Error) -> String {
    let detail = format!("{:?} ({error})", error.kind());
    let redacted = redact(&detail, &[], home_directory().as_deref());
    match redacted.char_indices().nth(DETAIL_BYTES) {
        Some((end, _)) => format!("{}…", &redacted[..end]),
        None => redacted,
    }
}

pub(super) fn describe_exit(status: &io::Result<ExitStatus>) -> String {
    match status {
        Ok(status) => match status.code() {
            Some(code) => format!("exited with code {code}"),
            None => "was terminated by a signal".into(),
        },
        Err(error) => format!("exit status unavailable ({:?})", error.kind()),
    }
}

/// Wait for the endpoint, an early exit or the deadline. The error is
/// `OWNED_OPENCODE_START_UNCONFIRMED` plus a bounded redacted reason and
/// stderr tail; the code stays the prefix for callers that match on it.
pub(super) fn await_start(
    events: &mpsc::Receiver<StartEvent>,
    timeout: Duration,
    tail: &StderrTail,
    secrets: &[&str],
) -> Result<String, String> {
    let (reason, settle) = match events.recv_timeout(timeout) {
        Ok(StartEvent::Endpoint(endpoint)) => return Ok(endpoint),
        Ok(StartEvent::Exited(status)) => (
            format!("process {status} before reporting an endpoint"),
            Some(EXIT_DRAIN),
        ),
        Err(mpsc::RecvTimeoutError::Timeout) => (
            format!("no endpoint reported within {} ms", timeout.as_millis()),
            None,
        ),
        Err(mpsc::RecvTimeoutError::Disconnected) => ("start observers closed".into(), None),
    };
    let stderr = tail.snapshot(secrets, settle);
    let mut message = format!("OWNED_OPENCODE_START_UNCONFIRMED: {reason}");
    if stderr.is_empty() {
        message.push_str("; stderr empty");
    } else {
        message.push_str("; stderr: ");
        message.push_str(&stderr);
    }
    Err(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::Arc;
    use std::time::Instant;

    const PASSWORD: &str = "0123456789abcdef0123456789abcdef";

    fn tail_with(bytes: &[u8]) -> Arc<StderrTail> {
        let tail = Arc::new(StderrTail::default());
        tail.collect(Cursor::new(bytes.to_vec()));
        tail
    }

    #[test]
    fn redacts_password_home_and_credential_shapes() {
        let text = format!(
            "bind {PASSWORD} at C:\\Users\\someone\\proj and /home/someone/x\n\
             Authorization: Basic b3BlbmNvZGU6c2VjcmV0\n\
             OPENCODE_API_KEY=sk-live-123 token: abcdef\n\
             fetch http://user:hunter2@host/x"
        );
        let out = redact(&text, &[PASSWORD], Some("C:\\Users\\someone"));
        for leaked in [
            PASSWORD,
            "someone\\proj",
            "b3BlbmNvZGU6",
            "sk-live-123",
            "abcdef",
            "hunter2",
        ] {
            assert!(!out.contains(leaked), "leaked {leaked}: {out}");
        }
        assert!(out.contains("~\\proj"), "{out}");
    }

    #[test]
    fn stderr_tail_is_bounded_and_drops_the_cut_leading_line() {
        let mut flood = format!("first {PASSWORD}\n").into_bytes();
        for _ in 0..20_000 {
            flood.extend_from_slice(b"noise noise noise noise\n");
        }
        flood.extend_from_slice(b"EADDRINUSE: address already in use\n");
        let tail = tail_with(&flood);
        let snapshot = tail.snapshot(&[PASSWORD], None);
        assert!(snapshot.len() <= TAIL_BYTES + 8, "{}", snapshot.len());
        assert!(snapshot.ends_with("EADDRINUSE: address already in use"));
        assert!(!snapshot.contains(PASSWORD));
        assert!(tail.state.lock().unwrap().raw.len() <= RAW_WINDOW_BYTES);
    }

    #[test]
    fn password_split_across_reads_is_still_redacted() {
        struct Chunked(Vec<Vec<u8>>);
        impl Read for Chunked {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if self.0.is_empty() {
                    return Ok(0);
                }
                let next = self.0.remove(0);
                buf[..next.len()].copy_from_slice(&next);
                Ok(next.len())
            }
        }
        let tail = Arc::new(StderrTail::default());
        tail.collect(Chunked(vec![
            format!("secret is {}", &PASSWORD[..10]).into_bytes(),
            format!("{}\n", &PASSWORD[10..]).into_bytes(),
        ]));
        assert!(!tail.snapshot(&[PASSWORD], None).contains(&PASSWORD[..10]));
    }

    #[test]
    fn early_exit_fails_fast_with_stderr_and_keeps_the_code_prefix() {
        let (send, receive) = mpsc::sync_channel(2);
        send.send(StartEvent::Exited("exited with code 1".into()))
            .unwrap();
        let tail = tail_with(b"error: failed to bind 127.0.0.1\n");
        let started = Instant::now();
        let error = await_start(&receive, Duration::from_secs(30), &tail, &[PASSWORD]).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(error.starts_with("OWNED_OPENCODE_START_UNCONFIRMED: "));
        assert!(error.contains("exited with code 1"));
        assert!(error.contains("failed to bind"));
    }

    #[test]
    fn silent_start_times_out_with_a_reason_and_without_leaking_secrets() {
        let (_send, receive) = mpsc::sync_channel::<StartEvent>(2);
        let tail = tail_with(format!("password={PASSWORD}\n").as_bytes());
        let error =
            await_start(&receive, Duration::from_millis(20), &tail, &[PASSWORD]).unwrap_err();
        assert!(error.starts_with("OWNED_OPENCODE_START_UNCONFIRMED: no endpoint"));
        assert!(!error.contains(PASSWORD));
    }

    #[test]
    fn reported_endpoint_wins() {
        let (send, receive) = mpsc::sync_channel(2);
        send.send(StartEvent::Endpoint("http://127.0.0.1:4000".into()))
            .unwrap();
        let endpoint = await_start(
            &receive,
            Duration::from_secs(1),
            &StderrTail::default(),
            &[],
        )
        .unwrap();
        assert_eq!(endpoint, "http://127.0.0.1:4000");
    }

    #[test]
    fn spawn_failure_names_the_kind_without_a_path() {
        let detail = spawn_failure_detail(&io::Error::from(io::ErrorKind::NotFound));
        assert!(detail.starts_with("NotFound"));
        assert!(detail.len() <= DETAIL_BYTES + 4);
    }
}
