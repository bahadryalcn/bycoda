//! Private paired-device calls retain their original desktop issuer, saved
//! target and actual SSH lease. A renderer cannot construct this authority.
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

pub(crate) struct NativeDeviceChannel {
    selection: Selection,
    caller: Arc<NativeProfileCaller>,
    websocket: bool,
    grant_deadline: Instant,
}

/// Kept through UI acknowledgement and forwarding to the original issuer. The
/// underlying reply owns its bulk/resource charges until that work settles.
pub(crate) struct NativeDeviceReply {
    channel: Arc<NativeDeviceChannel>,
    value: Value,
    guard: Option<NativeProfileGuard>,
    grant_deadline: Instant,
}

fn unavailable() -> String {
    "The selected device computer changed or disconnected. Reconnect it before using devices."
        .into()
}

fn wire_method(method: &str) -> Option<String> {
    matches!(
        method,
        "devices.status"
            | "devices.preflight"
            | "devices.preview"
            | "devices.preview.status"
            | "devices.list"
            | "devices.start"
            | "devices.boot"
            | "devices.capture"
            | "devices.control.status"
            | "devices.control.claim"
            | "devices.control.release"
            | "devices.control.renew"
            | "devices.inspect"
            | "devices.action"
    )
    .then(|| method.to_owned())
}

impl NativeDeviceChannel {
    pub(super) fn connect(
        app: &AppHandle,
        state: &RemoteConnections,
        machine_id: &str,
        environment_id: &str,
        issuer: &NativeServiceReply,
        deadline: Instant,
        grant_deadline: Instant,
    ) -> Result<Arc<Self>, String> {
        check_grant_deadline(grant_deadline)?;
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
        // Tunnel acquisition can wait. No store or caller lifecycle gate may
        // remain held across SSH/network/credential work.
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
            .map_or_else(|| machine.endpoint.clone(), |lease| lease.endpoint.clone());
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
        // Capture even for old HTTP Hosts: disconnect/re-pair ABA must retire
        // that original owner rather than revive it when identical rows return.
        let caller = {
            let _store = selection.store.lock().map_err(|_| unavailable())?;
            selection.check_saved()?;
            state
                .native_device_ws
                .capture_device(
                    NativeRoute::new(
                        &selection.machine.id,
                        &selection.machine.environment_id,
                        &selection.endpoint,
                        &selection.machine.token,
                        &ws_fingerprint(&selection.machine),
                    )
                    .map_err(native_ws_failure)?,
                )
                .map_err(native_ws_failure)?
        };
        let mut channel = Arc::new(Self {
            selection,
            caller,
            websocket: false,
            grant_deadline,
        });
        issuer.admit_device(&channel, |_| Ok(()))?;
        let descriptor = rpc_until(
            &channel.selection.endpoint,
            &channel.selection.machine.token,
            Some(&channel.selection.machine.environment_id),
            "environment.describe",
            json!({}),
            deadline,
        )
        .map_err(|error| {
            error.replace(
                &channel.selection.machine.token,
                "[machine credential redacted]",
            )
        })?;
        issuer.admit_device(&channel, |_| Ok(()))?;
        if descriptor["environmentId"] != channel.selection.machine.environment_id
            || descriptor["protocolVersion"] != 1
        {
            return Err(
                "The selected device Host identity changed; reconnect it explicitly".into(),
            );
        }
        let websocket = descriptor["capabilities"].as_array().is_some_and(|caps| {
            caps.iter()
                .any(|cap| cap.as_str() == Some("transport.ws.devices.v1"))
        });
        Arc::get_mut(&mut channel)
            .ok_or("Device channel escaped before negotiation completed")?
            .websocket = websocket;
        Ok(channel)
    }

    pub(super) fn caller(&self) -> &Arc<NativeProfileCaller> {
        &self.caller
    }

    pub(super) fn check_projection_deadline(&self) -> Result<(), String> {
        check_grant_deadline(self.grant_deadline)
    }

    /// The issuer already holds this exact shared store gate. Validate both
    /// selections under that one gate; acquiring it recursively would deadlock.
    pub(super) fn check_saved_locked(
        &self,
        store: &Arc<Mutex<()>>,
        path: &Path,
    ) -> Result<(), String> {
        self.check_projection_deadline()?;
        if !Arc::ptr_eq(store, &self.selection.store) || path != self.selection.path {
            return Err(
                "Device and issuer selections belong to different connection stores".into(),
            );
        }
        self.selection.check_saved()
    }

    pub(super) fn request(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        issuer: &NativeServiceReply,
        deadline: Instant,
    ) -> Result<NativeDeviceReply, String> {
        self.request_inner(method, params, issuer, deadline)
            .map_err(|error| {
                error.replace(
                    &self.selection.machine.token,
                    "[machine credential redacted]",
                )
            })
    }

