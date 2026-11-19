//! Fresh GitHub credential lookups for mention and review commands.
//!
//! A caller must never receive a credential read before it arrived: an account
//! switch or sign-out between that read and the caller's own check would
//! otherwise authorize the old account. So callers never join a lookup that is
//! already running. They join the single queued lookup, which only starts after
//! the running one retired, so every caller sees a process started after its
//! own arrival while overlapping calls cost at most one extra process. Nothing
//! is cached: a finished flight is dropped once its waiters have read it.
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::{
    publish_token, token_worker, wait_for_token, TokenFlight, TokenRegistry, TokenResult,
    TOKEN_TIMEOUT,
};

/// A waiter may sit behind one running lookup before its own lookup runs.
const FRESH_WAIT: Duration = Duration::from_secs(TOKEN_TIMEOUT.as_secs() * 2 + 1);
const UNKNOWN_RETIREMENT: &str = "Media authentication process retirement unknown";

type Lookup = &'static (dyn Fn(TokenRegistry, Arc<TokenFlight>) + Send + Sync);

#[derive(Default)]
struct FreshState {
    running: Option<Arc<TokenFlight>>,
    queued: Option<Arc<TokenFlight>>,
    /// A lookup process whose retirement is unverified keeps the fence: no
    /// further process starts, as with the media lookup.
    blocked: bool,
}

struct FreshLookups {
    state: Mutex<FreshState>,
}

struct Joined {
    flight: Arc<TokenFlight>,
    start: bool,
}

fn new_flight() -> Arc<TokenFlight> {
    Arc::new(TokenFlight {
        result: Mutex::new(None),
        ready: Condvar::new(),
    })
}

