use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Runtime logs are for reading later: batch a second of output per RPC.
const LOG_FLUSH: Duration = Duration::from_secs(1);
const LOG_BATCH_BYTES: usize = 256 * 1024;
/// Switches into and out of the alternate screen (vim, less, htop, TUIs).
const ALT_SCREEN: [(&[u8], bool); 6] = [
    (b"[?1049h", true),
    (b"[?1049l", false),
    (b"[?1047h", true),
    (b"[?1047l", false),
    (b"[?47h", true),
    (b"[?47l", false),
];

/// Drops full-screen program output: its repaints are not log lines, and on a
/// busy TUI they were most of the bytes sent to the host.
#[derive(Default)]
struct AltScreenFilter {
    inside: bool,
    /// A switch sequence split across chunks waits here for its end.
    pending: Vec<u8>,
}

impl AltScreenFilter {
    /// The bytes outside the alternate screen, and whether any were dropped.
    fn filter(&mut self, bytes: &[u8]) -> (Vec<u8>, bool) {
        if self.pending.is_empty() && !bytes.contains(&0x1b) {
            return if self.inside {
                (Vec::new(), !bytes.is_empty())
            } else {
                (bytes.to_vec(), false)
            };
        }
        let mut data = std::mem::take(&mut self.pending);
        data.extend_from_slice(bytes);
        let mut kept = Vec::with_capacity(data.len());
        let mut dropped = false;
        let mut index = 0;
        while index < data.len() {
            if data[index] == 0x1b {
                let rest = &data[index..];
                if let Some((sequence, enter)) = ALT_SCREEN
                    .iter()
                    .find(|(sequence, _)| rest.starts_with(sequence))
                {
                    self.inside = *enter;
                    dropped = true;
                    index += sequence.len();
                    continue;
                }
                if ALT_SCREEN
                    .iter()
                    .any(|(sequence, _)| rest.len() < sequence.len() && sequence.starts_with(rest))
                {
                    self.pending = rest.to_vec();
                    break;
                }
            }
            if self.inside {
                dropped = true;
            } else {
                kept.push(data[index]);
            }
            index += 1;
        }
        (kept, dropped)
    }
}

/// Logging never blocks the PTY reader, renderer or keyboard input.
pub(crate) struct TerminalLogSender {
    sender: SyncSender<(u64, Vec<u8>)>,
    sequence: Arc<AtomicU64>,
    capture: Arc<AtomicBool>,
}

trait LogService {
    fn is_current(&self) -> bool;
    fn append(&self, params: serde_json::Value) -> Result<(), String>;
    fn demand(&self, _cwd: &str, _terminal_id: &str) -> Result<bool, String> {
        Ok(true)
    }
}
impl LogService for Arc<crate::remote::NativeServiceChannel> {
    fn is_current(&self) -> bool {
        self.as_ref().is_current()
    }
    fn append(&self, params: serde_json::Value) -> Result<(), String> {
        self.project("runtimeLogs.terminals.append", params, |_| Ok(()))
    }
    fn demand(&self, cwd: &str, terminal_id: &str) -> Result<bool, String> {
        self.project_until(
            "runtimeLogs.terminals.demand",
            serde_json::json!({ "cwd": cwd, "terminalId": terminal_id }),
            Instant::now() + Duration::from_secs(5),
            |value| {
                value
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| "Invalid terminal log demand".to_string())
            },
        )
        .or_else(|error| {
            // Older Hosts expose only the documented always-on capture mode.
            if error.contains("Unsupported host method") {
                Ok(true)
            } else {
                Err(error)
            }
        })
    }
}

