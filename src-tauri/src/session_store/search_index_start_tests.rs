use super::wait_for_search_index_start;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Barrier,
};
use std::time::{Duration, Instant};

#[test]
fn pending_search_wakes_a_delayed_background_worker() {
    let urgent = Arc::new(AtomicBool::new(false));
    let ready = Arc::new(Barrier::new(2));
    let worker_flag = urgent.clone();
    let worker_ready = ready.clone();
    let started = Instant::now();
    let worker = std::thread::spawn(move || {
        worker_ready.wait();
        wait_for_search_index_start(Duration::from_secs(5), &worker_flag);
    });
    ready.wait();
    urgent.store(true, Ordering::Release);
    worker.join().unwrap();
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(!urgent.load(Ordering::Acquire));
}
