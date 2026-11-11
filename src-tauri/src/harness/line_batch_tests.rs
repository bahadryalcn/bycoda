use super::*;
use std::sync::mpsc::{channel, sync_channel};

#[test]
fn output_goes_only_to_the_owner_window_while_it_exists() {
    let owners = Owners::new("main-2");
    let route = owners.route(|label| label == "main-2" || label == "main");
    assert_eq!(route, Route::Windows(vec!["main-2".to_string()]));
}

#[test]
fn output_is_broadcast_when_no_owner_is_known_or_alive() {
    assert_eq!(Owners::default().route(|_| true), Route::Broadcast);
    let gone = Owners::new("closed");
    assert_eq!(gone.route(|_| false), Route::Broadcast);
}

#[test]
fn extra_owners_fan_out_and_a_closed_one_is_skipped() {
    let owners = Owners::new("a");
    owners.add("b");
    owners.add("b");
    owners.add("c");
    let route = owners.route(|label| label != "c");
    assert_eq!(
        route,
        Route::Windows(vec!["a".to_string(), "b".to_string()])
    );
}

fn lines(range: std::ops::Range<usize>) -> Vec<String> {
    range.map(|i| format!("line {i}")).collect()
}

fn run(rx: mpsc::Receiver<String>, max_bytes: usize, max_lines: usize) -> Vec<Vec<String>> {
    let mut emits = Vec::new();
    coalesce_lines(&rx, LINE_BATCH_WINDOW, max_bytes, max_lines, |batch| {
        emits.push(batch)
    });
    emits
}

#[test]
fn a_queued_burst_is_one_batch_in_order() {
    let (tx, rx) = channel();
    for line in lines(0..50) {
        tx.send(line).unwrap();
    }
    drop(tx);
    let emits = run(rx, LINE_BATCH_BYTES, LINE_BATCH_LINES);
    assert_eq!(emits, vec![lines(0..50)]);
}

#[test]
fn lines_before_close_are_flushed() {
    let (tx, rx) = channel();
    tx.send("tail".to_string()).unwrap();
    drop(tx);
    assert_eq!(
        run(rx, LINE_BATCH_BYTES, LINE_BATCH_LINES),
        vec![vec!["tail".to_string()]]
    );
}

#[test]
fn an_empty_closed_channel_emits_nothing() {
    let (tx, rx) = channel::<String>();
    drop(tx);
    assert!(run(rx, LINE_BATCH_BYTES, LINE_BATCH_LINES).is_empty());
}

#[test]
fn a_lone_line_goes_out_while_the_channel_stays_open() {
    let (tx, rx) = channel();
    let (out_tx, out_rx) = channel();
    let worker = thread::spawn(move || {
        coalesce_lines(
            &rx,
            Duration::from_secs(30),
            LINE_BATCH_BYTES,
            LINE_BATCH_LINES,
            |batch| out_tx.send(batch).unwrap(),
        );
    });
    tx.send("x".to_string()).unwrap();
    // Keep the sender open and receive well before the injected batching
    // window: the first line must go out without waiting for that window.
    // Leave CI scheduling headroom instead of asserting subsecond latency.
    let batch = out_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(batch, vec!["x".to_string()]);
    drop(tx);
    worker.join().unwrap();
}

#[test]
fn the_line_count_bound_splits_a_burst() {
    let (tx, rx) = channel();
    for line in lines(0..25) {
        tx.send(line).unwrap();
    }
    drop(tx);
    let emits = run(rx, LINE_BATCH_BYTES, 10);
    assert_eq!(
        emits.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![10, 10, 5]
    );
    assert_eq!(emits.concat(), lines(0..25));
}

#[test]
fn the_byte_bound_splits_without_cutting_lines() {
    let (tx, rx) = channel();
    let all: Vec<String> = (0..30).map(|i| format!("{i:0>9}")).collect();
    for line in &all {
        tx.send(line.clone()).unwrap();
    }
    drop(tx);
    let emits = run(rx, 50, LINE_BATCH_LINES);
    assert!(emits.len() >= 5);
    assert!(emits
        .iter()
        .all(|batch| batch.iter().map(String::len).sum::<usize>() <= 50));
    assert_eq!(emits.concat(), all);
}

