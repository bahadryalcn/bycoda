//! Account hints require possession proof; failed hints retire without replaying effects.
use super::*;
static DISABLED: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub(super) fn require_machine_enabled(machine: &StoredMachine) -> Result<(), String> {
    require_environment_enabled(&machine.environment_id)
}

pub(super) fn require_environment_enabled(environment_id: &str) -> Result<(), String> {
    require_transport_allowed(
        !DISABLED
            .lock()
            .map_err(|_| "Machine settings unavailable")?
            .iter()
            .any(|disabled| disabled == environment_id),
    )
}

/// Shared admission for ordinary and private native WebSocket transports.
pub(super) fn native_route(
    machine_id: &str,
    environment_id: &str,
    endpoint: &str,
    token: &str,
    fingerprint: &str,
) -> Result<NativeRoute, WsFailure> {
    require_environment_enabled(environment_id)
        .map_err(|_| WsFailure::local("RPC_WS_DISABLED", "Machine connection is disabled"))?;
    if crate::remote_routes::account_tunnel(endpoint).is_some() {
        crate::remote_routes::verify_account_endpoint(
            endpoint,
            environment_id,
            token,
            crate::remote_routes::IDENTITY_BUDGET,
        )
        .map_err(|_| {
            crate::remote_routes::retire_account_endpoint(environment_id, endpoint);
            WsFailure::local("RPC_WS_IDENTITY", "Host possession proof failed")
        })?;
    }
    require_environment_enabled(environment_id)
        .map_err(|_| WsFailure::local("RPC_WS_DISABLED", "Machine connection is disabled"))?;
    NativeRoute::new(machine_id, environment_id, endpoint, token, fingerprint)
}

/// Renderer synchronizes its saved device-local switch on startup and on changes.
#[tauri::command]
pub fn remote_set_disabled_machines(environment_ids: Vec<String>) -> Result<(), String> {
    *DISABLED
        .lock()
        .map_err(|_| "Machine settings unavailable")? = environment_ids;
    Ok(())
}

pub(super) fn require_transport_allowed(allow_connect: bool) -> Result<(), String> {
    if allow_connect {
        Ok(())
    } else {
        Err("Machine connection is disabled".into())
    }
}

