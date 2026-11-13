//! Health of each Host HTTP endpoint: rate-limited transport diagnostics and
//! the wait for the Host on this computer while it restarts.
//!
//! Only a refused TCP connect is waited out, because it proves the request was
//! never delivered. The wait ends at the request's original deadline, and a
//! request that was sent is never sent again.
use crate::host_ws::{diagnostics::identifier, local_endpoints};
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Refusal text for the Host on this computer. Consumers match the
/// "Machine is unreachable" prefix it shares with `CONNECTION_REFUSED`.
pub(super) const LOCAL_HOST_REFUSED: &str =
    "Machine is unreachable. bycoda Host on this computer is not answering; it may still be starting or it is stopped.";

/// The Host binds its port last, up to about 30 s after its process starts.
/// A Host that still refuses after this window is treated as stopped, and
/// requests to it fail at once again.
const RESTART_WINDOW: Duration = Duration::from_secs(45);
const PROBE_INTERVAL: Duration = Duration::from_millis(250);
/// An unreachable Host fails every request; the log gets one line per interval.
const WARN_INTERVAL: Duration = Duration::from_secs(30);
/// SSH forwards take a new loopback port on every reconnect.
const MAX_ENDPOINTS: usize = 64;

#[derive(Default)]
struct Health {
    /// Answered at least once in this process.
    reached: bool,
    /// First refusal since it last answered.
    down_since: Option<Instant>,
    warned_at: Option<Instant>,
    /// Failures since the last warning that were not logged.
    unlogged: u32,
}

#[derive(Default)]
struct TransportHealth {
    endpoints: Mutex<HashMap<String, Health>>,
}

fn health() -> &'static TransportHealth {
    static HEALTH: OnceLock<TransportHealth> = OnceLock::new();
    HEALTH.get_or_init(TransportHealth::default)
}

/// One HTTP request to a Host endpoint, measured from its first attempt.
pub(super) struct Exchange<'a> {
    endpoint: &'a str,
    environment_id: Option<&'a str>,
    method: &'a str,
    started: Instant,
    timeout: Duration,
}

impl<'a> Exchange<'a> {
    pub(super) fn new(
        endpoint: &'a str,
        environment_id: Option<&'a str>,
        method: &'a str,
        timeout: Duration,
    ) -> Self {
        Self {
            endpoint,
            environment_id,
            method,
            started: Instant::now(),
            timeout,
        }
    }

    /// Runs `attempt` with the time left before the original deadline. It runs
    /// again only after an attempt that was refused before anything was sent.
    pub(super) fn send(
        &self,
        attempt: impl FnMut(Duration) -> Result<ureq::Response, Box<ureq::Error>>,
    ) -> Result<ureq::Response, Box<ureq::Transport>> {
        health().send(
            self,
            || local_endpoints::contains(self.endpoint),
            |deadline| listening(self.endpoint, deadline),
            attempt,
        )
    }

    /// Records a transport failure that happened after the request was sent.
    pub(super) fn failed(&self, error: &ureq::Transport) {
        health().failed(self, error);
    }

    pub(super) fn refused_message(&self) -> &'static str {
        if local_endpoints::contains(self.endpoint) {
            LOCAL_HOST_REFUSED
        } else {
            super::CONNECTION_REFUSED
        }
    }

    /// Log fields that identify the machine without its address or credential.
    fn target(&self) -> String {
        format!(
            "environment={} local={}",
            self.environment_id
                .map_or_else(|| "-".to_owned(), identifier),
            local_endpoints::contains(self.endpoint)
        )
    }
}

/// Whether the Host on this computer refused its latest connection attempt.
pub(crate) fn local_host_refusing() -> bool {
    let refusing: Vec<String> = health()
        .endpoints
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .filter(|(_, health)| health.down_since.is_some())
        .map(|(endpoint, _)| endpoint.clone())
        .collect();
    refusing
        .iter()
        .any(|endpoint| local_endpoints::contains(endpoint))
}

/// Whether the endpoint's port accepts a TCP connection before `deadline`.
fn listening(endpoint: &str, deadline: Instant) -> bool {
    let Some(addresses) = url::Url::parse(endpoint)
        .ok()
        .and_then(|url| url.socket_addrs(|| None).ok())
    else {
        return false;
    };
    addresses.iter().any(|address| {
        let remaining = deadline.saturating_duration_since(Instant::now());
        !remaining.is_zero() && TcpStream::connect_timeout(address, remaining).is_ok()
    })
}