#[test]
fn an_oversized_line_is_a_batch_of_its_own() {
    let (tx, rx) = channel();
    let big = "x".repeat(200);
    for line in ["a", big.as_str(), "b"] {
        tx.send(line.to_string()).unwrap();
    }
    drop(tx);
    let emits = run(rx, 50, LINE_BATCH_LINES);
    assert_eq!(
        emits,
        vec![vec!["a".to_string()], vec![big], vec!["b".to_string()]]
    );
}

#[test]
fn sustained_output_stays_under_the_emit_rate_bound() {
    let (tx, rx) = sync_channel(LINE_QUEUE);
    let feeder = thread::spawn(move || {
        let start = Instant::now();
        let mut sent = Vec::new();
        while start.elapsed() < Duration::from_millis(200) {
            let line = format!("line {}", sent.len());
            tx.send(line.clone()).unwrap();
            sent.push(line);
            thread::sleep(Duration::from_millis(1));
        }
        sent
    });
    let started = Instant::now();
    let emits = run(rx, LINE_BATCH_BYTES, LINE_BATCH_LINES);
    let secs = started.elapsed().as_secs_f64();
    let sent = feeder.join().unwrap();
    assert_eq!(emits.concat(), sent);
    assert!(emits.len() as f64 <= secs / LINE_BATCH_WINDOW.as_secs_f64() + 2.0);
}

#[test]
fn dropping_the_batcher_flushes_everything_before_returning() {
    let (out_tx, out_rx) = channel();
    let batcher = LineBatcher::new(move |batch| out_tx.send(batch).unwrap());
    for line in lines(0..1000) {
        batcher.push(line);
    }
    drop(batcher);
    let all: Vec<String> = out_rx.try_iter().flatten().collect();
    assert_eq!(all, lines(0..1000));
}

#[test]
fn readers_are_awaited_but_only_for_the_grace_period() {
    let (tx, rx) = channel::<()>();
    let held = tx.clone();
    let release = thread::spawn(move || {
        thread::sleep(Duration::from_millis(50));
        drop(tx);
    });
    let started = Instant::now();
    wait_for_readers(&rx, Duration::from_millis(100));
    // One sender is still held, so this returns on the grace deadline.
    assert!(started.elapsed() >= Duration::from_millis(90));
    release.join().unwrap();
    drop(held);
    let started = Instant::now();
    wait_for_readers(&rx, Duration::from_secs(5));
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn read_lines_batched_keeps_every_line_in_order() {
    let input = lines(0..300).join(
        "
",
    );
    let (out_tx, out_rx) = channel();
    read_lines_batched(std::io::Cursor::new(input), move |batch| {
        out_tx.send(batch).unwrap()
    });
    let all: Vec<String> = out_rx.try_iter().flatten().collect();
    assert_eq!(all, lines(0..300));
}

#[test]
fn read_lines_batched_keeps_draining_after_invalid_utf8() {
    // A Windows code-page byte (0xFE) in the middle of the stream, followed
    // by more valid lines; before lossy decoding the reader stopped at that line.
    let mut input = b"first\r\n".to_vec();
    input.extend_from_slice(b"bad \xFE byte\n");
    input.extend_from_slice("sonra \u{15F}".as_bytes());
    input.push(b'\n');
    input.extend_from_slice(b"last without newline");
    let (out_tx, out_rx) = channel();
    let ok = read_lines_batched(std::io::Cursor::new(input), move |batch| {
        out_tx.send(batch).unwrap()
    });
    assert!(ok);
    let all: Vec<String> = out_rx.try_iter().flatten().collect();
    assert_eq!(
        all,
        vec![
            "first".to_string(),
            "bad \u{FFFD} byte".to_string(),
            "sonra \u{15F}".to_string(),
            "last without newline".to_string(),
        ]
    );
}

#[test]
fn decode_output_line_strips_line_endings_and_replaces_invalid_bytes() {
    assert_eq!(decode_output_line(b"plain\n"), "plain");
    assert_eq!(decode_output_line(b"crlf\r\n"), "crlf");
    assert_eq!(decode_output_line(b"no newline"), "no newline");
    assert_eq!(decode_output_line(b"\n"), "");
    assert_eq!(decode_output_line(b""), "");
    // A lone carriage return inside the line is content, not a terminator.
    assert_eq!(decode_output_line(b"a\rb\n"), "a\rb");
    assert_eq!(decode_output_line(b"\xFF\xFE\n"), "\u{FFFD}\u{FFFD}");
}