/// Route replacement keeps the existing WS broker, HTTP fallback and reply fences.
/// Only reconnect reads may try another route after a dispatched request fails.
pub(super) fn with_routes(
    machine: &StoredMachine,
    method: &str,
    mut send: impl FnMut(Option<&str>) -> Result<Value, String>,
) -> Result<Value, String> {
    let active = crate::remote_routes::account_in_use(&machine.environment_id);
    let mut routes = vec![None];
    routes.extend(
        crate::remote_routes::account_endpoints(&machine.environment_id)
            .into_iter()
            .map(Some),
    );
    if let Some(index) = active.as_ref().and_then(|active| {
        routes
            .iter()
            .position(|route| route.as_ref() == Some(active))
    }) {
        let preferred = routes.remove(index);
        routes.insert(0, preferred);
    }
    let count = routes.len();
    for (index, endpoint) in routes.into_iter().enumerate() {
        let response = send(endpoint.as_deref());
        let failed = response.as_ref().err().is_some_and(|error| {
            error.starts_with("Machine is unreachable")
                || error.starts_with("The host request did not complete")
                || error == "Invalid host response"
                || error.starts_with("Host returned HTTP 5")
                || error.starts_with("RPC_WS_IDENTITY:")
                || error.starts_with("RPC_WS_SSH:")
        });
        if failed {
            if let Some(endpoint) = &endpoint {
                crate::remote_routes::retire_account_endpoint(&machine.environment_id, endpoint);
            }
            // Only this probe is replayable here. Dispatched writes may have run.
            if method == "environment.describe" && index + 1 < count {
                continue;
            }
        }
        if response.is_ok() && method == "environment.describe" {
            crate::remote_routes::note_account_route(&machine.environment_id, endpoint.as_deref());
        }
        return response;
    }
    unreachable!("saved route is always present")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reconnect_exhausts_learned_routes_and_saved_route_but_effects_never_replay() {
        let machine: StoredMachine = serde_json::from_value(json!({
            "id":"route-wrapper", "name":"test", "endpoint":"https://saved.example", "environmentId":"route-wrapper-env", "token":"unused"
        })).unwrap();
        crate::remote_routes::learn_account_endpoint(
            &machine.environment_id,
            "https://new.trycloudflare.com".into(),
        );
        crate::remote_routes::note_account_route(
            &machine.environment_id,
            Some("https://new.trycloudflare.com"),
        );
        let mut calls = Vec::new();
        let result = with_routes(&machine, "environment.describe", |endpoint| {
            calls.push(endpoint.map(str::to_string));
            if endpoint.is_some() {
                Err("Machine is unreachable".into())
            } else {
                Ok(json!({"environmentId":machine.environment_id}))
            }
        });
        assert!(result.is_ok());
        assert_eq!(calls, [Some("https://new.trycloudflare.com".into()), None]);
        assert!(crate::remote_routes::account_endpoints(&machine.environment_id).is_empty());
        let mut count = 0;
        assert!(with_routes(&machine, "commands.dispatch", |_| {
            count += 1;
            Err("Machine is unreachable".into())
        })
        .is_err());
        assert_eq!(count, 1);
    }

    #[test]
    fn latest_successful_saved_probe_wins_over_a_stale_account_hint() {
        let machine: StoredMachine = serde_json::from_value(json!({
            "id":"saved-wins", "name":"test", "endpoint":"https://saved.example",
            "environmentId":"saved-wins-env", "token":"unused"
        }))
        .unwrap();
        crate::remote_routes::learn_account_endpoint(
            &machine.environment_id,
            "https://stale.trycloudflare.com".into(),
        );
        crate::remote_routes::note_account_route(&machine.environment_id, None);
        let mut calls = Vec::new();
        assert!(with_routes(&machine, "commands.dispatch", |route| {
            calls.push(route.map(str::to_string));
            Ok(json!({}))
        })
        .is_ok());
        assert_eq!(calls, [None]);
    }

    #[test]
    fn websocket_proof_failure_falls_back_only_for_a_discovery_probe() {
        let machine: StoredMachine = serde_json::from_value(json!({
            "id":"ws-proof-fallback", "name":"test", "endpoint":"ssh://saved.example",
            "environmentId":"ws-proof-fallback-env", "token":"unused"
        }))
        .unwrap();
        let tunnel = "https://fake.trycloudflare.com";
        crate::remote_routes::learn_account_endpoint(&machine.environment_id, tunnel.into());
        crate::remote_routes::note_account_route(&machine.environment_id, Some(tunnel));
        let mut calls = Vec::new();
        assert!(with_routes(&machine, "environment.describe", |endpoint| {
            calls.push(endpoint.map(str::to_string));
            if endpoint.is_some() {
                Err("RPC_WS_IDENTITY: Host possession proof failed".into())
            } else {
                Ok(json!({}))
            }
        })
        .is_ok());
        assert_eq!(calls, [Some(tunnel.into()), None]);
        assert!(crate::remote_routes::account_endpoints(&machine.environment_id).is_empty());
    }

    #[test]
    fn failed_tunnel_write_retires_hint_but_never_replays_unknown_effect() {
        let machine: StoredMachine = serde_json::from_value(json!({
            "id":"write-retire", "name":"test", "endpoint":"https://saved.example",
            "environmentId":"write-retire-env", "token":"unused"
        }))
        .unwrap();
        let tunnel = "https://expired.trycloudflare.com";
        crate::remote_routes::learn_account_endpoint(&machine.environment_id, tunnel.into());
        crate::remote_routes::note_account_route(&machine.environment_id, Some(tunnel));
        let mut calls = Vec::new();
        assert!(with_routes(&machine, "commands.dispatch", |route| {
            calls.push(route.map(str::to_string));
            Err("The host request did not complete".into())
        })
        .is_err());
        assert_eq!(calls, [Some(tunnel.into())]);
        assert!(crate::remote_routes::account_endpoints(&machine.environment_id).is_empty());
        assert!(with_routes(&machine, "environment.describe", |route| {
            assert!(route.is_none());
            Ok(json!({}))
        })
        .is_ok());
    }

    #[test]
    fn native_tunnel_failure_keeps_its_cause_under_the_stable_code() {
        let mut machine: StoredMachine = serde_json::from_value(json!({
            "id":"native-ssh-cause", "name":"test", "endpoint":"https://saved.example",
            "environmentId":"native-ssh-cause-env", "token":"unused"
        }))
        .unwrap();
        machine.ssh = Some(
            serde_json::from_value(json!({"target":"user@127.0.0.1", "remotePort":3774})).unwrap(),
        );
        let state = RemoteConnections::default();
        // Without allow_connect no ssh is spawned: the tunnel error is immediate.
        let failure = native_ws_route(&state, &machine, false)
            .err()
            .expect("no tunnel exists");
        assert_eq!(failure.code, "RPC_WS_SSH");
        assert!(
            failure.message.contains("Automatic reconnect is off"),
            "{failure}"
        );
        assert!(!failure.message.contains("Verified native"), "{failure}");
        // The HTTP-path failover check keys on this prefix, so it must stay.
        assert!(failure
            .to_string()
            .starts_with("RPC_WS_SSH: Machine is unreachable"));
    }

    #[test]
    fn disabled_machine_admits_no_transport() {
        assert!(require_transport_allowed(false).is_err());
        assert!(require_transport_allowed(true).is_ok());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let machine: StoredMachine = serde_json::from_value(json!({
            "id":"disabled-direct", "name":"test", "endpoint":format!("http://{}", listener.local_addr().unwrap()),
            "environmentId":"disabled-direct-env", "token":"never-send"
        })).unwrap();
        let state = RemoteConnections::default();
        DISABLED
            .lock()
            .unwrap()
            .push(machine.environment_id.clone());
        assert_eq!(
            machine_rpc(&state, &machine, "environment.describe", json!({}), false).unwrap_err(),
            "Machine connection is disabled"
        );
        assert!(machine_rpc(&state, &machine, "environment.describe", json!({}), true).is_err());
        assert!(native_ws_route(&state, &machine, true).is_err());
        let mut ssh_machine = machine.clone();
        ssh_machine.ssh = Some(
            serde_json::from_value(json!({"target":"user@127.0.0.1", "remotePort":3774})).unwrap(),
        );
        assert!(machine_rpc(
            &state,
            &ssh_machine,
            "environment.describe",
            json!({}),
            true
        )
        .is_err());
        assert!(native_ws_route(&state, &ssh_machine, true).is_err());
        DISABLED
            .lock()
            .unwrap()
            .retain(|id| id != &machine.environment_id);
        assert!(require_machine_enabled(&machine).is_ok());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

#[tauri::command]
pub async fn remote_learn_account_routes(
    app: AppHandle,
    machine_id: String,
    environment_id: String,
    routes: Vec<String>,
) -> Result<bool, String> {
    if routes.len() > 4 {
        return Err("Too many account routes".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RemoteConnections>();
        let path = store_path(&app)?;
        let original = machine_for_request(&state, &path, &machine_id, Some(&environment_id))?;
        if original.local_host {
            return Ok(false);
        }
        let known = crate::remote_routes::account_endpoints(&environment_id);
        for route in routes
            .iter()
            .filter_map(|route| crate::remote_routes::account_tunnel(route))
        {
            if known.contains(&route) {
                continue;
            }
            if crate::remote_routes::verify_account_endpoint(
                &route,
                &environment_id,
                &original.token,
                crate::remote_routes::IDENTITY_BUDGET,
            )
            .is_err()
            {
                continue;
            }
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let current = read_uncached(&path)?;
            if !current
                .iter()
                .any(|machine| same_request_route(&original, machine))
            {
                return Err("Connection changed during account route discovery".into());
            }
            let changed = crate::remote_routes::learn_account_endpoint(&environment_id, route);
            if changed {
                state.invalidate_ws(&machine_id);
            }
            return Ok(changed);
        }
        Ok(false)
    })
    .await
    .map_err(|_| "Account route discovery interrupted")?
}

pub(super) fn native_ws_route(
    state: &RemoteConnections,
    machine: &StoredMachine,
    allow_connect: bool,
) -> Result<NativeRoute, WsFailure> {
    require_machine_enabled(machine)
        .map_err(|_| WsFailure::local("RPC_WS_DISABLED", "Machine connection is disabled"))?;
    let account = crate::remote_routes::account_in_use(&machine.environment_id);
    let lease = machine
        .ssh
        .as_ref()
        .filter(|_| account.is_none())
        .map(|target| {
            state
                .tunnels
                .endpoint(&machine.id, &machine.environment_id, target, allow_connect)
        })
        .transpose()
        // The tunnel error is the same text the HTTP path returns; it is already redacted.
        .map_err(|error| WsFailure::local("RPC_WS_SSH", &error))?;
    let endpoint = lease
        .as_ref()
        .map(|lease| lease.endpoint.as_str())
        .unwrap_or_else(|| account.as_deref().unwrap_or(&machine.endpoint));
    native_route(
        &machine.id,
        &machine.environment_id,
        endpoint,
        &machine.token,
        &ws_fingerprint(machine),
    )
}
