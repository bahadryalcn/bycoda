use super::*;
use std::sync::mpsc;

fn delta(sequence: u64) -> NativeEvent {
    subscription("delta", sequence, Value::Null)
}

fn subscription(kind: &str, sequence: u64, data: Value) -> NativeEvent {
    NativeEvent::Subscription {
        environment_id: "env".into(),
        generation: 1,
        event: json!({
            "jsonrpc": "2.0",
            "method": "subscription.event",
            "params": {"kind": kind, "sequence": sequence, "data": data},
        }),
    }
}

fn state(phase: &str) -> NativeEvent {
    NativeEvent::State {
        environment_id: "env".into(),
        generation: 1,
        phase: phase.into(),
        category: None,
    }
}

fn label(event: &NativeEvent) -> String {
    match event {
        NativeEvent::State { phase, .. } => format!("state:{phase}"),
        NativeEvent::Subscription { event, .. } => format!(
            "{}:{}",
            event["params"]["kind"].as_str().unwrap(),
            event["params"]["sequence"]
        ),
    }
}

fn batcher(window: Duration) -> (EventBatcher, mpsc::Receiver<Vec<String>>) {
    let (tx, rx) = mpsc::channel();
    let emit: BatchEmit = Arc::new(move |events| {
        let _ = tx.send(events.iter().map(label).collect());
    });
    (EventBatcher::new(window, emit), rx)
}

const FAR: Duration = Duration::from_secs(60);
const SOON: Duration = Duration::from_secs(2);
const QUIET: Duration = Duration::from_millis(150);

// Regression for #497: each frame used to be one webview eval on the socket worker.
#[test]
fn frames_inside_one_window_leave_as_a_single_ordered_batch() {
    let (batcher, rx) = batcher(Duration::from_millis(40));
    for sequence in 0..5 {
        batcher.push(delta(sequence));
    }
    assert_eq!(
        rx.recv_timeout(SOON).unwrap(),
        ["delta:0", "delta:1", "delta:2", "delta:3", "delta:4"]
    );
    assert!(rx.recv_timeout(QUIET).is_err());
}

#[test]
fn a_later_frame_arms_a_new_window_and_order_holds_across_batches() {
    let (batcher, rx) = batcher(Duration::from_millis(20));
    batcher.push(delta(0));
    assert_eq!(rx.recv_timeout(SOON).unwrap(), ["delta:0"]);
    batcher.push(delta(1));
    batcher.push(delta(2));
    assert_eq!(rx.recv_timeout(SOON).unwrap(), ["delta:1", "delta:2"]);
}

#[test]
fn connection_state_flushes_queued_frames_first_without_waiting() {
    let (batcher, rx) = batcher(FAR);
    batcher.push(delta(0));
    batcher.push(delta(1));
    batcher.push(state("retry-wait"));
    assert_eq!(
        rx.recv_timeout(SOON).unwrap(),
        ["delta:0", "delta:1", "state:retry-wait"]
    );
}

#[test]
fn stream_invalidation_frames_flush_at_once_and_keep_their_place() {
    for kind in ["resync-required", "closed"] {
        let (batcher, rx) = batcher(FAR);
        batcher.push(delta(0));
        batcher.push(subscription(kind, 1, Value::Null));
        assert_eq!(
            rx.recv_timeout(SOON).unwrap(),
            ["delta:0".to_string(), format!("{kind}:1")]
        );
    }
}

#[test]
fn snapshots_and_deltas_wait_for_the_window() {
    let (batcher, rx) = batcher(FAR);
    batcher.push(subscription("snapshot", 0, Value::Null));
    batcher.push(delta(1));
    assert!(rx.recv_timeout(QUIET).is_err());
}

