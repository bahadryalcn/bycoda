//! Bounded accept loop for the loopback control server.
//!
//! Every connection either reaches a worker or gets an explicit, retryable
//! `busy` reply; accept errors back off instead of spinning.
use serde_json::{json, Value};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::time::Duration;

/// Connections waiting for a worker before new ones are told to retry.
pub(super) const QUEUE_CAPACITY: usize = 32;
/// Error text clients see when the server is at capacity.
pub(super) const BUSY_ERROR: &str = "busy";
/// A busy reply is one short line into a fresh socket; never let it stall accepting.
const BUSY_WRITE_TIMEOUT: Duration = Duration::from_millis(250);
const ACCEPT_BACKOFF_START: Duration = Duration::from_millis(50);
const ACCEPT_BACKOFF_MAX: Duration = Duration::from_secs(2);

pub(super) fn busy_response() -> Value {
    json!({"ok": false, "error": BUSY_ERROR, "retryable": true})
}

fn reject_busy(mut stream: TcpStream) {
    let _ = stream.set_write_timeout(Some(BUSY_WRITE_TIMEOUT));
    let _ = writeln!(stream, "{}", busy_response());
}

/// Hands the connection to a worker, or answers `busy` when the queue is full.
/// Returns false once every worker is gone and accepting should stop.
pub(super) fn enqueue(queue: &SyncSender<TcpStream>, stream: TcpStream) -> bool {
    match queue.try_send(stream) {
        Ok(()) => true,
        Err(TrySendError::Full(stream)) => {
            reject_busy(stream);
            true
        }
        Err(TrySendError::Disconnected(_)) => false,
    }
}

fn next_backoff(current: Duration) -> Duration {
    (current * 2).min(ACCEPT_BACKOFF_MAX)
}

pub(super) fn accept_loop(listener: &TcpListener, queue: &SyncSender<TcpStream>) {
    let mut backoff = ACCEPT_BACKOFF_START;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                backoff = ACCEPT_BACKOFF_START;
                if !enqueue(queue, stream) {
                    return;
                }
            }
            Err(_) => {
                std::thread::sleep(backoff);
                backoff = next_backoff(backoff);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::sync::mpsc;

    fn connected_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (server, _) = listener.accept().unwrap();
        (client, server)
    }

    #[test]
    fn full_queue_replies_busy_and_keeps_queued_connections() {
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(1);
        let (_queued_client, queued_server) = connected_pair();
        let (overflow_client, overflow_server) = connected_pair();

        assert!(enqueue(&tx, queued_server));
        assert!(enqueue(&tx, overflow_server));

        overflow_client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut line = String::new();
        BufReader::new(&overflow_client)
            .read_line(&mut line)
            .unwrap();
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply["ok"], false);
        assert_eq!(reply["error"], BUSY_ERROR);
        assert_eq!(reply["retryable"], true);
        // The connection that fit in the queue is still delivered to a worker.
        assert!(rx.try_recv().is_ok());
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn queue_with_room_accepts_without_a_reply() {
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(QUEUE_CAPACITY);
        let (client, server) = connected_pair();
        assert!(enqueue(&tx, server));
        let _worker_socket = rx.try_recv().unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(50)))
            .unwrap();
        let mut line = String::new();
        let error = BufReader::new(&client).read_line(&mut line).unwrap_err();
        assert!(matches!(
            error.kind(),
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
        ));
    }

    #[test]
    fn closed_queue_stops_accepting() {
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(1);
        drop(rx);
        let (_client, server) = connected_pair();
        assert!(!enqueue(&tx, server));
    }

    #[test]
    fn accept_backoff_doubles_up_to_the_cap() {
        let mut delay = ACCEPT_BACKOFF_START;
        for _ in 0..16 {
            let next = next_backoff(delay);
            assert!(next >= delay && next <= ACCEPT_BACKOFF_MAX);
            delay = next;
        }
        assert_eq!(delay, ACCEPT_BACKOFF_MAX);
    }
}