/// The I/O or transport kind only: ureq's own text can hold URLs and credentials.
fn class(error: &ureq::Transport) -> String {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(cause) = source {
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            return format!("{:?}", io.kind());
        }
        source = cause.source();
    }
    format!("{:?}", error.kind())
}

impl TransportHealth {
    fn with<T>(&self, endpoint: &str, update: impl FnOnce(&mut Health) -> T) -> T {
        let mut endpoints = self
            .endpoints
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(health) = endpoints.get_mut(endpoint) {
            return update(health);
        }
        if endpoints.len() >= MAX_ENDPOINTS {
            endpoints.clear();
        }
        update(endpoints.entry(endpoint.to_owned()).or_default())
    }

    fn reached(&self, exchange: &Exchange<'_>) {
        let recovered = self.with(exchange.endpoint, |health| {
            health.reached = true;
            health
                .down_since
                .take()
                .map(|since| (since.elapsed(), std::mem::take(&mut health.unlogged)))
        });
        if let Some((outage, unlogged)) = recovered {
            log::info!(
                "host http reachable again {} outage_ms={} unlogged_failures={unlogged}",
                exchange.target(),
                outage.as_millis()
            );
        }
    }

    /// One warning when an endpoint starts refusing, then one per interval.
    fn failed(&self, exchange: &Exchange<'_>, error: &ureq::Transport) {
        let now = Instant::now();
        let refused = super::connection_refused(error);
        let unlogged = self.with(exchange.endpoint, |health| {
            let went_down = refused && health.down_since.is_none();
            if went_down {
                health.down_since = Some(now);
            }
            if went_down
                || health
                    .warned_at
                    .is_none_or(|at| now.duration_since(at) >= WARN_INTERVAL)
            {
                health.warned_at = Some(now);
                Some(std::mem::take(&mut health.unlogged))
            } else {
                health.unlogged = health.unlogged.saturating_add(1);
                None
            }
        });
        if let Some(unlogged) = unlogged {
            log::warn!(
                "host http request failed {} method={} class={} elapsed_ms={} unlogged_failures={unlogged}",
                exchange.target(),
                identifier(exchange.method),
                class(error),
                exchange.started.elapsed().as_millis()
            );
        }
    }

    /// The endpoint answered earlier in this process and has not refused for
    /// longer than a Host start takes.
    fn may_be_restarting(&self, endpoint: &str) -> bool {
        self.with(endpoint, |health| {
            health.reached
                && health
                    .down_since
                    .is_none_or(|since| since.elapsed() < RESTART_WINDOW)
        })
    }

    fn attempt(
        &self,
        exchange: &Exchange<'_>,
        timeout: Duration,
        attempt: &mut impl FnMut(Duration) -> Result<ureq::Response, Box<ureq::Error>>,
    ) -> Result<ureq::Response, Box<ureq::Transport>> {
        match attempt(timeout).map_err(|error| *error) {
            Ok(response) | Err(ureq::Error::Status(_, response)) => {
                self.reached(exchange);
                Ok(response)
            }
            Err(ureq::Error::Transport(error)) => Err(Box::new(error)),
        }
    }

    fn send(
        &self,
        exchange: &Exchange<'_>,
        local: impl FnOnce() -> bool,
        listening: impl Fn(Instant) -> bool,
        mut attempt: impl FnMut(Duration) -> Result<ureq::Response, Box<ureq::Error>>,
    ) -> Result<ureq::Response, Box<ureq::Transport>> {
        let refusal = match self.attempt(exchange, exchange.timeout, &mut attempt) {
            Ok(response) => return Ok(response),
            Err(error) => error,
        };
        self.failed(exchange, &refusal);
        if !super::connection_refused(&refusal)
            || !self.may_be_restarting(exchange.endpoint)
            || !local()
        {
            return Err(refusal);
        }
        // Nothing was delivered by the refused attempt. Probe the port and send
        // the request for the first time once it accepts connections.
        let deadline = exchange.started + exchange.timeout;
        loop {
            if !self.may_be_restarting(exchange.endpoint) {
                return Err(refusal);
            }
            let accepts = listening(deadline);
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(refusal);
            }
            if accepts {
                match self.attempt(exchange, remaining, &mut attempt) {
                    Ok(response) => return Ok(response),
                    // The port closed again before this request reached it.
                    Err(error) if super::connection_refused(&error) => {}
                    Err(error) => {
                        self.failed(exchange, &error);
                        return Err(error);
                    }
                }
            }
            std::thread::sleep(
                PROBE_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn refused() -> Box<ureq::Error> {
        Box::new(ureq::Error::from(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "http://user:secret@host",
        )))
    }

    fn answered() -> Result<ureq::Response, Box<ureq::Error>> {
        ureq::Response::new(200, "OK", "{}").map_err(Box::new)
    }

    fn exchange(endpoint: &str, timeout: Duration) -> Exchange<'_> {
        Exchange::new(endpoint, Some("host.1"), "environment.describe", timeout)
    }

