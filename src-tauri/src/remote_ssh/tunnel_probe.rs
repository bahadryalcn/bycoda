//! Keeping a working SSH tunnel: probe it before tearing it down, and notice
//! that the computer slept so the silence is not read as a dead link.
use std::time::{Duration, Instant, SystemTime};

/// How long one probe may wait for the Host to answer through the forward. A slow
/// Host still answers within this; only a silent link exhausts it.
pub(super) const PROBE_TIMEOUT: Duration = Duration::from_millis(2500);
/// Probes before a tunnel is declared dead.
const PROBE_ATTEMPTS: u32 = 2;
/// Extra probes right after a wake: the network is usually still rejoining.
const PROBE_ATTEMPTS_AFTER_WAKE: u32 = 4;
const PROBE_RETRY_PAUSE: Duration = Duration::from_millis(300);
/// A tick later than scheduled, or a wall clock ahead of the monotonic one,
/// by more than this means the computer slept.
const WAKE_GAP: Duration = Duration::from_secs(5);
/// A wake this recent still counts when a request fails.
pub(super) const WAKE_GRACE: Duration = Duration::from_secs(60);

/// What probing the existing tunnel found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Probe {
    Answered,
    Failed,
}

/// Whether a tunnel is closed or kept after a failed request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Verdict {
    Keep,
    Teardown(&'static str),
}

/// A tunnel is closed only when its ssh process ended or the probe failed.
pub(super) fn verdict(process_alive: bool, probe: Option<Probe>) -> Verdict {
    match (process_alive, probe) {
        (false, _) => Verdict::Teardown("ssh process exited"),
        (true, Some(Probe::Answered)) => Verdict::Keep,
        (true, Some(Probe::Failed)) => Verdict::Teardown("probe failed"),
        (true, None) => Verdict::Teardown("not probed"),
    }
}

pub(super) fn probe_attempts(recent_wake: bool) -> u32 {
    if recent_wake {
        PROBE_ATTEMPTS_AFTER_WAKE
    } else {
        PROBE_ATTEMPTS
    }
}

/// The length of a sleep between two ticks, or `None` when the tick was on time.
/// `monotonic` is the `Instant` time since the last tick, `wall` the system
/// clock's (`None` when the clock went backwards). Either clock running ahead of
/// the interval proves a pause: monotonic clocks stop in sleep on some systems
/// and keep going on others, and the wall clock always keeps going.
pub(super) fn sleep_gap(
    monotonic: Duration,
    wall: Option<Duration>,
    interval: Duration,
) -> Option<Duration> {
    let elapsed = monotonic.max(wall.unwrap_or_default());
    let gap = elapsed.saturating_sub(interval);
    (gap > WAKE_GAP).then_some(gap)
}

/// Compares consecutive ticks of one watcher.
pub(super) struct WakeClock {
    monotonic: Instant,
    wall: SystemTime,
    interval: Duration,
}

impl WakeClock {
    pub(super) fn new(interval: Duration) -> Self {
        Self {
            monotonic: Instant::now(),
            wall: SystemTime::now(),
            interval,
        }
    }

    /// Call once per tick; returns the sleep gap if the computer just woke.
    pub(super) fn tick(&mut self) -> Option<Duration> {
        let (monotonic, wall) = (Instant::now(), SystemTime::now());
        let gap = sleep_gap(
            monotonic.duration_since(self.monotonic),
            wall.duration_since(self.wall).ok(),
            self.interval,
        );
        self.monotonic = monotonic;
        self.wall = wall;
        gap
    }
}

/// Whether the Host answers an HTTP request through the forwarded port. Any
/// HTTP status proves the tunnel carries traffic; only a transport failure
/// (refused, reset, timeout) does not.
pub(super) fn probe_once(port: u16, timeout: Duration) -> Probe {
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(timeout)
        .build();
    match agent.get(&format!("http://127.0.0.1:{port}/")).call() {
        Ok(_) | Err(ureq::Error::Status(..)) => Probe::Answered,
        Err(ureq::Error::Transport(_)) => Probe::Failed,
    }
}

/// Probes up to `probe_attempts` times with a short pause between them.
pub(super) fn probe(port: u16, recent_wake: bool) -> Probe {
    for attempt in 0..probe_attempts(recent_wake) {
        if attempt > 0 {
            std::thread::sleep(PROBE_RETRY_PAUSE);
        }
        if probe_once(port, PROBE_TIMEOUT) == Probe::Answered {
            return Probe::Answered;
        }
    }
    Probe::Failed
}
