//! Bounded concurrency for streamed Git reads. Nested reads (run while an outer
//! stream is held) use their own pool so an outer stream never waits on itself.
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

const MAX_GIT_STREAMS: usize = 4;
pub(super) static ACTIVE_GIT_STREAMS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
pub(super) static ACTIVE_NESTED_GIT_STREAMS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Wakes callers waiting for a stream slot. Released slots notify under this lock,
/// so a waiter that checked capacity while holding it cannot miss the release.
static GIT_STREAM_RELEASED: (std::sync::Mutex<()>, std::sync::Condvar) =
    (std::sync::Mutex::new(()), std::sync::Condvar::new());

pub(super) struct GitStreamLease(&'static std::sync::atomic::AtomicUsize);
impl GitStreamLease {
    /// Bursts (one discovery per checkout) queue for a slot until their own deadline
    /// instead of failing while sibling streams finish.
    pub(super) fn acquire(
        counter: &'static std::sync::atomic::AtomicUsize,
        deadline: Instant,
    ) -> Result<Arc<Self>, String> {
        let (lock, released) = &GIT_STREAM_RELEASED;
        let mut guard = lock.lock().unwrap_or_else(|error| error.into_inner());
        loop {
            let active = counter.load(Ordering::Acquire);
            if active < MAX_GIT_STREAMS {
                if counter
                    .compare_exchange(active, active + 1, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    return Ok(Arc::new(Self(counter)));
                }
                continue;
            }
            let now = Instant::now();
            if now >= deadline {
                return Err("Git stream capacity is unavailable".into());
            }
            guard = released
                .wait_timeout(guard, deadline - now)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
    }
}
impl Drop for GitStreamLease {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
        let (lock, released) = &GIT_STREAM_RELEASED;
        let _guard = lock.lock().unwrap_or_else(|error| error.into_inner());
        released.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn full_stream_capacity_waits_for_a_release_until_the_deadline() {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let held: Vec<_> = (0..MAX_GIT_STREAMS)
            .map(|_| GitStreamLease::acquire(&COUNTER, Instant::now()).unwrap())
            .collect();
        assert_eq!(
            GitStreamLease::acquire(&COUNTER, Instant::now() + Duration::from_millis(50))
                .err()
                .as_deref(),
            Some("Git stream capacity is unavailable")
        );
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            drop(held);
        });
        let waited = GitStreamLease::acquire(&COUNTER, Instant::now() + Duration::from_secs(5));
        assert!(waited.is_ok());
        releaser.join().unwrap();
        drop(waited);
        assert_eq!(COUNTER.load(Ordering::Acquire), 0);
    }
}