    /// An endpoint that answered once, as the Host did before it restarted.
    fn reached(health: &TransportHealth, endpoint: &str) {
        health
            .send(
                &exchange(endpoint, Duration::from_secs(1)),
                || true,
                |_| true,
                |_| answered(),
            )
            .unwrap();
    }

    #[test]
    fn a_refused_local_request_waits_for_the_restarted_host_and_is_sent_once() {
        let health = TransportHealth::default();
        let endpoint = "http://127.0.0.1:3776";
        reached(&health, endpoint);
        let attempts = Cell::new(0);
        let probes = Cell::new(0);
        let timeout = Duration::from_secs(5);
        let response = health.send(
            &exchange(endpoint, timeout),
            || true,
            |_| {
                probes.set(probes.get() + 1);
                probes.get() >= 3
            },
            |remaining| {
                attempts.set(attempts.get() + 1);
                assert!(remaining <= timeout);
                if attempts.get() == 1 {
                    Err(refused())
                } else {
                    answered()
                }
            },
        );
        assert_eq!(response.unwrap().status(), 200);
        // The refused attempt delivered nothing; the request went out once.
        assert_eq!(attempts.get(), 2);
        assert_eq!(probes.get(), 3);
        assert!(!health.with(endpoint, |health| health.down_since.is_some()));
    }

    #[test]
    fn the_wait_ends_at_the_original_deadline_with_the_refusal() {
        let health = TransportHealth::default();
        let endpoint = "http://127.0.0.1:3776";
        reached(&health, endpoint);
        let attempts = Cell::new(0);
        let timeout = Duration::from_millis(400);
        let started = Instant::now();
        let error = health
            .send(
                &exchange(endpoint, timeout),
                || true,
                |_| false,
                |_| {
                    attempts.set(attempts.get() + 1);
                    Err(refused())
                },
            )
            .unwrap_err();
        assert!(super::super::connection_refused(&error));
        assert_eq!(attempts.get(), 1);
        assert!(started.elapsed() >= timeout);
        assert!(started.elapsed() < timeout + Duration::from_secs(2));
    }