impl FreshLookups {
    const fn new() -> Self {
        Self {
            state: Mutex::new(FreshState {
                running: None,
                queued: None,
                blocked: false,
            }),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, FreshState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Becomes the runner when idle; otherwise joins the lookup queued behind
    /// the running one, never the running one itself.
    fn join(&self) -> Result<Joined, String> {
        let mut state = self.state();
        if state.blocked {
            return Err(UNKNOWN_RETIREMENT.into());
        }
        if state.running.is_none() {
            let flight = new_flight();
            state.running = Some(flight.clone());
            return Ok(Joined {
                flight,
                start: true,
            });
        }
        let flight = state.queued.get_or_insert_with(new_flight).clone();
        Ok(Joined {
            flight,
            start: false,
        })
    }

    /// Called once when `ran` finished. Returns the queued flight to start next.
    fn retire(&self, ran: &Arc<TokenFlight>, verified: bool) -> Option<Arc<TokenFlight>> {
        let mut state = self.state();
        if !state.running.as_ref().is_some_and(|run| Arc::ptr_eq(run, ran)) {
            return None;
        }
        if !verified {
            state.blocked = true;
            if let Some(queued) = state.queued.take() {
                publish_token(&queued, Err(UNKNOWN_RETIREMENT.into()));
            }
            return None;
        }
        state.running = state.queued.take();
        state.running.clone()
    }
}

static FRESH: FreshLookups = FreshLookups::new();

/// Room source rechecks and mention lookups need a credential read that began
/// after the call did, but overlapping calls share lookups instead of failing.
pub(crate) fn github_auth_token_fresh() -> TokenResult {
    fresh_token(&FRESH, &token_worker)
}

fn fresh_token(lookups: &'static FreshLookups, lookup: Lookup) -> TokenResult {
    let deadline = Instant::now() + FRESH_WAIT;
    let joined = lookups.join()?;
    if joined.start {
        launch(lookups, joined.flight.clone(), lookup);
    }
    wait_for_token(&joined.flight, deadline)
}

/// Runs `flight` on its own thread and then starts the queued flight, if any.
fn launch(lookups: &'static FreshLookups, mut flight: Arc<TokenFlight>, lookup: Lookup) {
    loop {
        let registry: TokenRegistry = Arc::new(Mutex::new(Some(flight.clone())));
        let (worker_registry, worker_flight) = (registry.clone(), flight.clone());
        let spawned = thread::Builder::new()
            .name("room-inbox-auth".into())
            .spawn(move || {
                let completed = catch_unwind(AssertUnwindSafe(|| {
                    lookup(worker_registry.clone(), worker_flight.clone())
                }));
                if completed.is_err() {
                    publish_token(
                        &worker_flight,
                        Err("Media authentication process status unknown".into()),
                    );
                }
                // A lookup that retired verified clears its registry slot.
                let verified = completed.is_ok()
                    && worker_registry
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .is_none();
                if let Some(next) = lookups.retire(&worker_flight, verified) {
                    launch(lookups, next, lookup);
                }
            });
        if spawned.is_ok() {
            return;
        }
        publish_token(&flight, Err("GitHub authentication unavailable".into()));
        match lookups.retire(&flight, true) {
            Some(next) => flight = next,
            None => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::finish_token_flight;
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    fn leak_lookups() -> &'static FreshLookups {
        Box::leak(Box::new(FreshLookups::new()))
    }

    fn wait(flight: &TokenFlight) -> TokenResult {
        wait_for_token(flight, Instant::now() + Duration::from_secs(5))
    }

    /// A mocked `gh auth token` which reports its start, waits for `open`, and
    /// returns `token-<start number>`; no process is spawned.
    fn gated_lookup() -> (
        Lookup,
        Arc<AtomicUsize>,
        mpsc::Receiver<()>,
        Arc<(Mutex<bool>, Condvar)>,
    ) {
        let starts = Arc::new(AtomicUsize::new(0));
        let (entered_send, entered) = mpsc::channel();
        let entered_send = Mutex::new(entered_send);
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (lookup_starts, lookup_gate) = (starts.clone(), gate.clone());
        let lookup: Lookup = Box::leak(Box::new(
            move |registry: TokenRegistry, flight: Arc<TokenFlight>| {
                let number = lookup_starts.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = entered_send.lock().unwrap().send(());
                let (open, opened) = &*lookup_gate;
                let mut open = open.lock().unwrap();
                while !*open {
                    open = opened.wait(open).unwrap();
                }
                drop(open);
                finish_token_flight(&registry, &flight, Ok(Some(format!("token-{number}"))));
            },
        ));
        (lookup, starts, entered, gate)
    }

    fn open(gate: &(Mutex<bool>, Condvar)) {
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
    }

    #[test]
    fn overlapping_callers_wait_for_one_lookup_started_after_they_arrived() {
        let lookups = leak_lookups();
        let (lookup, starts, entered, gate) = gated_lookup();
        let first = lookups.join().unwrap();
        assert!(first.start);
        launch(lookups, first.flight.clone(), lookup);
        entered.recv_timeout(Duration::from_secs(5)).unwrap();

        // Arrivals during the running lookup never join it and are not rejected.
        let second = lookups.join().unwrap();
        let third = lookups.join().unwrap();
        assert!(!second.start && !third.start);
        assert!(Arc::ptr_eq(&second.flight, &third.flight));
        assert!(!Arc::ptr_eq(&second.flight, &first.flight));
        assert_eq!(starts.load(Ordering::SeqCst), 1);

        open(&gate);
        assert_eq!(wait(&first.flight).unwrap().as_deref(), Some("token-1"));
        assert_eq!(wait(&second.flight).unwrap().as_deref(), Some("token-2"));
        assert_eq!(wait(&third.flight).unwrap().as_deref(), Some("token-2"));
        assert_eq!(starts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn finished_lookups_are_not_retained_for_later_callers() {
        let lookups = leak_lookups();
        let (lookup, starts, _entered, gate) = gated_lookup();
        open(&gate);
        let first = lookups.join().unwrap();
        launch(lookups, first.flight.clone(), lookup);
        assert_eq!(wait(&first.flight).unwrap().as_deref(), Some("token-1"));
        // The runner slot is released after retirement, so the next caller
        // starts its own lookup instead of reading the old credential.
        let deadline = Instant::now() + Duration::from_secs(5);
        let next = loop {
            let joined = lookups.join().unwrap();
            if joined.start || Instant::now() > deadline {
                break joined;
            }
            thread::yield_now();
        };
        assert!(next.start);
        assert!(!Arc::ptr_eq(&next.flight, &first.flight));
        assert!(lookups.state().queued.is_none());
    }

    #[test]
    fn unverified_retirement_keeps_the_fence_and_fails_queued_callers() {
        let lookups = leak_lookups();
        let (entered_send, entered) = mpsc::channel();
        let entered_send = Mutex::new(entered_send);
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let lookup_gate = gate.clone();
        let lookup: Lookup = Box::leak(Box::new(
            move |_registry: TokenRegistry, flight: Arc<TokenFlight>| {
                let _ = entered_send.lock().unwrap().send(());
                let (open, opened) = &*lookup_gate;
                let mut open = open.lock().unwrap();
                while !*open {
                    open = opened.wait(open).unwrap();
                }
                drop(open);
                // Timed out: the result is public but the registry still holds the flight.
                publish_token(&flight, Err("Media authentication timed out".into()));
            },
        ));
        let first = lookups.join().unwrap();
        launch(lookups, first.flight.clone(), lookup);
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        let queued = lookups.join().unwrap();
        assert!(!queued.start);

        open(&gate);
        assert_eq!(
            wait(&first.flight).unwrap_err(),
            "Media authentication timed out"
        );
        assert_eq!(wait(&queued.flight).unwrap_err(), UNKNOWN_RETIREMENT);
        assert_eq!(lookups.join().err().as_deref(), Some(UNKNOWN_RETIREMENT));
    }

    #[test]
    fn panicking_lookup_reports_unknown_status_and_blocks() {
        let lookups = leak_lookups();
        let lookup: Lookup = Box::leak(Box::new(
            |_registry: TokenRegistry, _flight: Arc<TokenFlight>| panic!("injected lookup panic"),
        ));
        let first = lookups.join().unwrap();
        launch(lookups, first.flight.clone(), lookup);
        assert_eq!(
            wait(&first.flight).unwrap_err(),
            "Media authentication process status unknown"
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        while lookups.join().is_ok() && Instant::now() < deadline {
            thread::yield_now();
        }
        assert_eq!(lookups.join().err().as_deref(), Some(UNKNOWN_RETIREMENT));
    }
}