#[test]
fn a_full_batch_flushes_without_waiting_for_the_window() {
    let (batcher, rx) = batcher(FAR);
    for sequence in 0..MAX_BATCH_EVENTS as u64 {
        batcher.push(delta(sequence));
    }
    let batch = rx.recv_timeout(SOON).unwrap();
    assert_eq!(batch.len(), MAX_BATCH_EVENTS);
    assert_eq!(batch.first().unwrap(), "delta:0");
    assert_eq!(batch.last().unwrap(), &format!("delta:{}", MAX_BATCH_EVENTS - 1));
}

#[test]
fn a_heavy_frame_flushes_the_queue_it_overflows() {
    let (batcher, rx) = batcher(FAR);
    batcher.push(delta(0));
    batcher.push(subscription(
        "snapshot",
        1,
        Value::String("x".repeat(MAX_BATCH_BYTES)),
    ));
    assert_eq!(rx.recv_timeout(SOON).unwrap(), ["delta:0", "snapshot:1"]);
}

#[test]
fn dropping_the_batcher_emits_what_is_still_queued() {
    let (batcher, rx) = batcher(FAR);
    batcher.push(delta(0));
    batcher.push(delta(1));
    drop(batcher);
    assert_eq!(rx.recv_timeout(SOON).unwrap(), ["delta:0", "delta:1"]);
}

#[test]
fn a_flood_is_delivered_complete_and_in_order_within_bounded_batches() {
    let (batcher, rx) = batcher(Duration::from_millis(5));
    let total = MAX_BATCH_EVENTS as u64 * 5 + 7;
    for sequence in 0..total {
        batcher.push(delta(sequence));
    }
    let mut seen = Vec::new();
    while (seen.len() as u64) < total {
        let batch = rx.recv_timeout(SOON).unwrap();
        assert!(batch.len() <= MAX_BATCH_EVENTS);
        seen.extend(batch);
    }
    let expected: Vec<String> = (0..total).map(|sequence| format!("delta:{sequence}")).collect();
    assert_eq!(seen, expected);
}

#[test]
fn concurrent_flushers_never_swap_batches() {
    let (batcher, rx) = batcher(Duration::from_millis(1));
    let batcher = Arc::new(batcher);
    let total = 400u64;
    let producer = {
        let batcher = batcher.clone();
        std::thread::spawn(move || {
            for sequence in 0..total {
                batcher.push(delta(sequence));
                if sequence % 50 == 0 {
                    batcher.push(state("ready"));
                }
            }
        })
    };
    producer.join().unwrap();
    let mut deltas = Vec::new();
    while (deltas.len() as u64) < total {
        let batch = rx.recv_timeout(SOON).unwrap();
        deltas.extend(batch.into_iter().filter(|entry| entry.starts_with("delta:")));
    }
    let expected: Vec<String> = (0..total).map(|sequence| format!("delta:{sequence}")).collect();
    assert_eq!(deltas, expected);
}

#[test]
fn envelope_batch_is_one_array_of_machine_envelopes_in_order() {
    let payload = envelope_batch("machine.1", vec![delta(0), state("ready")]);
    let envelopes = payload.as_array().unwrap();
    assert_eq!(envelopes.len(), 2);
    assert!(envelopes.iter().all(|entry| entry["machineId"] == "machine.1"));
    assert_eq!(envelopes[0]["event"]["kind"], "subscription");
    assert_eq!(envelopes[0]["event"]["event"]["params"]["sequence"], 0);
    assert_eq!(envelopes[1]["event"]["kind"], "state");
    assert_eq!(envelopes[1]["event"]["phase"], "ready");
}

// The window timer must stay a task on the shared runtime (#503), never a thread.
#[test]
fn the_window_timer_runs_on_the_shared_async_runtime() {
    let production = include_str!("event_batch.rs")
        .split("#[cfg(test)]")
        .next()
        .unwrap();
    assert!(production.contains("tauri::async_runtime::spawn(async move"));
    assert!(!production.contains("thread::"));
    assert!(!production.contains("new_current_thread"));
}