    #[test]
    fn remote_and_never_reached_endpoints_fail_at_once_without_probing() {
        let health = TransportHealth::default();
        let endpoint = "http://127.0.0.1:50123";
        let probe = |_: Instant| -> bool { panic!("A remote machine was probed") };
        // An SSH forward that answered before is still not this computer's Host.
        reached(&health, endpoint);
        let started = Instant::now();
        assert!(health
            .send(
                &exchange(endpoint, Duration::from_secs(30)),
                || false,
                probe,
                |_| Err(refused()),
            )
            .is_err());
        // A local Host that never answered in this process is stopped, not restarting.
        assert!(health
            .send(
                &exchange("http://127.0.0.1:3776", Duration::from_secs(30)),
                || true,
                probe,
                |_| Err(refused()),
            )
            .is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_host_refusing_longer_than_a_start_takes_fails_at_once() {
        let health = TransportHealth::default();
        let endpoint = "http://127.0.0.1:3776";
        reached(&health, endpoint);
        let Some(long_ago) = Instant::now().checked_sub(RESTART_WINDOW + Duration::from_secs(1))
        else {
            return;
        };
        health.with(endpoint, |health| health.down_since = Some(long_ago));
        let started = Instant::now();
        assert!(health
            .send(
                &exchange(endpoint, Duration::from_secs(30)),
                || true,
                |_| panic!("A stopped Host was probed"),
                |_| Err(refused()),
            )
            .is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_request_that_may_have_been_delivered_is_never_sent_again() {
        let health = TransportHealth::default();
        let endpoint = "http://127.0.0.1:3776";
        reached(&health, endpoint);
        for kind in [
            std::io::ErrorKind::ConnectionReset,
            std::io::ErrorKind::TimedOut,
            std::io::ErrorKind::UnexpectedEof,
        ] {
            let attempts = Cell::new(0);
            let error = health
                .send(
                    &exchange(endpoint, Duration::from_secs(30)),
                    || true,
                    |_| panic!("A sent request was waited out"),
                    |_| {
                        attempts.set(attempts.get() + 1);
                        Err(Box::new(ureq::Error::from(std::io::Error::new(
                            kind, "lost",
                        ))))
                    },
                )
                .unwrap_err();
            assert_eq!(attempts.get(), 1);
            assert_eq!(class(&error), format!("{kind:?}"));
        }
        // After the wait, the first real send is final as well.
        let attempts = Cell::new(0);
        assert!(health
            .send(
                &exchange(endpoint, Duration::from_secs(30)),
                || true,
                |_| true,
                |_| {
                    attempts.set(attempts.get() + 1);
                    Err(if attempts.get() == 1 {
                        refused()
                    } else {
                        Box::new(ureq::Error::from(std::io::Error::new(
                            std::io::ErrorKind::ConnectionReset,
                            "lost",
                        )))
                    })
                },
            )
            .is_err());
        assert_eq!(attempts.get(), 2);
    }

    #[test]
    fn an_unreachable_host_logs_one_warning_per_interval() {
        let health = TransportHealth::default();
        let endpoint = "https://host.example";
        let fail = || {
            let ureq::Error::Transport(error) = *refused() else {
                unreachable!("An I/O error becomes a transport error")
            };
            health.failed(&exchange(endpoint, Duration::from_secs(1)), &error);
        };
        fail();
        assert!(health.with(endpoint, |health| health.warned_at.is_some()
            && health.unlogged == 0
            && health.down_since.is_some()));
        for _ in 0..50 {
            fail();
        }
        assert_eq!(health.with(endpoint, |health| health.unlogged), 50);
        let Some(earlier) = Instant::now().checked_sub(WARN_INTERVAL) else {
            return;
        };
        health.with(endpoint, |health| health.warned_at = Some(earlier));
        fail();
        assert_eq!(health.with(endpoint, |health| health.unlogged), 0);
    }

    #[test]
    fn the_local_refusal_names_no_ssh_tunnel_and_keeps_the_shared_prefix() {
        assert!(LOCAL_HOST_REFUSED.starts_with("Machine is unreachable"));
        assert!(!LOCAL_HOST_REFUSED.to_ascii_lowercase().contains("ssh"));
        assert!(crate::remote_routes::port_may_have_moved(
            LOCAL_HOST_REFUSED
        ));
        assert!(super::super::CONNECTION_REFUSED.starts_with("Machine is unreachable"));
    }

    #[test]
    fn diagnostics_name_only_the_error_kind() {
        let ureq::Error::Transport(error) = *refused() else {
            unreachable!("An I/O error becomes a transport error")
        };
        assert_eq!(class(&error), "ConnectionRefused");
    }

    #[test]
    fn a_boxed_authorization_rejection_preserves_the_response_without_retry() {
        let health = TransportHealth::default();
        let endpoint = "http://127.0.0.1:3776";
        let attempts = Cell::new(0);
        let response = health
            .send(
                &exchange(endpoint, Duration::from_secs(1)),
                || true,
                |_| panic!("An answered authorization rejection must not be probed"),
                |_| {
                    attempts.set(attempts.get() + 1);
                    Err(Box::new(ureq::Error::Status(
                        403,
                        ureq::Response::new(403, "Forbidden", "{\"authorized\":false}").unwrap(),
                    )))
                },
            )
            .unwrap();
        assert_eq!(attempts.get(), 1);
        assert_eq!(response.status(), 403);
        assert_eq!(response.into_string().unwrap(), "{\"authorized\":false}");
        assert!(health.with(endpoint, |health| health.reached
            && health.down_since.is_none()));
    }
}
