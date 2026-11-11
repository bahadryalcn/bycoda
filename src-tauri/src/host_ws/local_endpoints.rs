//! Routes that dial the Host on this computer, and how quickly they redial it.
//!
//! The set holds the saved direct loopback machines only. An SSH forward also
//! listens on loopback, but it belongs to a remote machine and is never listed.
use serde_json::Value;
use std::{sync::Mutex, time::Duration};
use url::Url;

/// Longest wait before redialling the Host on this computer. It binds its port
/// last, so the refusals during its start would otherwise grow the backoff to
/// the remote maximum and leave a listening Host unconnected for that long.
const LOCAL_MAX_DELAY_MS: u64 = 5_000;

struct LocalEndpoints(Mutex<Vec<String>>);

static SAVED: LocalEndpoints = LocalEndpoints(Mutex::new(Vec::new()));

/// `host:port` of a loopback endpoint, shared by its HTTP and WebSocket spelling.
fn authority(endpoint: &str) -> Option<String> {
    let url = Url::parse(endpoint).ok()?;
    if !super::loopback(&url) {
        return None;
    }
    Some(format!(
        "{}:{}",
        url.host_str()?,
        url.port_or_known_default()?
    ))
}

impl LocalEndpoints {
    fn replace<'a>(&self, endpoints: impl IntoIterator<Item = &'a str>) {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            endpoints.into_iter().filter_map(authority).collect();
    }

    fn contains(&self, endpoint: &str) -> bool {
        authority(endpoint).is_some_and(|authority| {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .contains(&authority)
        })
    }
}

/// Replaces the set with the endpoints of the saved direct machines.
pub(crate) fn replace<'a>(endpoints: impl IntoIterator<Item = &'a str>) {
    SAVED.replace(endpoints);
}

/// Whether an endpoint, in either spelling, dials the Host on this computer.
pub(crate) fn contains(endpoint: &str) -> bool {
    SAVED.contains(endpoint)
}

/// Full-jitter exponential backoff from the generated retry policy. A `local`
/// route uses the short cap and never waits less than the initial delay, so a
/// refusing loopback port is redialled a few times per cap, never in a loop.
pub(super) fn retry_delay(policy: &Value, attempts: u32, random: u64, local: bool) -> Duration {
    let initial = policy["initialDelayMs"].as_u64().unwrap_or(250);
    let maximum = policy["maxDelayMs"].as_u64().unwrap_or(30_000);
    let mut cap = initial
        .saturating_mul(1u64.checked_shl(attempts.min(20)).unwrap_or(u64::MAX))
        .min(maximum);
    if local {
        cap = cap.min(LOCAL_MAX_DELAY_MS);
    }
    let jitter = random % cap.saturating_add(1);
    Duration::from_millis(if local {
        jitter.max(initial.min(cap))
    } else {
        jitter
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_saved_loopback_endpoints_dial_this_computer_in_either_spelling() {
        let saved = LocalEndpoints(Mutex::new(Vec::new()));
        saved.replace(["http://127.0.0.1:3776", "https://host.example"]);
        assert!(saved.contains("http://127.0.0.1:3776"));
        assert!(saved.contains("ws://127.0.0.1:3776/ws"));
        // Another loopback port is an SSH forward to a remote machine.
        assert!(!saved.contains("http://127.0.0.1:50123"));
        assert!(!saved.contains("https://host.example"));
        assert!(!saved.contains("not a url"));
        saved.replace(std::iter::empty::<&str>());
        assert!(!saved.contains("http://127.0.0.1:3776"));
    }

    #[test]
    fn local_redial_stays_within_its_short_cap_and_never_spins() {
        let policy = json!({"initialDelayMs":250,"maxDelayMs":30_000});
        for attempts in [0, 1, 5, 20, u32::MAX] {
            for random in [0, 1, 249, 4_999, 5_000, 29_999, u64::MAX] {
                let delay = retry_delay(&policy, attempts, random, true);
                assert!(delay >= Duration::from_millis(250), "{attempts}/{random}");
                assert!(delay <= Duration::from_millis(5_000), "{attempts}/{random}");
            }
        }
    }

    #[test]
    fn remote_redial_keeps_the_full_jitter_policy() {
        let policy = json!({"initialDelayMs":250,"maxDelayMs":30_000});
        assert_eq!(retry_delay(&policy, 0, 0, false), Duration::ZERO);
        assert_eq!(
            retry_delay(&policy, 0, 250, false),
            Duration::from_millis(250)
        );
        assert_eq!(
            retry_delay(&policy, 20, 30_000, false),
            Duration::from_millis(30_000)
        );
        assert_eq!(
            retry_delay(&policy, 20, 29_999, false),
            Duration::from_millis(29_999)
        );
        assert_eq!(retry_delay(&policy, 20, 30_001, false), Duration::ZERO);
    }
}
