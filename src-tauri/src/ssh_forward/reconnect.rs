//! Restarts a port forward whose ssh process exited without the user asking.
//!
//! The ladder mirrors the saved-machine reconnect: 2 s doubling to 5 minutes,
//! jittered, restarting only after a connection stayed up for 30 s. A restart
//! never loosens what the first start proved: the endpoint is resolved again
//! (host-key trust and authentication stay in OpenSSH with `BatchMode=yes`),
//! must produce the identical forward identity, and needs no new approval.
//! Anything else stops at `failed` for the user to start again. An explicit
//! stop removes the registry entry, so a waiting restart finds nothing to revive.
use super::events::{matches_generation, publish};
use super::*;
use std::sync::atomic::Ordering;

const BASE: Duration = Duration::from_secs(2);
const MAX: Duration = Duration::from_secs(5 * 60);
/// The ladder starts again only after a process stayed up this long.
pub(super) const STABLE: Duration = Duration::from_secs(30);
/// Consecutive unstable restarts before the forward is left `failed`.
const MAX_ATTEMPTS: u32 = 12;
const SLICE: Duration = Duration::from_millis(250);

/// Wait before restart number `attempt` (0 is the first): exponential to
/// `MAX`, jittered between half and all of it so forwards behind one
/// restarted network do not all dial in the same second.
pub(super) fn delay(attempt: u32, jitter: f64) -> Duration {
    let ceiling = (BASE.as_millis() as u64)
        .saturating_mul(1u64 << attempt.min(20))
        .min(MAX.as_millis() as u64);
    Duration::from_millis(ceiling / 2 + (ceiling as f64 / 2.0 * jitter.clamp(0.0, 1.0)) as u64)
}

fn jitter() -> f64 {
    uuid::Uuid::new_v4().as_u128() as f64 / u128::MAX as f64
}

/// Host-key and authentication failures are decisions for the user, never
/// something to retry in the background.
pub(super) fn is_terminal(detail: &str) -> bool {
    let detail = detail.to_ascii_lowercase();
    [
        "host key verification failed",
        "remote host identification has changed",
        "no matching host key type",
        "permission denied",
        "too many authentication failures",
        "authentication failed",
    ]
    .iter()
    .any(|marker| detail.contains(marker))
}

pub(super) enum Attempt {
    /// Stopped, replaced or its window closed: nothing left to restart.
    Gone,
    /// Failed this time; the next rung of the ladder tries again.
    Retry(String),
    /// Must not be retried without the user.
    Terminal(String),
}

pub(super) struct Prepared {
    pub args: Vec<String>,
    pub jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
}

/// Re-resolves the saved endpoint and proves it is the forward the user started.
fn prepare(
    app: &AppHandle,
    connection_id: &str,
    identity: &str,
    local_port: u16,
    target_host: &str,
    target_port: u16,
    kind: &str,
) -> Result<Prepared, String> {
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(app, connection_id)?;
    // Proxy credentials are approved per start and consumed, so they cannot be replayed.
    if endpoint.http_proxy.is_some() {
        return Err("This route needs a new proxy approval. Start the forward again.".into());
    }
    let args = forward_args_kind(&endpoint, local_port, target_host, target_port, kind)?;
    let stable = crate::ssh_security::stable_args(&endpoint, &args);
    if forward_identity(connection_id, &stable)? != identity {
        return Err("The SSH target changed since this forward started. Start it again.".into());
    }
    Ok(Prepared {
        args,
        jump_config: endpoint.prepared_jump_config.clone(),
    })
}

/// The entry is still the failed generation waiting for its restart.
fn waiting(state: &SshForwards, id: &str, owner: &ForwardOwner, generation: uuid::Uuid) -> bool {
    state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .is_some_and(|live| {
            matches_generation(live, owner, generation)
                && !live.stopping
                && live.status.state == "reconnecting"
        })
}

/// Sleeps the rung, ending early when focus or the network returns. `false`
/// means the forward was stopped, replaced or lost its window meanwhile.
fn wait(
    state: &SshForwards,
    id: &str,
    owner: &ForwardOwner,
    generation: uuid::Uuid,
    rung: Duration,
) -> bool {
    let seen = state.nudge.load(Ordering::Relaxed);
    let end = Instant::now() + rung;
    loop {
        if !waiting(state, id, owner, generation) {
            return false;
        }
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() || state.nudge.load(Ordering::Relaxed) != seen {
            return true;
        }
        std::thread::sleep(left.min(SLICE));
    }
}