/// No issuer exists until selection succeeds. A Host starting late can recover
/// logging, but once selected even an uncertain append cannot reselect it.
struct PinnedLogService<S, F> {
    selected: OnceLock<S>,
    select: F,
}
impl<S: LogService, F: Fn() -> Result<S, String>> LogService for PinnedLogService<S, F> {
    fn is_current(&self) -> bool {
        self.selected.get().is_none_or(LogService::is_current)
    }
    fn append(&self, params: serde_json::Value) -> Result<(), String> {
        if self.selected.get().is_none() {
            let selected = (self.select)()?;
            let _ = self.selected.set(selected);
        }
        self.selected
            .get()
            .ok_or("Terminal log issuer is unavailable")?
            .append(params)
    }
    fn demand(&self, cwd: &str, terminal_id: &str) -> Result<bool, String> {
        if self.selected.get().is_none() {
            let selected = (self.select)()?;
            let _ = self.selected.set(selected);
        }
        self.selected
            .get()
            .ok_or("Terminal log issuer is unavailable")?
            .demand(cwd, terminal_id)
    }
}

fn forward_logs(
    service: &impl LogService,
    receiver: Receiver<(u64, Vec<u8>)>,
    cwd: &str,
    terminal_id: &str,
    capture: Option<&AtomicBool>,
    observed_chunks: Option<&AtomicU64>,
) {
    struct ClearCapture<'a>(Option<&'a AtomicBool>);
    impl Drop for ClearCapture<'_> {
        fn drop(&mut self) {
            if let Some(value) = self.0 {
                value.store(false, Ordering::Release);
            }
        }
    }
    let _clear_capture = ClearCapture(capture);
    let mut packet_sequence = 0_u64;
    let mut expected_chunk = 0_u64;
    let mut alt_screen = AltScreenFilter::default();
    let mut send = |bytes: &[u8], interrupted: bool, closed: bool| {
        let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
        let result = service.append(serde_json::json!({ "cwd": cwd, "terminalId": terminal_id,
            "sequence": packet_sequence, "data": data, "interrupted": interrupted, "closed": closed }));
        packet_sequence += 1;
        let _ = result;
    };
    loop {
        let first = match receiver.recv_timeout(Duration::from_secs(1)) {
            Ok(first) => first,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if !service.is_current() {
            return;
        }
        if capture.is_some_and(|value| !value.load(Ordering::Acquire)) {
            continue;
        }
        let mut size = first.1.len();
        let mut packets = vec![first];
        let deadline = Instant::now() + LOG_FLUSH;
        while size < LOG_BATCH_BYTES {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(remaining) {
                Ok(packet) => {
                    size += packet.1.len();
                    packets.push(packet);
                }
                Err(_) => break,
            }
        }
        let mut bytes = Vec::new();
        let mut interrupted = false;
        for (sequence, chunk) in packets {
            let (kept, dropped) = alt_screen.filter(&chunk);
            if sequence != expected_chunk || dropped {
                if !bytes.is_empty() {
                    send(&bytes, interrupted, false);
                    bytes.clear();
                }
                interrupted = true;
            }
            expected_chunk = sequence + 1;
            bytes.extend_from_slice(&kept);
        }
        if !bytes.is_empty() {
            send(&bytes, interrupted, false);
        }
    }
    // The close uses this same pinned service; an unknown append is not replayed.
    let interrupted =
        observed_chunks.is_some_and(|count| count.load(Ordering::Acquire) != expected_chunk);
    send(&[], interrupted, true);
}

/// Capture demand is asked on a backoff: a quick first answer, then at most
/// every ten seconds while it stays steady.
const DEMAND_RETRY: Duration = Duration::from_secs(2);
const DEMAND_MAX: Duration = Duration::from_secs(10);

/// Sleeps `span` in one-second steps; false once the terminal's sender is gone.
fn sleep_while_alive(capture: &std::sync::Weak<AtomicBool>, span: Duration) -> bool {
    let end = Instant::now() + span;
    loop {
        if capture.strong_count() == 0 {
            return false;
        }
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return true;
        }
        std::thread::sleep(left.min(Duration::from_secs(1)));
    }
}

/// Runs off the forwarding path, so a slow Host answer never stalls output.
/// An error keeps the previous answer and retries sooner.
fn poll_demand(
    service: &impl LogService,
    capture: std::sync::Weak<AtomicBool>,
    cwd: &str,
    terminal_id: &str,
) {
    let mut interval = Duration::ZERO;
    loop {
        if !sleep_while_alive(&capture, interval) {
            return;
        }
        let Some(value) = capture.upgrade() else {
            return;
        };
        match service.demand(cwd, terminal_id) {
            Ok(enabled) => {
                value.store(enabled, Ordering::Release);
                interval = (interval * 2).clamp(DEMAND_RETRY, DEMAND_MAX);
            }
            Err(_) => interval = DEMAND_RETRY,
        }
    }
}

