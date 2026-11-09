//! Private, process-owned development relay. Renderer RPCs cannot obtain this
//! scope. One listener/its streams retain one caller across all chunk requests.
use super::*;
use crate::host_ws::native_profile::{
    NativeProfileBroker, NativeProfileCaller, NativeProfileGuard,
};
use std::time::Instant;

struct TunnelPin {
    lease: remote_ssh::TunnelLease,
    current: Box<dyn Fn(&remote_ssh::TunnelLease) -> bool + Send + Sync>,
}

struct Selection {
    store: Arc<Mutex<()>>,
    path: PathBuf,
    machine: StoredMachine,
    endpoint: String,
    tunnel: Option<TunnelPin>,
}

impl Selection {
    fn with_current<T>(&self, consume: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _store = self.store.lock().map_err(|_| unavailable())?;
        if !read_uncached(&self.path)?
            .iter()
            .any(|saved| same_request_route(&self.machine, saved))
            || self
                .tunnel
                .as_ref()
                .is_some_and(|pin| !(pin.current)(&pin.lease))
        {
            return Err(unavailable());
        }
        consume()
    }
}

pub(super) struct NativeGatewayChannel {
    selection: Selection,
    caller: Arc<NativeProfileCaller>,
    websocket: bool,
}

fn unavailable() -> String {
    "The owning computer connection changed. Reopen its private development link.".into()
}

fn gateway_method(method: &str) -> bool {
    matches!(
        method,
        "devServers.bridgeCheck"
            | "devServers.bridgeOpen"
            | "devServers.bridgeRead"
            | "devServers.bridgeWrite"
            | "devServers.bridgeClose"
    )
}

impl NativeGatewayChannel {
    #[cfg(test)]
    pub(super) fn fixture(
        state: &RemoteConnections,
        path: PathBuf,
        machine: StoredMachine,
        websocket: bool,
    ) -> Arc<Self> {
        let route = NativeRoute::new(
            &machine.id,
            &machine.environment_id,
            &machine.endpoint,
            &machine.token,
            &ws_fingerprint(&machine),
        )
        .unwrap();
        Arc::new(Self {
            selection: Selection {
                store: state.store.clone(),
                path,
                endpoint: machine.endpoint.clone(),
                machine,
                tunnel: None,
            },
            caller: state.native_gateway_ws.capture_gateway(route).unwrap(),
            websocket,
        })
    }

    pub(super) fn connect(
        app: &AppHandle,
        state: &RemoteConnections,
        machine_id: &str,
        environment_id: &str,
    ) -> Result<Arc<Self>, String> {
        let path = store_path(app)?;
        let machine = {
            let _store = state.store.lock().map_err(|_| unavailable())?;
            let machine = read_uncached(&path)?
                .into_iter()
                .find(|machine| machine.id == machine_id)
                .ok_or_else(unavailable)?;
            require_machine_environment(&machine, Some(environment_id))?;
            machine
        };
        // SSH acquisition can wait for the verified tunnel; no saved-store or
        // broker lifecycle mutex encloses network/credential work.
        let tunnel = machine
            .ssh
            .as_ref()
            .map(|target| {
                state
                    .tunnels
                    .endpoint(&machine.id, &machine.environment_id, target, true)
            })
            .transpose()?;
        let endpoint = tunnel
            .as_ref()
            .map(|lease| lease.endpoint.clone())
            .unwrap_or_else(|| machine.endpoint.clone());
        let tunnel = tunnel.map(|lease| {
            let app = app.clone();
            let machine_id = machine.id.clone();
            TunnelPin {
                lease,
                current: Box::new(move |lease| {
                    app.try_state::<RemoteConnections>()
                        .is_some_and(|state| state.tunnels.is_current(&machine_id, lease))
                }),
            }
        });
        let selection = Selection {
            store: state.store.clone(),
            path,
            machine,
            endpoint,
            tunnel,
        };
        let caller = selection.with_current(|| {
            let route = NativeRoute::new(
                &selection.machine.id,
                &selection.machine.environment_id,
                &selection.endpoint,
                &selection.machine.token,
                &ws_fingerprint(&selection.machine),
            )
            .map_err(native_ws_failure)?;
            state
                .native_gateway_ws
                .capture_gateway(route)
                .map_err(native_ws_failure)
        })?;
        let channel = Self {
            selection,
            caller,
            websocket: false,
        };
        channel.admit(&[])?;
        let descriptor = rpc(
            &channel.selection.endpoint,
            &channel.selection.machine.token,
            Some(&channel.selection.machine.environment_id),
            "environment.describe",
            json!({}),
        )?;
        channel.admit(&[])?;
        if descriptor["environmentId"] != channel.selection.machine.environment_id
            || descriptor["protocolVersion"] != 1
        {
            return Err("The owning Host identity or protocol changed; reconnect it before opening a private link".into());
        }
        let websocket = descriptor["capabilities"]
            .as_array()
            .is_some_and(|capabilities| {
                capabilities
                    .iter()
                    .any(|value| value.as_str() == Some("transport.ws.devServers.v2"))
            });
        Ok(Arc::new(Self {
            websocket,
            ..channel
        }))
    }

