use super::*;
use std::sync::Condvar;

// A permit follows physical work through reply I/O, even if its observer times out.
struct PhysicalSlots { available: Mutex<usize>, wake: Condvar }
struct Permit(Arc<PhysicalSlots>);
impl PhysicalSlots {
    fn new(limit: usize) -> Self { Self { available: Mutex::new(limit), wake: Condvar::new() } }
    fn try_acquire(self: &Arc<Self>) -> Option<Permit> {
        let mut available = self.available.lock().unwrap_or_else(|e| e.into_inner());
        if *available == 0 { return None; }
        *available -= 1;
        Some(Permit(self.clone()))
    }
    fn acquire(self: &Arc<Self>) -> Permit {
        let mut available = self.available.lock().unwrap_or_else(|e| e.into_inner());
        while *available == 0 { available = self.wake.wait(available).unwrap_or_else(|e| e.into_inner()); }
        *available -= 1;
        Permit(self.clone())
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut available = self.0.available.lock().unwrap_or_else(|e| e.into_inner());
        *available += 1;
        self.0.wake.notify_one();
    }
}

/// Poll cadence: answers stay quick while agents are using desktop tools,
/// idle polling slows down in steps to 15 s (the caller keeps 2 s while a
/// provider session holds a conversation grant), and an unreachable or
/// unpaired host backs off to 30 s.
pub(super) fn next_poll_delay(failures: u32, since_request: std::time::Duration) -> std::time::Duration {
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

pub(crate) fn start_desktop_relay(app: AppHandle) {
    let mut failures = 0u32;
    let mut last_request = std::time::Instant::now();
    let observation_app = app.clone();
    std::thread::spawn(move || loop {
        static OBSERVATION: OnceLock<Arc<PhysicalSlots>> = OnceLock::new();
        let slots = OBSERVATION.get_or_init(|| Arc::new(PhysicalSlots::new(1)));
        if let Some(permit) = slots.try_acquire() {
            let app = observation_app.clone();
            std::thread::spawn(move || {
                let _permit = permit;
                if let Ok(channel) = crate::remote::NativeServiceChannel::connect(&app) {
                    let _ = assistant_observation_publisher::publish_from_primary_window(&app, &channel);
                }
            });
        }
        std::thread::sleep(std::time::Duration::from_secs(30));
    });
    std::thread::spawn(move || {
        static SLOTS: OnceLock<Arc<PhysicalSlots>> = OnceLock::new();
        let slots = SLOTS.get_or_init(|| Arc::new(PhysicalSlots::new(8))).clone();
        let mut channel: Option<Arc<crate::remote::NativeServiceChannel>> = None;
        loop {
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
                let reply = Arc::new(issuer.request("conversation.desktop.take", json!({}))?);
                let requests = reply.project(|requests| {
                    Ok(requests
                        .as_array()
                        .map(|requests| requests.to_vec())
                        .unwrap_or_default())
                })?;
                Ok((issuer, reply, requests))
            });
            failures = if taken.is_ok() {
                0
            } else {
                failures.saturating_add(1)
            };
            if let Ok((issuer, taken, requests)) = taken {
                if !requests.is_empty() {
                    last_request = std::time::Instant::now();
                }
                for request in requests {
                    let app = app.clone();
                    let issuer = issuer.clone();
                    let taken = taken.clone();
                    let permit = slots.acquire();
                    std::thread::spawn(move || {
                        let _permit = permit;
                        let result = execute_desktop_request(&app, &request, &issuer, &taken);
                        let reply = match &result {
                            Ok(outcome) => outcome.finish_payload(&request["id"], &taken),
                            Err(error) => {
                                taken.project(|_| Ok(json!({"id": request["id"], "error": error})))
                            }
                        };
                        // A completed job is returned only to its original issuer.
                        // Preparation admits this bounded original forwarding;
                        // all original replies remain owned through settlement.
                        if let Ok(reply) = reply {
                            let _ =
                                issuer.project("conversation.desktop.finish", reply, |_| Ok(()));
                        }
                        drop(result);
                    });
                }
            }
            let session_active = grants().lock().map(|map| !map.is_empty()).unwrap_or(true);
            let mut delay = next_poll_delay(failures, last_request.elapsed());
            if failures == 0 && session_active {
                delay = delay.min(std::time::Duration::from_secs(2));
            }
            std::thread::sleep(delay);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_slots_remain_held_until_work_exits() {
        let slots = Arc::new(PhysicalSlots::new(1));
        let permit = slots.acquire();
        assert!(slots.try_acquire().is_none());
        let clone = slots.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || { let _permit = clone.acquire(); sent.send(()).unwrap(); });
        assert!(received.try_recv().is_err());
        drop(permit);
        received.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        thread.join().unwrap();
    }
}