impl TerminalLogSender {
    pub(crate) fn new(app: &AppHandle, cwd: &Path) -> Self {
        let (sender, receiver) = sync_channel::<(u64, Vec<u8>)>(32);
        let app = app.clone();
        let capture = Arc::new(AtomicBool::new(false));
        let worker_capture = capture.clone();
        let sequence = Arc::new(AtomicU64::new(0));
        let worker_sequence = sequence.clone();
        let cwd = cwd.to_string_lossy().into_owned();
        let terminal_id = uuid::Uuid::new_v4().to_string();
        let poll_app = app.clone();
        let poll_cwd = cwd.clone();
        let poll_terminal_id = terminal_id.clone();
        let poll_capture = Arc::downgrade(&capture);
        std::thread::spawn(move || {
            let service = PinnedLogService {
                selected: OnceLock::new(),
                select: || crate::remote::NativeServiceChannel::connect(&poll_app),
            };
            poll_demand(&service, poll_capture, &poll_cwd, &poll_terminal_id);
        });
        std::thread::spawn(move || {
            // Selection stays off the PTY reader and may recover from Host
            // startup. Once selected, later pairing never receives this stream's
            // packets or final close under the old identity.
            let service = PinnedLogService {
                selected: OnceLock::new(),
                select: || crate::remote::NativeServiceChannel::connect(&app),
            };
            forward_logs(
                &service,
                receiver,
                &cwd,
                &terminal_id,
                Some(&worker_capture),
                Some(&worker_sequence),
            );
        });
        Self {
            sender,
            sequence,
            capture,
        }
    }

