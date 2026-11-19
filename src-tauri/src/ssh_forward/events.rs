use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Emitter;

static REVISION: AtomicU64 = AtomicU64::new(1);

pub(super) fn matches_generation(live: &LiveForward, owner: &ForwardOwner, generation: uuid::Uuid) -> bool {
    live.generation == generation && live.owner_lease.same_generation(owner) && owner.is_alive()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForwardChanged {
    machine: &'static str,
    connection_id: String,
    forward_id: String,
    generation: String,
    revision: u64,
}

pub(super) fn publish(
    app: &AppHandle,
    window: &str,
    connection_id: &str,
    id: &str,
    generation: uuid::Uuid,
    owner: &ForwardOwner,
) {
    let event = ForwardChanged {
        machine: "local",
        connection_id: connection_id.into(),
        forward_id: id.into(),
        generation: generation.to_string(),
        revision: REVISION.fetch_add(1, Ordering::Relaxed),
    };
    let _ = owner.with_live(|| {
        app.emit_to(window, "ssh-forward-changed", event)
            .map_err(|error| error.to_string())
    });
}

/// Watch one forward. An unexpected exit of a `reconnectable` forward is handed
/// to the reconnect ladder, which continues under the replacement generation;
/// anything else, or a ladder that gives up, leaves the forward `failed`.
pub(super) fn watch(
    app: AppHandle,
    window: String,
    connection_id: String,
    id: String,
    generation: uuid::Uuid,
    owner: ForwardOwner,
    reconnectable: bool,
) {
    if reconnectable {
        let state = app.state::<SshForwards>();
        let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(live) = sessions
            .get_mut(&id)
            .filter(|live| matches_generation(live, &owner, generation))
        {
            live.auto_reconnect = true;
        }
    }
    std::thread::spawn(move || {
        let mut generation = generation;
        let mut running_since = Instant::now();
        let mut attempts = 0u32;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let state = app.state::<SshForwards>();
            let resources = {
                let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
                let Some(live) = sessions
                    .get_mut(&id)
                    .filter(|live| matches_generation(live, &owner, generation))
                else {
                    break;
                };
                if live.stopping || live.status.state != "running" {
                    break;
                }
                match live.child.as_mut().map(|child| child.try_wait()) {
                    Some(Ok(None)) => continue,
                    Some(Ok(Some(_))) => {
                        live.child = None;
                        live.stopping = true;
                        live.status.state = "stopping".into();
                        (live._http_proxy.take(), live._jump_config.take())
                    }
                    Some(Err(_)) => {
                        live.status.state = "unknown".into();
                        live.status.error = Some("Unable to inspect forwarding process".into());
                        drop(sessions);
                        publish(&app, &window, &connection_id, &id, generation, &owner);
                        break;
                    }
                    None => break,
                }
            };
            drop(resources);
            let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let Some(live) = sessions
                .get_mut(&id)
                .filter(|live| matches_generation(live, &owner, generation) && live.stopping)
            else {
                break;
            };
            let detail = stderr_detail(&live.stderr);
            live.stopping = false;
            let retry = live.auto_reconnect && !reconnect::is_terminal(&detail);
            live.status.state = if retry { "reconnecting" } else { "failed" }.into();
            live.status.error = Some(format!("SSH forwarding process exited{detail}"));
            drop(sessions);
            publish(&app, &window, &connection_id, &id, generation, &owner);
            if !retry {
                break;
            }
            if running_since.elapsed() >= reconnect::STABLE {
                attempts = 0;
            }
            let Some(next) = reconnect::recover(
                &app,
                &window,
                &connection_id,
                &id,
                generation,
                &owner,
                &mut attempts,
            ) else {
                break;
            };
            generation = next;
            running_since = Instant::now();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watcher_never_adopts_a_replacement_process_or_window() {
        let owner = crate::ssh_window_lifecycle::register("forward-event-test").unwrap();
        let other = crate::ssh_window_lifecycle::register("forward-event-other").unwrap();
        let generation = uuid::Uuid::new_v4();
        let live = LiveForward {
            _http_proxy: None,
            _jump_config: None,
            generation,
            owner: "forward-event-test".into(),
            owner_lease: owner.clone(),
            identity: "fixture".into(),
            child: None,
            stderr: Default::default(),
            stopping: false,
            auto_reconnect: false,
            status: ForwardStatus {
                id: "rule".into(),
                connection_id: "profile".into(),
                local_port: 1,
                kind: "local".into(),
                target_host: "localhost".into(),
                target_port: 2,
                state: "running".into(),
                error: None,
            },
        };
        assert!(matches_generation(&live, &owner, generation));
        assert!(!matches_generation(&live, &owner, uuid::Uuid::new_v4()));
        assert!(!matches_generation(&live, &other, generation));
    }
}