/// Leaves the entry `failed` and tells the window, unless it is already gone.
fn fail(
    state: &SshForwards,
    id: &str,
    owner: &ForwardOwner,
    generation: uuid::Uuid,
    error: String,
) -> bool {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let Some(live) = sessions
        .get_mut(id)
        .filter(|live| matches_generation(live, owner, generation) && !live.stopping)
    else {
        return false;
    };
    live.status.state = "failed".into();
    live.status.error = Some(error);
    true
}

/// One restart: spawn into the existing entry under a new generation, wait for
/// the listener, and on failure put the entry back to `reconnecting`. Spawning
/// and the state change share the lock an explicit stop needs, so a stop either
/// lands first (nothing is spawned) or takes the new child.
pub(super) fn restart(
    state: &SshForwards,
    owner: &ForwardOwner,
    id: &str,
    generation: uuid::Uuid,
    prepared: Prepared,
    spawn: impl FnOnce(Vec<String>) -> Result<(Child, Arc<Mutex<String>>), String>,
) -> Result<uuid::Uuid, Attempt> {
    let next = uuid::Uuid::new_v4();
    let address = owner
        .with_live(|| {
            let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let Some(live) = sessions.get_mut(id).filter(|live| {
                matches_generation(live, owner, generation)
                    && !live.stopping
                    && live.status.state == "reconnecting"
            }) else {
                return Ok(None);
            };
            let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), live.status.local_port);
            if TcpListener::bind(address).is_err() {
                return Ok(Some(Err(Attempt::Retry(
                    "Local port is already in use".into(),
                ))));
            }
            let (child, stderr) = match spawn(prepared.args) {
                Ok(spawned) => spawned,
                Err(error) => return Ok(Some(Err(Attempt::Retry(error)))),
            };
            live.child = Some(child);
            live.stderr = stderr;
            live._jump_config = prepared.jump_config;
            live.generation = next;
            live.status.state = "starting".into();
            live.status.error = None;
            Ok(Some(Ok(address)))
        })
        .ok()
        .flatten()
        .ok_or(Attempt::Gone)??;
    match await_listener(state, id, next, address) {
        Ok(_) => Ok(next),
        Err(ListenerEnd::Cancelled) => Err(Attempt::Gone),
        Err(end) => {
            let detail = match end {
                ListenerEnd::Exited(detail) => detail,
                _ => "SSH forwarding timed out before opening the loopback listener".into(),
            };
            let message = format!("SSH forwarding process exited{detail}");
            // Back to the failed generation, so the ladder keeps following this entry.
            let child = {
                let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
                let Some(live) = sessions
                    .get_mut(id)
                    .filter(|live| live.generation == next && !live.stopping)
                else {
                    return Err(Attempt::Gone);
                };
                live.generation = generation;
                live.status.state = "reconnecting".into();
                live.status.error = Some(message.clone());
                live.child.take()
            };
            if reap_child(child).is_err() {
                let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(live) = sessions
                    .get_mut(id)
                    .filter(|live| live.generation == generation)
                {
                    live.status.state = "unknown".into();
                    live.status.error = Some(
                        "Forward stop could not be confirmed. Retry stop before starting again."
                            .into(),
                    );
                }
                return Err(Attempt::Gone);
            }
            Err(if is_terminal(&detail) {
                Attempt::Terminal(message)
            } else {
                Attempt::Retry(message)
            })
        }
    }
}

