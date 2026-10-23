use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
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
    sequence: AtomicU64,
}

impl TerminalLogSender {
    pub(crate) fn new(app: &AppHandle, cwd: &Path) -> Self {
        let (sender, receiver) = sync_channel::<(u64, Vec<u8>)>(32);
        let app = app.clone();
        let cwd = cwd.to_string_lossy().into_owned();
        let terminal_id = uuid::Uuid::new_v4().to_string();
        std::thread::spawn(move || {
            let mut packet_sequence = 0_u64;
            let mut expected_chunk = 0_u64;
            let mut alt_screen = AltScreenFilter::default();
            let mut send = |bytes: &[u8], interrupted: bool, closed: bool| {
                let data =
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
                let result = crate::remote::local_runtime_logs_rpc(
                    &app,
                    "runtimeLogs.terminals.append",
                    serde_json::json!({ "cwd": cwd, "terminalId": terminal_id, "sequence": packet_sequence, "data": data, "interrupted": interrupted, "closed": closed }),
                );
                packet_sequence += 1;
                let _ = result;
            };
            while let Ok(first) = receiver.recv() {
                let mut size = first.1.len();
                let mut packets = vec![first];
                // Batch busy output while keeping memory and RPC frequency bounded.
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
                    // A gap or skipped screen output lets the host discard partial lines.
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
            // Even an empty stream closes cleanly; the host ignores unknown closures.
            send(&[], false, true);
        });
        Self {
            sender,
            sequence: AtomicU64::new(0),
        }
    }

    pub(crate) fn push(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        // A gap lets the host discard partial lines instead of joining fragments.
        let _ = self.sender.try_send((sequence, bytes.to_vec()));
    }
}

#[cfg(test)]
mod tests {
    use super::AltScreenFilter;

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
