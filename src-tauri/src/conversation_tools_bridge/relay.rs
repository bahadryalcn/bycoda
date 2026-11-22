use super::*;

// A permit follows physical work through reply I/O, even if its observer times out.
// Nothing waits for one: the poll loop must keep beating the Host while every permit is held.
struct PhysicalSlots {
    available: Mutex<usize>,
}
struct Permit(Arc<PhysicalSlots>);
impl PhysicalSlots {
    fn new(limit: usize) -> Self {
        Self {
            available: Mutex::new(limit),
        }
    }
    fn try_acquire(self: &Arc<Self>) -> Option<Permit> {
        let mut available = self.available.lock().unwrap_or_else(|e| e.into_inner());
        if *available == 0 {
            return None;
        }
        *available -= 1;
        Some(Permit(self.clone()))
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut available = self.0.available.lock().unwrap_or_else(|e| e.into_inner());
        *available += 1;
    }
}

/// Settles a request the desktop cannot start now. The Host never re-offers a claimed request,
/// so it is answered at once instead of waiting for its relay deadline.
const BUSY_ERROR: &str = "Desktop is busy with other requests. Retry shortly.";
/// Busy replies queued for the settlement worker. A full queue leaves the overflow to its
/// Host deadline rather than growing threads or stalling the poll loop.
const BUSY_QUEUE: usize = 32;

/// Pairs each request, in order, with a permit while capacity lasts and never waits for one;
/// the rest come back as `busy`.
fn admit<T>(slots: &Arc<PhysicalSlots>, requests: Vec<T>) -> (Vec<(Permit, T)>, Vec<T>) {
    let mut admitted = Vec::new();
    let mut busy = Vec::new();
    for request in requests {
        match slots.try_acquire() {
            Some(permit) => admitted.push((permit, request)),
            None => busy.push(request),
        }
    }
    (admitted, busy)
}

/// A claimed request refused for capacity, still owned by the take that issued it.
struct BusyJob {
    request: Value,
    issuer: Arc<crate::remote::NativeServiceChannel>,
    taken: Arc<crate::remote::NativeServiceReply>,
}

/// Hands refused requests to the settlement worker without blocking; returns how many it could
/// not queue (full or closed). Those are dropped and their Host deadline settles them.
fn queue_busy<T>(queue: &std::sync::mpsc::SyncSender<T>, jobs: Vec<T>) -> usize {
    let mut dropped = 0;
    for job in jobs {
        if queue.try_send(job).is_err() {
            dropped += 1;
        }
    }
    dropped
}

/// Delivers a reply to the issuer that handed out the request, logging a lost finish.
fn deliver_finish(
    request: &Value,
    issuer: &Arc<crate::remote::NativeServiceChannel>,
    reply: Result<Value, String>,
) {
    // A completed job is returned only to its original issuer.
    // Preparation admits this bounded original forwarding;
    // all original replies remain owned through settlement.
    // A lost finish leaves the Host waiting for its relay deadline.
    let finished =
        reply.and_then(|reply| issuer.project("conversation.desktop.finish", reply, |_| Ok(())));
    if let Err(error) = finished {
        log::warn!(
            "[desktop relay] {} result was not delivered: {error}",
            request["action"].as_str().unwrap_or("request")
        );
    }
}

/// Poll cadence: answers stay quick while agents are using desktop tools,
/// idle polling slows down in steps to 15 s (the caller keeps 2 s while a
/// provider session holds a conversation grant), and an unreachable or
/// unpaired host backs off to 30 s. The host marks the desktop offline after
/// `DESKTOP_RELAY_STALE_MS` (host/conversation/conversation-desktop-relay.ts), which must stay
/// above the longest delay returned here.
pub(super) fn next_poll_delay(
    failures: u32,
    since_request: std::time::Duration,
) -> std::time::Duration {
    use std::time::Duration;
    if failures > 0 {
        return Duration::from_secs(1u64 << failures.min(5)).min(Duration::from_secs(30));
    }
    if since_request < Duration::from_secs(60) {
        Duration::from_secs(1)
    } else if since_request < Duration::from_secs(300) {
        Duration::from_secs(2)
    } else if since_request < Duration::from_secs(1800) {
        Duration::from_secs(5)
    } else {
        Duration::from_secs(15)
    }
}

/// Hold an idle take this long on a Host that advertises
/// `native.services.conversation.desktop.take.wait.v1`. Matches the Host's
/// `DESKTOP_TAKE_WAIT_MS` and stays under its 45 s stale window.
const TAKE_WAIT_MS: u64 = 25_000;

/// Delay before the next take. A take that the Host held (or that returned requests)
/// has already waited on the Host, so the next one follows at once; other takes use the
/// idle steps, capped at 2 s while a provider session holds a grant.
fn take_delay(
    prompt: bool,
    failures: u32,
    since_request: std::time::Duration,
    session_active: bool,
) -> std::time::Duration {
    if prompt {
        return std::time::Duration::ZERO;
    }
    let mut delay = next_poll_delay(failures, since_request);
    if failures == 0 && session_active {
        delay = delay.min(std::time::Duration::from_secs(2));
    }
    delay
}