    fn request_inner(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        issuer: &NativeServiceReply,
        deadline: Instant,
    ) -> Result<NativeDeviceReply, String> {
        let wire = wire_method(method).ok_or("Unsupported private device operation")?;
        self.check_projection_deadline()?;
        if !NativeProfileBroker::supports_device_params(&wire, &params) {
            return Err("Invalid private device request".into());
        }
        if self.websocket {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .filter(|remaining| !remaining.is_zero())
                .ok_or("The device request deadline elapsed before dispatch")?;
            // Core accounting may take Permits/ID locks. Prepare before the
            // actual issuer/target resource gates, then enqueue only inside.
            let mut prepared = self
                .caller
                .prepare_device(
                    &wire,
                    params.clone(),
                    RequestOptions {
                        response_timeout: Some(remaining),
                        absolute_deadline: Some(deadline),
                        ..RequestOptions::default()
                    },
                )
                .map_err(native_ws_failure)?;
            let pending = issuer.admit_device(self, |admission| {
                Ok(admission.begin(&self.caller, &mut prepared))
            })?;
            match pending.and_then(|pending| pending.wait()) {
                Ok(reply) => {
                    let (value, guard) = reply.into_guarded();
                    let reply = NativeDeviceReply {
                        channel: self.clone(),
                        value,
                        guard: Some(guard),
                        grant_deadline: self.grant_deadline,
                    };
                    reply.check(issuer)?;
                    return Ok(reply);
                }
                // Only authenticated, negotiated absence before dispatch may
                // select HTTP. Reads/capture/actions never replay afterward.
                Err(error) if error.unsupported && !error.uncertain => {}
                Err(error) => return Err(native_ws_failure(error)),
            }
        }
        issuer.admit_device(self, |_| Ok(()))?;
        let value = rpc_until(
            &self.selection.endpoint,
            &self.selection.machine.token,
            Some(&self.selection.machine.environment_id),
            method,
            params,
            deadline,
        )
        .map_err(|error| {
            error.replace(
                &self.selection.machine.token,
                "[machine credential redacted]",
            )
        })?;
        let reply = NativeDeviceReply {
            channel: self.clone(),
            value,
            guard: None,
            grant_deadline: self.grant_deadline,
        };
        reply.check(issuer)?;
        Ok(reply)
    }
}

fn completed_without_disclosure(error: String) -> String {
    format!("{error} The device operation may have completed; its outcome is unknown. Do not replay this request; inspect its original status before another action.")
}

fn check_grant_deadline(deadline: Instant) -> Result<(), String> {
    if Instant::now() >= deadline {
        return Err(
            "The original device request continuation expired before result admission".into(),
        );
    }
    Ok(())
}

impl Selection {
    fn check_saved(&self) -> Result<(), String> {
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
        Ok(())
    }
}

impl NativeDeviceReply {
    pub(super) fn check_projection_deadline(&self) -> Result<(), String> {
        check_grant_deadline(self.grant_deadline)
    }

    pub(super) fn caller(&self) -> &Arc<NativeProfileCaller> {
        self.channel.caller()
    }

    pub(super) fn guards(&self) -> Vec<&NativeProfileGuard> {
        self.guard.iter().collect()
    }

    pub(super) fn value(&self) -> &Value {
        &self.value
    }

    pub(super) fn check_saved_locked(
        &self,
        store: &Arc<Mutex<()>>,
        path: &Path,
    ) -> Result<(), String> {
        self.channel.check_saved_locked(store, path)
    }

    pub(crate) fn check(&self, issuer: &NativeServiceReply) -> Result<(), String> {
        issuer
            .with_device_projection(self, |_| self.check_projection_deadline())
            .map_err(completed_without_disclosure)
    }

    fn consume_redacted<T>(
        &self,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        let redacted = serde_json::from_str(&self.value.to_string().replace(
            &self.channel.selection.machine.token,
            "[machine credential redacted]",
        ))
        .map_err(|_| "Invalid machine tool response")?;
        consume(&redacted)
    }

    pub(crate) fn project<T>(
        &self,
        issuer: &NativeServiceReply,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        issuer
            .with_device_projection(self, |_| {
                self.check_projection_deadline()?;
                // Keep the old credential-redaction contract inside the actual
                // paired/issuer projection, retaining all original bulk charges.
                self.consume_redacted(consume)
            })
            .map_err(completed_without_disclosure)
    }
}

#[cfg(test)]
#[path = "remote_native_devices_tests.rs"]
mod tests;
