//! Account routes are untrusted hints until the public Host identity matches.
use super::*;

/// Route replacement keeps the existing WS broker, HTTP fallback and reply fences.
/// Only reconnect reads may try another route after a dispatched request fails.
pub(super) fn with_routes(
    machine: &StoredMachine,
    method: &str,
    mut send: impl FnMut(Option<&str>) -> Result<Value, String>,
) -> Result<Value, String> {
    for endpoint in crate::remote_routes::account_endpoints(&machine.environment_id) {
        let response = send(Some(&endpoint));
        if method == "environment.describe"
            && response.as_ref().err().is_some_and(|error| {
                error.starts_with("Machine is unreachable")
                    || error.starts_with("The host request did not complete")
                    || error == "Invalid host response"
                    || error.starts_with("Host returned HTTP 5")
            })
        {
            continue;
        }
        return response;
    }
    send(None)
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
        let mut count = 0;
        assert!(with_routes(&machine, "commands.dispatch", |_| {
            count += 1;
            Err("Machine is unreachable".into())
        })
        .is_err());
        assert_eq!(count, 1);
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
            if crate::remote_routes::verify_account_endpoint(&route, &environment_id).is_err() {
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