static RELAY_STOPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Tells the relay threads to leave their loops; called once from the exit teardown.
pub(crate) fn stop_desktop_relay() {
    RELAY_STOPPED.store(true, std::sync::atomic::Ordering::Release);
}

fn relay_stopped() -> bool {
    RELAY_STOPPED.load(std::sync::atomic::Ordering::Acquire)
}

pub(crate) fn start_desktop_relay(app: AppHandle) {
    let mut failures = 0u32;
    let mut last_request = std::time::Instant::now();
    let observation_app = app.clone();
    std::thread::spawn(move || loop {
        if relay_stopped() {
            return;
        }
        static OBSERVATION: OnceLock<Arc<PhysicalSlots>> = OnceLock::new();
        let slots = OBSERVATION.get_or_init(|| Arc::new(PhysicalSlots::new(1)));
        if let Some(permit) = slots.try_acquire() {
            let app = observation_app.clone();
            std::thread::spawn(move || {
                let _permit = permit;
                if let Ok(channel) = crate::remote::NativeServiceChannel::connect(&app) {
                    let _ = assistant_observation_publisher::publish_from_primary_window(
                        &app, &channel,
                    );
                }
            });
        }
        std::thread::sleep(std::time::Duration::from_secs(30));
    });
    // Durable deliveries settle a lost reply or ACK only on new traffic; an idle desktop
    // would keep that slot holding the epoch prefix. One bounded pass every 30 s, or every
    // 2 s while the previous pass moved the prefix.
    let maintenance_app = app.clone();
    std::thread::spawn(move || {
        let mut last_error = String::new();
        loop {
            if relay_stopped() {
                return;
            }
            let outcome = crate::remote::NativeServiceChannel::connect(&maintenance_app)
                .and_then(|channel| channel.maintain_delivery(std::time::Duration::from_secs(5)));
            // While a backlog drains, each pass is a few sequential Host round trips; idling
            // 30 s between them stretched an existing user's drain over many hours.
            let progressed = outcome.as_ref().is_ok_and(|moved| *moved);
            // Log a failure once per change, never request data: it names only our own stage.
            let error = outcome.err().unwrap_or_default();
            if !error.is_empty() && error != last_error {
                log::warn!(
                    "[desktop relay] delivery maintenance failed: {}",
                    error.chars().take(200).collect::<String>()
                );
            }
            last_error = error;
            std::thread::sleep(std::time::Duration::from_secs(if progressed {
                2
            } else {
                30
            }));
        }
    });
    // Busy replies are network I/O, so they leave the poll thread: it must reach the next take.
    let (busy_queue, busy_jobs) = std::sync::mpsc::sync_channel::<BusyJob>(BUSY_QUEUE);
    std::thread::spawn(move || {
        for job in busy_jobs {
            let reply = job
                .taken
                .project(|_| Ok(json!({"id": job.request["id"], "error": BUSY_ERROR})));
            deliver_finish(&job.request, &job.issuer, reply);
        }
    });
    std::thread::spawn(move || {
        static SLOTS: OnceLock<Arc<PhysicalSlots>> = OnceLock::new();
        let slots = SLOTS
            .get_or_init(|| Arc::new(PhysicalSlots::new(8)))
            .clone();
        let mut channel: Option<Arc<crate::remote::NativeServiceChannel>> = None;
        loop {
            if relay_stopped() {
                return;
            }
            if channel
                .as_ref()
                .is_some_and(|channel| !channel.is_current())
            {
                channel = None;
            }
            let selected = match channel.as_ref() {
                Some(channel) => Ok(channel.clone()),
                None => crate::remote::NativeServiceChannel::connect(&app).inspect(|selected| {
                    channel = Some(selected.clone());
                }),
            };
            let taken = selected.and_then(|issuer| {
                // An older Host rejects the wait key, so it only receives the bare take.
                let waits = issuer.supports_desktop_take_wait();
                let params = if waits {
                    json!({ "waitMs": TAKE_WAIT_MS })
                } else {
                    json!({})
                };
                let started = std::time::Instant::now();
                let reply = Arc::new(issuer.request("conversation.desktop.take", params)?);
                let waited = started.elapsed();
                let requests = reply.project(|requests| {
                    Ok(requests
                        .as_array()
                        .map(|requests| requests.to_vec())
                        .unwrap_or_default())
                })?;
                Ok((issuer, reply, requests, waits, waited))
            });
            failures = if taken.is_ok() {
                0
            } else {
                failures.saturating_add(1)
            };
            let mut prompt = false;
            if let Ok((issuer, taken, requests, waits, waited)) = taken {
                // Re-arm at once only after a take that returned requests or waited out most of
                // its hold. An empty early reply is paced by the idle steps, so it cannot spin.
                prompt = waits
                    && (!requests.is_empty()
                        || waited >= std::time::Duration::from_millis(TAKE_WAIT_MS / 2));
                if !requests.is_empty() {
                    last_request = std::time::Instant::now();
                }
                // Never wait for a permit here: parked on one, this loop would stop polling and
                // the Host would mark the desktop offline while every slot is held.
                let (admitted, busy) = admit(&slots, requests);
                for (permit, request) in admitted {
                    let app = app.clone();
                    let issuer = issuer.clone();
                    let taken = taken.clone();
                    std::thread::spawn(move || {
                        let _permit = permit;
                        let result = execute_desktop_request(&app, &request, &issuer, &taken);
                        let reply = match &result {
                            Ok(outcome) => outcome.finish_payload(&request["id"], &taken),
                            Err(error) => {
                                taken.project(|_| Ok(json!({"id": request["id"], "error": error})))
                            }
                        };
                        deliver_finish(&request, &issuer, reply);
                        drop(result);
                    });
                }
                let dropped = queue_busy(
                    &busy_queue,
                    busy.into_iter()
                        .map(|request| BusyJob {
                            request,
                            issuer: issuer.clone(),
                            taken: taken.clone(),
                        })
                        .collect(),
                );
                if dropped > 0 {
                    log::warn!(
                        "[desktop relay] {dropped} busy request(s) were not queued; the Host deadline settles them"
                    );
                }
            }
            let session_active = grants().lock().map(|map| !map.is_empty()).unwrap_or(true);
            std::thread::sleep(take_delay(
                prompt,
                failures,
                last_request.elapsed(),
                session_active,
            ));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn held_takes_rearm_at_once_and_other_takes_keep_idle_steps() {
        use std::time::Duration;
        assert_eq!(take_delay(true, 0, Duration::ZERO, true), Duration::ZERO);
        assert_eq!(
            take_delay(false, 0, Duration::ZERO, true),
            Duration::from_secs(1)
        );
        assert_eq!(
            take_delay(false, 0, Duration::from_secs(600), false),
            Duration::from_secs(5)
        );
        assert_eq!(
            take_delay(false, 2, Duration::ZERO, true),
            Duration::from_secs(4)
        );
        // A failed take never re-arms, however long it ran.
        assert_eq!(
            take_delay(false, 3, Duration::ZERO, true),
            Duration::from_secs(8)
        );
        assert!(Duration::from_millis(TAKE_WAIT_MS) < Duration::from_secs(45));
    }

    #[test]
    fn stop_desktop_relay_ends_the_relay_loops() {
        stop_desktop_relay();
        assert!(relay_stopped());
    }

    #[test]
    fn physical_slots_remain_held_until_work_exits() {
        let slots = Arc::new(PhysicalSlots::new(1));
        let permit = slots.try_acquire().unwrap();
        assert!(slots.try_acquire().is_none());
        drop(permit);
        assert!(slots.try_acquire().is_some());
    }

    #[test]
    fn admit_never_waits_when_every_permit_is_held() {
        let slots = Arc::new(PhysicalSlots::new(2));
        let held: Vec<_> = (0..2).map(|_| slots.try_acquire().unwrap()).collect();
        // A parked poll thread would never return; run it aside and require a prompt answer.
        let (sent, received) = std::sync::mpsc::channel();
        let aside = slots.clone();
        let thread = std::thread::spawn(move || {
            let (admitted, busy) = admit(&aside, vec![1, 2, 3]);
            sent.send((admitted.len(), busy)).unwrap();
        });
        let (admitted, busy) = received
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("admit parked on a permit while capacity was full");
        thread.join().unwrap();
        assert_eq!(admitted, 0);
        assert_eq!(busy, vec![1, 2, 3]);
        drop(held);
    }

    #[test]
    fn admit_keeps_capacity_bounded_and_serves_earlier_requests_first() {
        let slots = Arc::new(PhysicalSlots::new(3));
        let (admitted, busy) = admit(&slots, vec!["a", "b", "c", "d", "e"]);
        let served: Vec<_> = admitted.iter().map(|(_, request)| *request).collect();
        assert_eq!(served, vec!["a", "b", "c"]);
        assert_eq!(busy, vec!["d", "e"]);
        assert!(slots.try_acquire().is_none());
        // A permit freed by finished work admits the next batch.
        drop(admitted);
        let (admitted, busy) = admit(&slots, vec!["f", "g", "h", "i"]);
        assert_eq!(admitted.len(), 3);
        assert_eq!(busy, vec!["i"]);
    }

    #[test]
    fn busy_queue_overflow_never_blocks_and_is_counted() {
        let (queue, jobs) = std::sync::mpsc::sync_channel::<u32>(2);
        assert_eq!(queue_busy(&queue, vec![1, 2, 3, 4]), 2);
        assert_eq!(jobs.try_iter().collect::<Vec<_>>(), vec![1, 2]);
        // A closed worker also reports instead of panicking or parking.
        drop(jobs);
        assert_eq!(queue_busy(&queue, vec![5]), 1);
    }

    #[test]
    fn busy_error_names_the_retry_so_callers_do_not_read_it_as_offline() {
        assert!(BUSY_ERROR.contains("busy"));
        assert!(!BUSY_ERROR.to_lowercase().contains("offline"));
    }
}