    pub(crate) fn push(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        let sequence = self.sequence.fetch_add(1, Ordering::AcqRel);
        if !self.capture.load(Ordering::Acquire) {
            return;
        }
        // A gap lets the host discard partial lines instead of joining fragments.
        let _ = self.sender.try_send((sequence, bytes.to_vec()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Logs {
        current: std::cell::Cell<bool>,
        packets: std::cell::RefCell<Vec<serde_json::Value>>,
        retire: bool,
    }
    impl LogService for Logs {
        fn is_current(&self) -> bool {
            self.current.get()
        }
        fn append(&self, params: serde_json::Value) -> Result<(), String> {
            if !self.current.get() {
                return Err("retired".into());
            }
            self.packets.borrow_mut().push(params);
            if self.retire {
                self.current.set(false);
            }
            Err("delivery may be unknown".into())
        }
    }

    #[test]
    fn capture_gate_skips_chunks_without_allocating_and_preserves_gap_sequence() {
        let (sender, receiver) = sync_channel(4);
        let capture = Arc::new(AtomicBool::new(false));
        let logs = TerminalLogSender {
            sender,
            sequence: Arc::new(AtomicU64::new(0)),
            capture: capture.clone(),
        };
        logs.push(b"missed\n");
        assert!(receiver.try_recv().is_err());
        capture.store(true, Ordering::Release);
        logs.push(b"visible\n");
        let (sequence, bytes) = receiver.try_recv().unwrap();
        assert_eq!(sequence, 1);
        assert_eq!(bytes, b"visible\n");
    }

    #[test]
    fn alternate_filter_fast_path_keeps_normal_chunks_and_discards_fullscreen() {
        let mut filter = AltScreenFilter::default();
        assert_eq!(filter.filter(b"a\r\nb\n"), (b"a\r\nb\n".to_vec(), false));
        filter.inside = true;
        assert_eq!(filter.filter(b"screen"), (Vec::new(), true));
    }

    #[test]
    fn late_host_selection_recovers_logging_without_retargeting_an_admitted_stream() {
        let attempts = std::cell::Cell::new(0);
        let service = PinnedLogService {
            selected: OnceLock::new(),
            select: || {
                attempts.set(attempts.get() + 1);
                if attempts.get() == 1 {
                    return Err("Host is still starting".into());
                }
                Ok(Logs {
                    current: std::cell::Cell::new(true),
                    packets: Default::default(),
                    retire: false,
                })
            },
        };
        assert!(service.append(serde_json::json!({"sequence":0})).is_err());
        assert!(
            service.is_current(),
            "no issuer was admitted; later output may select one"
        );
        assert!(service.append(serde_json::json!({"sequence":1})).is_err());
        assert!(service.append(serde_json::json!({"sequence":2})).is_err());
        assert_eq!(
            attempts.get(),
            2,
            "unknown appends keep the original selected issuer"
        );
        let selected = service.selected.get().unwrap();
        assert_eq!(
            *selected.packets.borrow(),
            vec![
                serde_json::json!({"sequence":1}),
                serde_json::json!({"sequence":2})
            ]
        );
        selected.current.set(false);
        assert!(!service.is_current());
        assert!(service.append(serde_json::json!({"sequence":3})).is_err());
        assert_eq!(
            attempts.get(),
            2,
            "retirement must not choose a replacement Host"
        );
    }

    #[test]
    fn terminal_stream_keeps_original_sequence_without_replaying_unknown_append() {
        let logs = Logs {
            current: std::cell::Cell::new(true),
            packets: Default::default(),
            retire: false,
        };
        let (sender, receiver) = sync_channel(32);
        sender.send((0, b"first".to_vec())).unwrap();
        sender.send((1, b"second".to_vec())).unwrap();
        drop(sender);
        forward_logs(&logs, receiver, "/fixture", "original-terminal", None, None);
        let packets = logs.packets.borrow();
        assert_eq!(packets.len(), 2);
        assert_eq!(packets[0]["sequence"], 0);
        assert_eq!(packets[1]["sequence"], 1);
        assert_eq!(packets[0]["terminalId"], "original-terminal");
        assert_eq!(packets[1]["terminalId"], "original-terminal");
        assert_eq!(packets[1]["closed"], true);
        assert_eq!(
            base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                packets[0]["data"].as_str().unwrap()
            )
            .unwrap(),
            b"firstsecond"
        );
    }

    #[test]
    fn retired_terminal_stream_stops_before_forwarding_remaining_packets() {
        let logs = Logs {
            current: std::cell::Cell::new(true),
            packets: Default::default(),
            retire: true,
        };
        let (sender, receiver) = sync_channel(32);
        sender.send((0, vec![b'x'; LOG_BATCH_BYTES])).unwrap();
        sender.send((1, b"remaining".to_vec())).unwrap();
        drop(sender);
        forward_logs(&logs, receiver, "/fixture", "original-terminal", None, None);
        let packets = logs.packets.borrow();
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0]["sequence"], 0);
        assert_eq!(packets[0]["closed"], false);
    }

    #[test]
    fn alternate_screen_output_is_left_out() {
        let mut filter = AltScreenFilter::default();
        let (kept, dropped) = filter.filter(
            b"$ vim
[?1049hscreen[?1049l$ ",
        );
        assert_eq!(
            kept,
            b"$ vim
$ "
        );
        assert!(dropped);
        assert_eq!(
            filter.filter(
                b"ls
"
            ),
            (
                b"ls
"
                .to_vec(),
                false
            )
        );
    }

    #[test]
    fn a_switch_split_across_chunks_is_recognised() {
        let mut filter = AltScreenFilter::default();
        assert_eq!(filter.filter(b"before[?10"), (b"before".to_vec(), false));
        let (kept, dropped) = filter.filter(b"49hinside");
        assert!(kept.is_empty());
        assert!(dropped);
        let (kept, _) = filter.filter(b"[?1049lafter");
        assert_eq!(kept, b"after");
    }

    #[test]
    fn other_escape_sequences_pass_through() {
        let mut filter = AltScreenFilter::default();
        let colored = b"[31mred[0m
";
        assert_eq!(filter.filter(colored), (colored.to_vec(), false));
    }
}
