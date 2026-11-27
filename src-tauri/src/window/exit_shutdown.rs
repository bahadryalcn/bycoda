use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Budget for the ordered teardown chain. Past it the children are reaped anyway.
pub(crate) const TEARDOWN_DEADLINE: Duration = Duration::from_secs(3);
/// One budget from the exit request for teardown and child reaping together.
pub(crate) const EXIT_DEADLINE: Duration = Duration::from_secs(6);

/// Set once an exit has started, so a repeated `RunEvent::Exit` is a no-op.
static STARTED: AtomicBool = AtomicBool::new(false);

/// Runs the exit work off the event loop under one deadline and returns when it
/// finishes or the deadline passes; the process then ends and the OS drops what is
/// left. `teardown` is the ordered chain (it stays in order because it is one
/// thread). `reap` kills the harness and terminal children: it runs after the
/// chain, or at `teardown_deadline` when the chain is wedged, so a stuck ssh child
/// or lock never keeps the children alive. A second call returns at once.
pub(crate) fn run_bounded(
    teardown: impl FnOnce() + Send + 'static,
    reap: impl FnOnce() + Send + 'static,
) -> bool {
    if STARTED.swap(true, Ordering::SeqCst) {
        return false;
    }
    run_with_deadlines(teardown, reap, TEARDOWN_DEADLINE, EXIT_DEADLINE);
    true
}

fn run_with_deadlines(
    teardown: impl FnOnce() + Send + 'static,
    reap: impl FnOnce() + Send + 'static,
    teardown_deadline: Duration,
    exit_deadline: Duration,
) {
    let started = Instant::now();
    let (teardown_done, teardown_finished) = mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("exit-teardown".into())
        .spawn(move || {
            teardown();
            let _ = teardown_done.send(());
        });
    if spawned.is_ok() {
        // A timeout or a panicked chain (the sender drops) both fall through to the reap.
        let _ = teardown_finished.recv_timeout(teardown_deadline);
    }
    let (reap_done, reap_finished) = mpsc::channel();
    let reaper = std::thread::Builder::new()
        .name("exit-reap".into())
        .spawn(move || {
            reap();
            let _ = reap_done.send(());
        });
    if reaper.is_ok() {
        let _ = reap_finished.recv_timeout(exit_deadline.saturating_sub(started.elapsed()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    #[test]
    fn teardown_runs_before_reap() {
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (first, second) = (order.clone(), order.clone());
        run_with_deadlines(
            move || first.lock().unwrap().push("teardown"),
            move || second.lock().unwrap().push("reap"),
            Duration::from_secs(5),
            Duration::from_secs(10),
        );
        assert_eq!(*order.lock().unwrap(), vec!["teardown", "reap"]);
    }

    #[test]
    fn wedged_teardown_does_not_block_reap_or_exit() {
        let reaped = Arc::new(AtomicUsize::new(0));
        let counter = reaped.clone();
        let started = Instant::now();
        run_with_deadlines(
            || std::thread::sleep(Duration::from_secs(30)),
            move || {
                counter.fetch_add(1, Ordering::SeqCst);
            },
            Duration::from_millis(50),
            Duration::from_millis(500),
        );
        assert_eq!(reaped.load(Ordering::SeqCst), 1);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn wedged_reap_ends_at_the_overall_deadline() {
        let started = Instant::now();
        run_with_deadlines(
            || {},
            || std::thread::sleep(Duration::from_secs(30)),
            Duration::from_millis(50),
            Duration::from_millis(300),
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn panicking_teardown_still_reaps() {
        let reaped = Arc::new(AtomicUsize::new(0));
        let counter = reaped.clone();
        run_with_deadlines(
            || panic!("teardown failed"),
            move || {
                counter.fetch_add(1, Ordering::SeqCst);
            },
            Duration::from_secs(5),
            Duration::from_secs(10),
        );
        assert_eq!(reaped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_repeated_exit_is_ignored() {
        let runs = Arc::new(AtomicUsize::new(0));
        let (a, b) = (runs.clone(), runs.clone());
        assert!(run_bounded(
            move || {
                a.fetch_add(1, Ordering::SeqCst);
            },
            || {}
        ));
        assert!(!run_bounded(
            move || {
                b.fetch_add(1, Ordering::SeqCst);
            },
            || {}
        ));
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }
}