    pub(super) fn key(&self) -> String {
        // Include the actual verified SSH endpoint as well as the saved route and
        // principal. No credential or fingerprint is returned to the browser.
        format!(
            "{}:{}",
            ws_fingerprint(&self.selection.machine),
            self.selection.endpoint
        )
    }

    pub(super) fn is_current(&self) -> bool {
        self.admit(&[]).is_ok()
    }

    fn admit(&self, guards: &[&NativeProfileGuard]) -> Result<(), String> {
        self.selection.with_current(|| {
            NativeProfileGuard::admit_gateway(&[self.caller.as_ref()], guards, || Ok(()))
        })
    }

    pub(super) fn request(
        self: &Arc<Self>,
        method: &str,
        params: Value,
    ) -> Result<NativeGatewayReply, String> {
        let deadline = Instant::now() + DEFAULT_RPC_TIMEOUT;
        if !gateway_method(method) {
            return Err("Unsupported private development gateway operation".into());
        }
        if self.websocket && NativeProfileBroker::supports_gateway_params(method, &params) {
            let pending = self.selection.with_current(|| {
                self.caller
                    .begin(
                        method,
                        params.clone(),
                        RequestOptions {
                            absolute_deadline: Some(deadline),
                            ..RequestOptions::default()
                        },
                    )
                    .map_err(native_ws_failure)
            })?;
            match pending.wait() {
                Ok(reply) => {
                    let (value, guard) = reply.into_guarded();
                    let reply = NativeGatewayReply(Arc::new(Reply {
                        channel: self.clone(),
                        value,
                        guard: Some(guard),
                    }));
                    reply.admit()?;
                    return Ok(reply);
                }
                // The negotiated method was absent BEFORE dispatch. No other
                // failure, including a consuming Read, may replay over HTTP.
                Err(error) if error.unsupported && !error.uncertain => {}
                Err(error) => return Err(native_ws_failure(error)),
            }
        }
        self.admit(&[])?;
        let value = rpc_until(
            &self.selection.endpoint,
            &self.selection.machine.token,
            Some(&self.selection.machine.environment_id),
            method,
            params,
            deadline,
        )?;
        let reply = NativeGatewayReply(Arc::new(Reply {
            channel: self.clone(),
            value,
            guard: None,
        }));
        reply.admit()?;
        Ok(reply)
    }
}

struct Reply {
    channel: Arc<NativeGatewayChannel>,
    value: Value,
    guard: Option<NativeProfileGuard>,
}

#[derive(Clone)]
pub(super) struct NativeGatewayReply(Arc<Reply>);

/// Short admission linearizes a bounded write to its ORIGINAL browser stream.
/// Keep this object through actual IO settlement. It retains caller, tunnel and
/// response/bulk charge, but no global/store mutex is held while a socket waits.
pub(super) struct GatewayAdmission {
    _replies: Vec<NativeGatewayReply>,
}

impl NativeGatewayReply {
    pub(super) fn project<T>(
        &self,
        project: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        let _admission = self.admit()?;
        project(&self.0.value)
    }

    pub(super) fn admit(&self) -> Result<GatewayAdmission, String> {
        Self::admit_many(&[self])
    }

    pub(super) fn admit_many(replies: &[&Self]) -> Result<GatewayAdmission, String> {
        let first = replies
            .first()
            .ok_or("A development gateway reply is required for admission")?;
        if replies
            .iter()
            .any(|reply| !Arc::ptr_eq(&first.0.channel, &reply.0.channel))
        {
            return Err("Development gateway replies belong to different routes".into());
        }
        let guards = replies
            .iter()
            .filter_map(|reply| reply.0.guard.as_ref())
            .collect::<Vec<_>>();
        let held = first.0.channel.selection.with_current(|| {
            NativeProfileGuard::admit_gateway(&[first.0.channel.caller.as_ref()], &guards, || {
                Ok(replies.iter().map(|reply| (*reply).clone()).collect())
            })
        })?;
        Ok(GatewayAdmission { _replies: held })
    }
}

#[cfg(test)]
#[path = "remote_native_gateway_tests.rs"]
pub(super) mod tests;
