//! Process-owned Native workspace channel. It is never selected by renderer
//! arguments and never borrows a window's lifetime or operation authority.
use super::*;
use crate::host_ws::native_profile::{NativeProfileBroker, NativeProfileCaller};

pub(super) struct NativeWorkspaceChannel {
    pub(super) selection: NativeRecoverySelection,
    pub(super) caller: Option<Arc<NativeProfileCaller>>,
}

impl NativeWorkspaceChannel {
    pub(super) fn connect(
        app: &AppHandle,
        capability: &str,
    ) -> Result<NativeWorkspaceTransport, String> {
        let state: State<'_, RemoteConnections> = app.state();
        let path = store_path(app)?;
        let selection = {
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let machine = read_uncached(&path)?
                .into_iter()
                .find(|machine| is_local_sync(machine, "This computer (local sync)"))
                .ok_or("Connect the local bycoda Host for managed native execution")?;
            NativeRecoverySelection {
                store: state.store.clone(),
                routes: state.recovery_routes.clone(),
                path,
                pin: RecoveryRoute {
                    revision: state.recovery_routes.capture(&machine.id)?,
                    selected_endpoint: machine.endpoint.clone(),
                },
                machine,
            }
        };
        let machine = selection.machine.clone();
        selection.with_current(|| Ok(()))?;
        let descriptor = cached_describe(&state, &machine, selection.pin.revision)?;
        selection.with_current(|| Ok(()))?;
        if let Some(message) = crate::remote::protocol::protocol_mismatch(&descriptor) {
            return Err(message.into());
        }
        if descriptor["environmentId"] != machine.environment_id {
            return Err("Local Host identity changed; reconnect before managed execution".into());
        }
        if !has_capability(&descriptor, capability) {
            return Err("Update bycoda Host to use managed native execution safely. The project checkout will not be used as a fallback.".into());
        }
        state.observe_ws_capability(&machine, &descriptor);
        let caller = selection.with_current(|| {
            if !state.ws_enabled(&machine) {
                return Ok(None);
            }
            state
                .native_profile_ws
                .capture_workspace(
                    NativeRoute::new(
                        &machine.id,
                        &machine.environment_id,
                        &machine.endpoint,
                        &machine.token,
                        &ws_fingerprint(&machine),
                    )
                    .map_err(native_ws_failure)?,
                )
                .map(Some)
                .map_err(native_ws_failure)
        })?;
        Ok(NativeWorkspaceTransport {
            machine,
            workspace: Some(Arc::new(Self { selection, caller })),
        })
    }

    pub(super) fn wire(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeRecoveryReply, WsFailure> {
        let caller = self.caller.as_ref().ok_or_else(WsFailure::unsupported)?;
        let pending = self
            .selection
            .with_current(|| Ok(caller.begin(method, params, options)))
            .map_err(|message| WsFailure::local("RPC_NATIVE_ROUTE_RETIRED", &message))??;
        let (value, guard) = pending.wait()?.into_guarded();
        Ok(NativeRecoveryReply {
            value,
            guard: Some(guard),
            selection: self.selection.clone(),
        })
    }

    fn request(
        &self,
        transport: &NativeWorkspaceTransport,
        method: &str,
        params: Value,
    ) -> Result<NativeRecoveryReply, String> {
        if self.caller.is_some() && NativeProfileBroker::supports_workspace_params(method, &params)
        {
            match self.wire(method, params.clone(), RequestOptions::default()) {
                Ok(reply) => return Ok(reply),
                Err(error) if error.unsupported => {}
                Err(error) => return Err(native_ws_failure(error)),
            }
        }
        self.selection.with_current(|| Ok(()))?;
        let value = transport.rpc_compat(method, params)?;
        Ok(NativeRecoveryReply {
            value,
            guard: None,
            selection: self.selection.clone(),
        })
    }
}

/// A healthy Host answers `environment.describe` in milliseconds; a cold or
/// busy one (first start after boot, a large session sync) can need seconds.
const DESCRIBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// One managed send runs several native checks back to back; they share one
/// describe. The Host policy toggle invalidates explicitly.
const DESCRIPTOR_TTL: std::time::Duration = std::time::Duration::from_secs(15);
/// A describe that used most of its budget means the Host is hung; the rest of
/// the same send chain fails fast instead of waiting again.
const SLOW_FAILURE_TTL: std::time::Duration = std::time::Duration::from_secs(10);

pub(super) struct CachedDescriptor {
    fingerprint: String,
    revision: u64,
    until: std::time::Instant,
    result: Result<Value, String>,
}

fn cached_describe(
    state: &RemoteConnections,
    machine: &StoredMachine,
    revision: u64,
) -> Result<Value, String> {
    let fingerprint = ws_fingerprint(machine);
    let now = std::time::Instant::now();
    {
        let cache = state
            .native_workspace_descriptors
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(entry) = cache.get(&machine.id).filter(|entry| {
            entry.fingerprint == fingerprint && entry.revision == revision && now < entry.until
        }) {
            return entry.result.clone();
        }
    }
    let result = rpc_timed(
        &machine.endpoint,
        &machine.token,
        Some(&machine.environment_id),
        "environment.describe",
        json!({}),
        DESCRIBE_TIMEOUT,
    );
    let finished = std::time::Instant::now();
    let ttl = match &result {
        Ok(descriptor)
            if descriptor["environmentId"] == machine.environment_id
                && crate::remote::protocol::protocol_mismatch(descriptor).is_none() =>
        {
            Some(DESCRIPTOR_TTL)
        }
        Err(_) if finished.duration_since(now) >= DESCRIBE_TIMEOUT / 2 => Some(SLOW_FAILURE_TTL),
        _ => None,
    };
    let mut cache = state
        .native_workspace_descriptors
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match ttl {
        // Only the route revision captured before the call may store it; a
        // reconnect during the describe retires that revision.
        Some(ttl) if state.recovery_routes.current(&machine.id, revision) => {
            cache.insert(
                machine.id.clone(),
                CachedDescriptor {
                    fingerprint,
                    revision,
                    until: finished + ttl,
                    result: result.clone(),
                },
            );
        }
        _ => {
            cache.remove(&machine.id);
        }
    }
    result
}

fn has_capability(descriptor: &Value, capability: &str) -> bool {
    descriptor["capabilities"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(capability)))
}

impl NativeWorkspaceTransport {
    pub(crate) fn project<T>(
        &self,
        method: &str,
        params: Value,
        consume: impl FnOnce(&Value, &NativeProjection<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        if let Some(channel) = &self.workspace {
            let reply = channel.request(self, method, params)?;
            return reply.inspect(|value| consume(value, &NativeProjection::new(&reply)));
        }
        // Isolated legacy fixtures have no application/saved route. Production
        // constructors never obtain this test-only compatibility path.
        #[cfg(test)]
        return consume(
            &self.rpc_compat(method, params)?,
            &NativeProjection::fixture(),
        );
        #[cfg(not(test))]
        Err("Native workspace channel is unavailable".into())
    }
}
