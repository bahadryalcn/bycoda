use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use tauri::AppHandle;

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
                let mut packets = vec![first];
                // Batch busy output while keeping memory and RPC frequency bounded.
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(100);
                while packets.len() < 8 {
                    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                    match receiver.recv_timeout(remaining) {
                        Ok(packet) => packets.push(packet),
                        Err(_) => break,
                    }
                }
                let mut bytes = Vec::new();
                let mut interrupted = false;
                for (sequence, chunk) in packets {
                    if sequence != expected_chunk {
                        if !bytes.is_empty() {
                            send(&bytes, interrupted, false);
                            bytes.clear();
                        }
                        interrupted = true;
                    }
                    expected_chunk = sequence + 1;
                    bytes.extend_from_slice(&chunk);
                }
                send(&bytes, interrupted, false);
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
