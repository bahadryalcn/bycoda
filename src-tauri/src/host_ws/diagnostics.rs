//! Connection lines for the desktop log. They carry route identifiers, the
//! connection generation, phase and category only: never the endpoint, the
//! bearer, request params or message bodies.
use super::NativeRoute;
use std::{fmt::Write, time::Duration};

/// What the log last recorded for one native pipe.
#[derive(Default)]
pub(super) struct Logged {
    phase: String,
    category: Option<String>,
    /// Redial attempts since the recorded line.
    retries: u32,
    /// A timeout was recorded since the pipe last left its retry loop.
    timeout: bool,
}

/// An identifier as one log token: no spaces, line breaks or control characters.
pub(crate) fn identifier(value: &str) -> String {
    value
        .chars()
        .take(80)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn route_fields(route: &NativeRoute, generation: u64) -> String {
    format!(
        "machine={} environment={} generation={generation}",
        identifier(&route.machine_id),
        identifier(&route.environment_id)
    )
}

impl Logged {
    /// The line for a state report, or `None` when it repeats the recorded
    /// state. A pipe that keeps failing reports `connecting` and the same
    /// `retry-wait` on every attempt: an unreachable Host records one line for
    /// the whole loop, and the next change says how many redials it took.
    pub(super) fn transition(
        &mut self,
        route: &NativeRoute,
        generation: u64,
        phase: &str,
        category: Option<&str>,
        retry_delay: Option<Duration>,
    ) -> Option<String> {
        if phase == "connecting" && self.phase == "retry-wait" {
            self.retries = self.retries.saturating_add(1);
            return None;
        }
        if self.phase == phase && self.category.as_deref() == category {
            return None;
        }
        let mut line = format!(
            "host connection {phase} {}",
            route_fields(route, generation)
        );
        if let Some(category) = category {
            let _ = write!(line, " category={category}");
        }
        if let Some(delay) = retry_delay {
            let _ = write!(line, " retry_in_ms={}", delay.as_millis());
        }
        if self.retries > 0 {
            let _ = write!(line, " retries={}", self.retries);
        }
        if phase != "retry-wait" {
            self.timeout = false;
        }
        self.phase = phase.into();
        self.category = category.map(str::to_owned);
        self.retries = 0;
        Some(line)
    }

    /// The warning for a handshake or heartbeat timeout: one per retry loop,
    /// because a hung Host times out again on every redial.
    pub(super) fn timed_out(
        &mut self,
        route: &NativeRoute,
        generation: u64,
        what: &str,
        elapsed: Duration,
    ) -> Option<String> {
        if std::mem::replace(&mut self.timeout, true) {
            return None;
        }
        Some(format!(
            "host connection {what} timed out {} elapsed_ms={}",
            route_fields(route, generation),
            elapsed.as_millis()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route() -> NativeRoute {
        NativeRoute::new(
            "machine.1",
            "host.1",
            "http://127.0.0.1:9",
            "bearer-secret",
            "principal-secret",
        )
        .unwrap()
    }

    #[test]
    fn each_state_change_is_one_line_and_a_retry_loop_is_not_repeated() {
        let route = route();
        let mut logged = Logged::default();
        assert_eq!(
            logged
                .transition(&route, 1, "connecting", None, None)
                .unwrap(),
            "host connection connecting machine=machine.1 environment=host.1 generation=1"
        );
        assert_eq!(
            logged.transition(&route, 1, "ready", None, None).unwrap(),
            "host connection ready machine=machine.1 environment=host.1 generation=1"
        );
        assert_eq!(
            logged
                .transition(
                    &route,
                    1,
                    "retry-wait",
                    Some("unavailable"),
                    Some(Duration::from_millis(180)),
                )
                .unwrap(),
            "host connection retry-wait machine=machine.1 environment=host.1 generation=1 category=unavailable retry_in_ms=180"
        );
        // An unreachable Host repeats this pair on every attempt.
        for generation in 2..40 {
            assert!(logged
                .transition(&route, generation, "connecting", None, None)
                .is_none());
            assert!(logged
                .transition(
                    &route,
                    generation,
                    "retry-wait",
                    Some("unavailable"),
                    Some(Duration::from_secs(30)),
                )
                .is_none());
        }
        assert!(logged
            .transition(&route, 40, "connecting", None, None)
            .is_none());
        assert_eq!(
            logged.transition(&route, 40, "ready", None, None).unwrap(),
            "host connection ready machine=machine.1 environment=host.1 generation=40 retries=39"
        );
    }

    #[test]
    fn a_changed_failure_category_and_a_repeated_blocked_state_are_distinguished() {
        let route = route();
        let mut logged = Logged::default();
        logged.transition(&route, 1, "connecting", None, None);
        assert!(logged
            .transition(&route, 1, "retry-wait", Some("unavailable"), None)
            .is_some());
        assert!(logged
            .transition(&route, 2, "connecting", None, None)
            .is_none());
        assert!(logged
            .transition(&route, 2, "retry-wait", Some("overload"), None)
            .unwrap()
            .ends_with("category=overload retries=1"));
        assert!(logged
            .transition(&route, 3, "blocked", Some("authentication"), None)
            .is_some());
        // A blocked pipe reports its state again for every refused request.
        assert!(logged
            .transition(&route, 3, "blocked", Some("authentication"), None)
            .is_none());
        assert!(logged.transition(&route, 3, "closed", None, None).is_some());
    }

    #[test]
    fn a_hung_host_records_one_timeout_per_retry_loop_with_its_elapsed_time() {
        let route = route();
        let mut logged = Logged::default();
        logged.transition(&route, 1, "connecting", None, None);
        assert_eq!(
            logged
                .timed_out(&route, 1, "handshake", Duration::from_millis(10_004))
                .unwrap(),
            "host connection handshake timed out machine=machine.1 environment=host.1 generation=1 elapsed_ms=10004"
        );
        logged.transition(&route, 1, "retry-wait", Some("unavailable"), None);
        logged.transition(&route, 2, "connecting", None, None);
        assert!(logged
            .timed_out(&route, 2, "handshake", Duration::from_secs(10))
            .is_none());
        logged.transition(&route, 3, "connecting", None, None);
        logged.transition(&route, 3, "ready", None, None);
        assert!(logged
            .timed_out(&route, 3, "heartbeat", Duration::from_secs(20))
            .is_some());
    }

    #[test]
    fn lines_never_carry_the_endpoint_credentials_or_raw_identifier_text() {
        let route = NativeRoute::new(
            "machine 1\nforged line",
            "host.1",
            "http://127.0.0.1:9",
            "bearer-secret",
            "principal-secret",
        )
        .unwrap();
        let mut logged = Logged::default();
        let line = logged
            .transition(&route, 1, "connecting", None, None)
            .unwrap();
        assert!(line.contains("machine=machine_1_forged_line "), "{line}");
        for secret in ["bearer-secret", "principal-secret", "127.0.0.1", "\n"] {
            assert!(!line.contains(secret), "{line}");
        }
    }
}