/// Runs the ladder for one failed forward. Returns the new running generation
/// to keep watching, or `None` when the forward ended (stopped, failed for good).
pub(super) fn recover(
    app: &AppHandle,
    window: &str,
    connection_id: &str,
    id: &str,
    generation: uuid::Uuid,
    owner: &ForwardOwner,
    attempts: &mut u32,
) -> Option<uuid::Uuid> {
    let state = app.state::<SshForwards>();
    let changed = |generation| publish(app, window, connection_id, id, generation, owner);
    loop {
        if *attempts >= MAX_ATTEMPTS {
            let error = format!("SSH forwarding stopped after {MAX_ATTEMPTS} reconnect attempts");
            if fail(&state, id, owner, generation, error) {
                changed(generation);
            }
            return None;
        }
        if !wait(&state, id, owner, generation, delay(*attempts, jitter())) {
            return None;
        }
        *attempts += 1;
        let snapshot = state
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .filter(|live| matches_generation(live, owner, generation))
            .map(|live| {
                (
                    live.identity.clone(),
                    live.status.local_port,
                    live.status.target_host.clone(),
                    live.status.target_port,
                    live.status.kind.clone(),
                )
            })?;
        let outcome = match prepare(
            app,
            connection_id,
            &snapshot.0,
            snapshot.1,
            &snapshot.2,
            snapshot.3,
            &snapshot.4,
        ) {
            Ok(prepared) => restart(&state, owner, id, generation, prepared, |args| {
                spawn_forward(args, None)
            }),
            Err(error) => Err(Attempt::Terminal(error)),
        };
        match outcome {
            Ok(next) => {
                changed(next);
                return Some(next);
            }
            Err(Attempt::Gone) => return None,
            Err(Attempt::Terminal(error)) => {
                if fail(&state, id, owner, generation, error) {
                    changed(generation);
                }
                return None;
            }
            Err(Attempt::Retry(error)) => {
                if let Some(live) = state
                    .sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get_mut(id)
                    .filter(|live| matches_generation(live, owner, generation))
                {
                    live.status.error = Some(error);
                }
                changed(generation);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn long_child() -> Child {
        #[cfg(windows)]
        let mut command = Command::new("powershell");
        #[cfg(windows)]
        command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
        #[cfg(not(windows))]
        let mut command = Command::new("sleep");
        #[cfg(not(windows))]
        command.arg("30");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }

    fn short_child() -> Child {
        #[cfg(windows)]
        let mut command = Command::new("cmd");
        #[cfg(windows)]
        command.args(["/C", "exit 1"]);
        #[cfg(not(windows))]
        let mut command = Command::new("sh");
        #[cfg(not(windows))]
        command.args(["-c", "exit 1"]);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    /// A forward whose process died: the watcher left it waiting to restart.
    fn waiting_forward(
        state: &SshForwards,
        window: &str,
        id: &str,
        local_port: u16,
    ) -> (ForwardOwner, uuid::Uuid) {
        let owner = crate::ssh_window_lifecycle::register(window).unwrap();
        let generation = uuid::Uuid::new_v4();
        state.sessions.lock().unwrap().insert(
            id.into(),
            LiveForward {
                _http_proxy: None,
                _jump_config: None,
                generation,
                owner: window.into(),
                owner_lease: owner.clone(),
                identity: "fixture".into(),
                child: None,
                stderr: Default::default(),
                stopping: false,
                auto_reconnect: true,
                status: ForwardStatus {
                    id: id.into(),
                    connection_id: "server".into(),
                    local_port,
                    kind: "local".into(),
                    target_host: "localhost".into(),
                    target_port: 22,
                    state: "reconnecting".into(),
                    error: Some("SSH forwarding process exited".into()),
                },
            },
        );
        (owner, generation)
    }

    fn prepared() -> Prepared {
        Prepared {
            args: Vec::new(),
            jump_config: None,
        }
    }

    #[test]
    fn ladder_doubles_from_two_seconds_to_five_minutes_with_jitter() {
        assert_eq!(delay(0, 1.0), Duration::from_secs(2));
        assert_eq!(delay(0, 0.0), Duration::from_secs(1));
        assert_eq!(delay(1, 1.0), Duration::from_secs(4));
        assert_eq!(delay(3, 1.0), Duration::from_secs(16));
        for attempt in [8, 9, 20, 200] {
            assert_eq!(delay(attempt, 1.0), Duration::from_secs(300));
            assert_eq!(delay(attempt, 0.0), Duration::from_secs(150));
        }
        assert_eq!(delay(2, 7.0), delay(2, 1.0));
    }

    #[test]
    fn host_key_and_authentication_failures_are_never_retried() {
        for detail in [
            "\nHost key verification failed.",
            "REMOTE HOST IDENTIFICATION HAS CHANGED! @",
            "\nuser@host: Permission denied (publickey).",
            "Too many authentication failures",
        ] {
            assert!(is_terminal(detail), "{detail}");
        }
        for detail in [
            "",
            "\nssh: connect to host h port 22: Network is unreachable",
            "\nConnection timed out during banner exchange",
            "\nssh: Could not resolve hostname h",
            "Connection reset by peer",
        ] {
            assert!(!is_terminal(detail), "{detail}");
        }
    }

    #[test]
    fn restart_revives_the_waiting_forward_under_a_new_generation() {
        let state = SshForwards::default();
        let port = free_port();
        let (owner, generation) = waiting_forward(&state, "reconnect-revive", "rule", port);
        // Another program already holds the forward's local port.
        let busy = TcpListener::bind(("127.0.0.1", port)).unwrap();
        let outcome = restart(&state, &owner, "rule", generation, prepared(), |_| {
            panic!("a busy local port must not spawn")
        });
        assert!(matches!(outcome, Err(Attempt::Retry(_))));
        drop(busy);

        // The stub process stands in for ssh by holding the loopback listener.
        let holder = std::sync::Arc::new(std::sync::Mutex::new(None));
        let hold = holder.clone();
        let next = restart(&state, &owner, "rule", generation, prepared(), move |_| {
            *hold.lock().unwrap() = Some(TcpListener::bind(("127.0.0.1", port)).unwrap());
            Ok((long_child(), Default::default()))
        })
        .ok()
        .expect("restart reaches a running listener");
        assert_ne!(next, generation);
        let sessions = state.sessions.lock().unwrap();
        let live = sessions.get("rule").unwrap();
        assert_eq!(live.generation, next);
        assert_eq!(live.status.state, "running");
        assert!(live.status.error.is_none() && live.child.is_some());
        drop(sessions);
        state.kill_all();
    }

    #[test]
    fn explicit_stop_while_waiting_is_never_resurrected() {
        let state = SshForwards::default();
        let (owner, generation) = waiting_forward(&state, "reconnect-stopped", "rule", free_port());
        assert!(waiting(&state, "rule", &owner, generation));
        stop_owned(&state, "reconnect-stopped", "rule").unwrap();
        assert!(!waiting(&state, "rule", &owner, generation));
        assert!(!wait(
            &state,
            "rule",
            &owner,
            generation,
            Duration::from_secs(60)
        ));
        let spawned = std::cell::Cell::new(false);
        let outcome = restart(&state, &owner, "rule", generation, prepared(), |_| {
            spawned.set(true);
            Ok((long_child(), Default::default()))
        });
        assert!(matches!(outcome, Err(Attempt::Gone)));
        assert!(!spawned.get(), "a stopped forward must not spawn again");
        assert!(state.sessions.lock().unwrap().get("rule").is_none());
    }

    #[test]
    fn a_new_start_with_the_same_id_ends_the_old_wait() {
        let state = SshForwards::default();
        let (owner, generation) = waiting_forward(&state, "reconnect-replaced", "rule", 1);
        state
            .sessions
            .lock()
            .unwrap()
            .get_mut("rule")
            .unwrap()
            .generation = uuid::Uuid::new_v4();
        assert!(!waiting(&state, "rule", &owner, generation));
        assert!(matches!(
            restart(&state, &owner, "rule", generation, prepared(), |_| {
                panic!("the replaced generation must not spawn")
            }),
            Err(Attempt::Gone)
        ));
    }

    #[test]
    fn nudge_cuts_the_wait_short_and_a_closed_window_ends_it() {
        let state = std::sync::Arc::new(SshForwards::default());
        let (owner, generation) = waiting_forward(&state, "reconnect-nudged", "rule", 1);
        let nudger = state.clone();
        let started = Instant::now();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            nudger.nudge.fetch_add(1, Ordering::Relaxed);
        });
        assert!(wait(
            &state,
            "rule",
            &owner,
            generation,
            Duration::from_secs(60)
        ));
        handle.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(10));
        crate::ssh_window_lifecycle::close("reconnect-nudged");
        assert!(!waiting(&state, "rule", &owner, generation));
    }

    #[test]
    fn a_failed_restart_goes_back_to_waiting_and_classifies_the_failure() {
        for (stderr, terminal) in [
            ("", false),
            (
                "\nssh: connect to host h port 22: Network is unreachable",
                false,
            ),
            ("\nHost key verification failed.", true),
        ] {
            let state = SshForwards::default();
            let (owner, generation) =
                waiting_forward(&state, "reconnect-failed", "rule", free_port());
            let sink: Arc<Mutex<String>> = Arc::new(Mutex::new(stderr.into()));
            let outcome = restart(&state, &owner, "rule", generation, prepared(), |_| {
                Ok((short_child(), sink))
            });
            match outcome {
                Err(Attempt::Terminal(_)) => assert!(terminal, "{stderr}"),
                Err(Attempt::Retry(_)) => assert!(!terminal, "{stderr}"),
                _ => panic!("a process that exits before listening must fail the attempt"),
            }
            let sessions = state.sessions.lock().unwrap();
            let live = sessions.get("rule").unwrap();
            assert_eq!(live.status.state, "reconnecting");
            assert_eq!(live.generation, generation);
            assert!(live.child.is_none() && !live.stopping);
        }
    }
}
