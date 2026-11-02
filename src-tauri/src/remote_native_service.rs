//! Native-owned helper calls. An issuer survives its jobs/grants; renderer
//! machine labels cannot construct this authority or select a different Host.
use super::*;
use crate::host_ws::native_profile::{
    NativeDeviceAdmission, NativeProfileCaller, NativeProfileGuard,
};
use std::time::Instant;

#[path = "remote_native_service_delivery.rs"]
mod delivery;

struct Selection {
    store: Arc<Mutex<()>>,
    path: PathBuf,
    machine: StoredMachine,
    endpoint: String,
    tunnel: Option<ServiceTunnel>,
}

struct ServiceTunnel {
    lease: remote_ssh::TunnelLease,
    current: Box<dyn Fn(&remote_ssh::TunnelLease) -> bool + Send + Sync>,
}

pub(crate) struct NativeServiceChannel {
    selection: Option<Selection>,
    caller: Arc<NativeProfileCaller>,
    websocket: bool,
    peer: bool,
    delivery_supported: bool,
    delivery_ack_supported: bool,
    delivery_epochs_supported: bool,
    journal: Option<delivery::JournalAccess>,
    delivery_cursor: Mutex<Option<String>>,
    delivery_ack_cursor: Mutex<Option<String>>,
}

pub(crate) struct NativeServiceReply {
    value: Value,
    guard: Option<NativeProfileGuard>,
    channel: Arc<NativeServiceChannel>,
    delivery: Option<crate::session_store::native_delivery::Original>,
    related_guards: Vec<NativeProfileGuard>,
    result_charge: Option<delivery::ResultCharge>,
    consumed: Mutex<bool>,
}

fn wire_method(method: &str) -> Option<String> {
    matches!(
        method,
        "runtimeLogs.bridge.describe"
            | "desktop.stop"
            | "desktop.status"
            | "assistant.presence.get"
            | "assistant.presence.set"
            | "runtimeLogs.access.issue"
            | "runtimeLogs.terminals.append"
            | "conversation.bridge.describe"
            | "conversation.access.issue"
            | "conversation.desktop.take"
            | "conversation.desktop.finish"
            | "conversation.desktop.authorize"
            | "social.bridge.describe"
            | "social.access.issue"
            | "social.native.status"
            | "social.native.enroll"
            | "social.native.register"
            | "social.native.authority"
            | "social.native.reset"
    )
    .then(|| format!("native.services.{method}"))
    .or_else(|| (method == "workspace.run").then(|| "native.services.workspace.format".into()))
}

impl NativeServiceChannel {
    #[cfg(test)]
    pub(super) fn fixture(
        state: &RemoteConnections,
        path: PathBuf,
        machine: StoredMachine,
        websocket: bool,
    ) -> Arc<Self> {
        let caller = state
            .native_service_ws
            .capture_service(
                NativeRoute::new(
                    &machine.id,
                    &machine.environment_id,
                    &machine.endpoint,
                    &machine.token,
                    &ws_fingerprint(&machine),
                )
                .unwrap(),
            )
            .unwrap();
        Arc::new(Self {
            selection: Some(Selection {
                store: state.store.clone(),
                path,
                endpoint: machine.endpoint.clone(),
                machine,
                tunnel: None,
            }),
            caller,
            websocket,
            peer: false,
            delivery_supported: false,
            delivery_ack_supported: false,
            delivery_epochs_supported: false,
            journal: None,
            delivery_cursor: Mutex::new(None),
            delivery_ack_cursor: Mutex::new(None),
        })
    }
    pub(crate) fn connect(app: &AppHandle) -> Result<Arc<Self>, String> {
        Self::connect_until(app, None)
    }

    /// Optional helpers (spawn tool grants, bridge metadata) bound the whole
    /// uncached connect, including its `environment.describe`, by `deadline`.
    pub(crate) fn connect_until(
        app: &AppHandle,
        deadline: Option<Instant>,
    ) -> Result<Arc<Self>, String> {
        let state: State<'_, RemoteConnections> = app.state();
        let retained = state
            .native_service_channel
            .lock()
            .map_err(|_| "Native helper pool is unavailable")?
            .clone();
        if let Some(channel) = retained.filter(|channel| channel.is_current()) {
            return Ok(channel);
        }
        let path = store_path(app)?;
        let (selection, caller) = {
            let _lock = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let machine = read_uncached(&path)?
                .into_iter()
                .find(|machine| is_local_sync(machine, "This computer (local sync)"))
                .ok_or("Connect the local bycoda Host for native tools")?;
            let caller = state
                .native_service_ws
                .capture_service(
                    NativeRoute::new(
                        &machine.id,
                        &machine.environment_id,
                        &machine.endpoint,
                        &machine.token,
                        &ws_fingerprint(&machine),
                    )
                    .map_err(native_ws_failure)?,
                )
                .map_err(native_ws_failure)?;
            (
                Selection {
                    store: state.store.clone(),
                    path,
                    endpoint: machine.endpoint.clone(),
                    machine,
                    tunnel: None,
                },
                caller,
            )
        };
        let mut channel = Self {
            selection: Some(selection),
            caller,
            websocket: false,
            peer: false,
            delivery_supported: false,
            delivery_ack_supported: false,
            delivery_epochs_supported: false,
            journal: delivery::JournalAccess::capture(app),
            delivery_cursor: Mutex::new(None),
            delivery_ack_cursor: Mutex::new(None),
        };
        channel.check()?;
        let machine = &channel
            .selection
            .as_ref()
            .ok_or("Native profile unavailable")?
            .machine;
        let descriptor = match deadline {
            Some(deadline) => rpc_until(
                &machine.endpoint,
                &machine.token,
                Some(&machine.environment_id),
                "environment.describe",
                json!({}),
                deadline,
            )?,
            None => rpc(
                &machine.endpoint,
                &machine.token,
                Some(&machine.environment_id),
                "environment.describe",
                json!({}),
            )?,
        };
        channel.check()?;
        if descriptor["environmentId"] != machine.environment_id
            || descriptor["protocolVersion"] != 1
        {
            return Err("Native Host identity changed; reconnect before using tools".into());
        }
        channel.websocket = descriptor["capabilities"].as_array().is_some_and(|caps| {
            caps.iter()
                .any(|cap| cap.as_str() == Some("native.services.v1"))
        });
        channel.delivery_supported = delivery::supports_host(&descriptor);
        channel.delivery_ack_supported =
            channel.delivery_supported && delivery::supports_ack_host(&descriptor);
        channel.delivery_epochs_supported =
            channel.delivery_ack_supported && super::native_delivery_epochs::supports(&descriptor);
        let channel = Arc::new(channel);
        if channel.journal.is_some() && channel.delivery_supported {
            // Startup recovery is status-only. Ordinary helper reads remain
            // usable if a former outcome is still unavailable or unconfirmed.
            let recovery = Instant::now() + std::time::Duration::from_secs(2);
            let _ = delivery::reconcile_pending(
                &channel,
                deadline.map_or(recovery, |deadline| deadline.min(recovery)),
            );
        }
        if channel.websocket {
            *state
                .native_service_channel
                .lock()
                .map_err(|_| "Native helper pool is unavailable")? = Some(channel.clone());
        }
        Ok(channel)
    }

    /// Only the native social-authority flow may select this paired owner.
    /// Session tools retain their scoped token and never use this factory.
    pub(crate) fn peer(
        app: &AppHandle,
        machine_id: &str,
        environment_id: &str,
    ) -> Result<Arc<Self>, String> {
        let state: State<'_, RemoteConnections> = app.state();
        let path = store_path(app)?;
        let machine = {
            let _lock = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let machine = read_uncached(&path)?
                .into_iter()
                .find(|m| m.id == machine_id)
                .ok_or("Selected social authority is disconnected")?;
            require_machine_environment(&machine, Some(environment_id))?;
            machine
        };
        let lease = machine
            .ssh
            .as_ref()
            .map(|target| {
                state
                    .tunnels
                    .endpoint(&machine.id, &machine.environment_id, target, true)
            })
            .transpose()?;
        let endpoint = lease
            .as_ref()
            .map_or_else(|| machine.endpoint.clone(), |lease| lease.endpoint.clone());
        let tunnel = lease.map(|lease| {
            let app = app.clone();
            let id = machine.id.clone();
            ServiceTunnel {
                lease,
                current: Box::new(move |lease| {
                    app.try_state::<RemoteConnections>()
                        .is_some_and(|state| state.tunnels.is_current(&id, lease))
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
        let caller = {
            let _lock = selection
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            if !read_uncached(&selection.path)?
                .iter()
                .any(|m| same_request_route(&selection.machine, m))
            {
                return Err("Selected social authority changed".into());
            }
            state
                .native_service_ws
                .capture_peer_service(
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
        let mut channel = Self {
            selection: Some(selection),
            caller,
            websocket: false,
            peer: true,
            delivery_supported: false,
            delivery_ack_supported: false,
            delivery_epochs_supported: false,
            journal: None,
            delivery_cursor: Mutex::new(None),
            delivery_ack_cursor: Mutex::new(None),
        };
        channel.check()?;
        let selection = channel
            .selection
            .as_ref()
            .ok_or("Social authority unavailable")?;
        let descriptor = rpc(
            &selection.endpoint,
            &selection.machine.token,
            Some(&selection.machine.environment_id),
            "environment.describe",
            json!({}),
        )?;
        channel.check()?;
        if descriptor["environmentId"] != selection.machine.environment_id
            || descriptor["protocolVersion"] != 1
        {
            return Err("Social authority Host identity changed".into());
        }
        channel.websocket = descriptor["capabilities"]
            .as_array()
            .is_some_and(|caps| caps.iter().any(|v| v == "native.services.v1"));
        Ok(Arc::new(channel))
    }

    pub(crate) fn machine_id(&self) -> &str {
        self.selection
            .as_ref()
            .map_or("fixture", |s| s.machine.id.as_str())
    }

    pub(crate) fn endpoint(&self) -> &str {
        self.selection
            .as_ref()
            .map_or("http://127.0.0.1:3774", |s| s.endpoint.as_str())
    }
    pub(crate) fn environment_id(&self) -> &str {
        self.selection
            .as_ref()
            .map_or("fixture-environment", |s| s.machine.environment_id.as_str())
    }
    pub(crate) fn is_current(&self) -> bool {
        self.check().is_ok()
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        self.with_current(&[], || Ok(()))
    }

    /// Short local admission only. The caller owns the admitted operation and
    /// its byte charge until settlement; no socket/provider work runs here.
    pub(crate) fn admit<T>(&self, admit: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        self.with_current(&[], admit)
    }

    fn with_current<T>(
        &self,
        guards: &[&NativeProfileGuard],
        consume: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        #[cfg(test)]
        if self.selection.is_none() {
            return consume();
        }
        self.with_saved(|| {
            if self.peer {
                NativeProfileGuard::admit_peer_service(&[&self.caller], guards, consume)
            } else {
                NativeProfileGuard::admit_service(&[&self.caller], guards, consume)
            }
        })
    }

    fn with_saved<T>(&self, consume: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let Some(selection) = &self.selection else {
            #[cfg(test)]
            {
                return consume();
            }
            #[cfg(not(test))]
            {
                return Err("Native selected profile is unavailable".into());
            }
        };
        let _lock = selection
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        let current = read_uncached(&selection.path)?
            .into_iter()
            .find(|m| m.id == selection.machine.id)
            .filter(|m| {
                (self.peer || is_local_sync(m, "This computer (local sync)"))
                    && same_request_route(&selection.machine, m)
            })
            .ok_or("Native tools issuer changed or disconnected")?;
        if current.environment_id != selection.machine.environment_id {
            return Err("Native tools issuer changed".into());
        }
        if selection
            .tunnel
            .as_ref()
            .is_some_and(|pin| !(pin.current)(&pin.lease))
        {
            return Err("Native tools tunnel retired".into());
        }
        consume()
    }

    fn wire(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Result<NativeServiceReply, WsFailure> {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
            .ok_or_else(|| {
                WsFailure::local(
                    "RPC_NATIVE_SERVICE_DEADLINE",
                    "Native helper deadline elapsed",
                )
            })?;
        let pending = self
            .with_saved(|| {
                Ok(self.caller.begin(
                    method,
                    params,
                    RequestOptions {
                        response_timeout: Some(remaining),
                        absolute_deadline: Some(deadline),
                        ..RequestOptions::default()
                    },
                ))
            })
            .map_err(|message| WsFailure::local("RPC_NATIVE_ROUTE_RETIRED", &message))??;
        let (value, guard) = pending.wait()?.into_guarded();
        Ok(NativeServiceReply {
            value,
            guard: Some(guard),
            channel: self.clone(),
            delivery: None,
            related_guards: Vec::new(),
            result_charge: None,
            consumed: Mutex::new(false),
        })
    }

    fn wire_ack(
        self: &Arc<Self>,
        params: Value,
        guards: &[&NativeProfileGuard],
        deadline: Instant,
    ) -> Result<NativeServiceReply, WsFailure> {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| {
                WsFailure::local(
                    "RPC_NATIVE_SERVICE_DEADLINE",
                    "Native retirement deadline elapsed",
                )
            })?;
        let pending = self
            .with_saved(|| {
                Ok(self.caller.begin_service_with_guards(
                    guards,
                    "native.services.delivery.ack",
                    params,
                    RequestOptions {
                        response_timeout: Some(remaining),
                        absolute_deadline: Some(deadline),
                        ..RequestOptions::default()
                    },
                ))
            })
            .map_err(|message| WsFailure::local("RPC_NATIVE_ROUTE_RETIRED", &message))??;
        let (value, guard) = pending.wait()?.into_guarded();
        Ok(NativeServiceReply {
            value,
            guard: Some(guard),
            channel: self.clone(),
            delivery: None,
            related_guards: Vec::new(),
            result_charge: None,
            consumed: Mutex::new(false),
        })
    }

    pub(crate) fn request(
        self: &Arc<Self>,
        method: &str,
        params: Value,
    ) -> Result<NativeServiceReply, String> {
        self.request_until(method, params, None)
    }

    /// `deadline` can only shorten the method's own budget.
    pub(crate) fn request_until(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        deadline: Option<Instant>,
    ) -> Result<NativeServiceReply, String> {
        let wire = wire_method(method).ok_or("Unsupported native helper operation")?;
        if self.peer && !crate::host_ws::native_peer_service_method(&wire) {
            return Err("The social peer channel cannot invoke local native tools".into());
        }
        if method == "workspace.run" && params["command"] != "format_text_file" {
            return Err("Only editor formatting belongs to native helper transport".into());
        }
        let budget = Instant::now() + rpc_timeout(method, &params);
        let deadline = deadline.map_or(budget, |deadline| deadline.min(budget));
        if matches!(method, "conversation.desktop.finish" | "workspace.run") {
            #[cfg(test)]
            if self.journal.is_none() {
                return self.request_legacy(method, &wire, params, deadline);
            }
            return delivery::request(self, method, &wire, params, deadline);
        }
        self.request_legacy(method, &wire, params, deadline)
    }

    fn request_legacy(
        self: &Arc<Self>,
        method: &str,
        wire: &str,
        params: Value,
        deadline: Instant,
    ) -> Result<NativeServiceReply, String> {
        if self.websocket {
            if self.peer && !crate::host_ws::native_profile::NativeProfileBroker::supports_peer_service_params(wire,&params) {
                return Err("Invalid native social peer request".into());
            }
            if matches!(method, "conversation.desktop.finish" | "workspace.run")
                && !crate::host_ws::native_profile::NativeProfileBroker::supports_service_params(
                    wire, &params,
                )
            {
                return self.upload(wire, params, deadline);
            }
            match self.wire(wire, params.clone(), deadline) {
                Ok(reply) => return Ok(reply),
                Err(error) if error.unsupported && !error.uncertain => {} // authenticated, before dispatch only
                Err(error) => return Err(native_ws_failure(error)),
            }
        }
        self.check()?;
        let selection = self
            .selection
            .as_ref()
            .ok_or("Native helper fixture cannot perform RPC")?;
        let value = rpc_until(
            &selection.endpoint,
            &selection.machine.token,
            Some(&selection.machine.environment_id),
            if method.starts_with("assistant.presence.") {
                wire
            } else {
                method
            },
            params,
            deadline,
        )?;
        self.check()?;
        Ok(NativeServiceReply {
            value,
            guard: None,
            channel: self.clone(),
            delivery: None,
            related_guards: Vec::new(),
            result_charge: None,
            consumed: Mutex::new(false),
        })
    }

    pub(crate) fn project<T>(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        self.request(method, params)?.project(consume)
    }

    pub(crate) fn project_until<T>(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        deadline: Instant,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        self.request_until(method, params, Some(deadline))?
            .project(consume)
    }

    fn upload(
        self: &Arc<Self>,
        target: &str,
        params: Value,
        deadline: Instant,
    ) -> Result<NativeServiceReply, String> {
        let bytes = bounded_params(&params)?;
        self.upload_bytes(target, &bytes, None, false, deadline)
    }

    fn upload_bytes(
        self: &Arc<Self>,
        target: &str,
        bytes: &[u8],
        original: Option<&crate::session_store::native_delivery::Original>,
        delivery_binding: bool,
        deadline: Instant,
    ) -> Result<NativeServiceReply, String> {
        use base64::Engine;
        // One original invocation, one upload ID. Neither an ambiguous commit
        // nor an interrupted consuming result is automatically dispatched again.
        let upload_id =
            original.map_or_else(|| uuid::Uuid::new_v4().to_string(), |o| o.id().to_owned());
        let digest = format!("{:x}", Sha256::digest(bytes));
        let verify = |reply: &NativeServiceReply, expected: usize| {
            reply.project(|v| {
                if v["uploadId"] != upload_id
                    || v["target"] != target
                    || v["byteLength"] != bytes.len()
                    || v["sha256"] != digest
                    || v["receivedBytes"] != expected
                    || v["state"] != "receiving"
                    || (delivery_binding
                        && v["delivery"]
                            != delivery::binding(
                                original.ok_or("Native delivery original is unavailable")?,
                            ))
                {
                    return Err(format!(
                        "Native helper staging did not confirm original upload {upload_id}"
                    ));
                }
                Ok(())
            })
        };
        let mut begin = json!({"uploadId":upload_id,
            "target":target,"byteLength":bytes.len(),"sha256":digest});
        if delivery_binding {
            let original = original.ok_or("Native delivery original is unavailable")?;
            begin["delivery"] = delivery::binding(original);
        }
        let begun = self.upload_transport("native.services.upload.begin", begin, deadline, None)?;
        let mut offset = begun.project(|value| {
            let received = value["receivedBytes"]
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .filter(|value| *value <= bytes.len())
                .ok_or("Native helper staging offset is invalid")?;
            if original.is_none() && received != 0 {
                return Err("Native helper staging did not start with an empty original".into());
            }
            Ok(received)
        })?;
        verify(&begun, offset)?;
        drop(begun);
        for chunk in bytes[offset..].chunks(65_536) {
            let reply = self.upload_transport(
                "native.services.upload.append",
                json!({"uploadId":upload_id,
                "offset":offset,"data":base64::engine::general_purpose::STANDARD.encode(chunk)}),
                deadline,
                None,
            )?;
            offset += chunk.len();
            verify(&reply, offset)?;
        }
        let possible = original
            .map(|original| delivery::mark_possible(self, original))
            .transpose()?;
        let mut committed = self
            .upload_transport(
                "native.services.upload.commit",
                json!({"uploadId":upload_id}),
                deadline,
                possible.as_ref(),
            )
            .map_err(|error| {
                format!(
                    "{} Original native upload {upload_id}; reconcile before retrying",
                    error
                )
            })?;
        committed.project(|v| {
            if v["uploadId"] != upload_id || v["target"] != target || v["sha256"] != digest
                || v["byteLength"] != bytes.len() || v["receivedBytes"] != bytes.len() || v["state"] != "completed"
                || v.get("result").is_none()
                || (delivery_binding && v["delivery"] != delivery::binding(original.ok_or("Native delivery original is unavailable")?)) {
                return Err(format!("Native helper result is unconfirmed; original upload {upload_id} must not be replayed"));
            }
            Ok(())
        })?;
        committed.value = committed.value["result"].clone();
        committed.delivery = possible;
        Ok(committed)
    }

    fn upload_transport(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        deadline: Instant,
        possible: Option<&crate::session_store::native_delivery::Original>,
    ) -> Result<NativeServiceReply, String> {
        if self.websocket {
            match self.wire(method, params.clone(), deadline) {
                Ok(reply) => return Ok(reply),
                Err(error) if error.unsupported && !error.uncertain => {}
                Err(error) => {
                    if let Some(possible) = possible {
                        delivery::retain_failure(self, possible, &error);
                    }
                    return Err(native_ws_failure(error));
                }
            }
        }
        // Same retained profile, original bytes/ID and absolute deadline. An
        // ambiguous stage/commit never falls through to another transport.
        delivery::http(self, method, params, deadline)
    }

    #[cfg(test)]
    pub(crate) fn for_test() -> Arc<Self> {
        let broker = crate::host_ws::native_profile::NativeProfileBroker::default();
        let caller = broker
            .capture_service(
                NativeRoute::new(
                    "fixture",
                    "fixture-environment",
                    "http://127.0.0.1:3774",
                    "fixture-token",
                    "fixture-principal",
                )
                .unwrap(),
            )
            .unwrap();
        // Test channels never request a socket; currentness is the fixture seam.
        Arc::new(Self {
            selection: None,
            caller,
            websocket: false,
            peer: false,
            delivery_supported: false,
            delivery_ack_supported: false,
            delivery_epochs_supported: false,
            journal: None,
            delivery_cursor: Mutex::new(None),
            delivery_ack_cursor: Mutex::new(None),
        })
    }
}

fn bounded_params(params: &Value) -> Result<Vec<u8>, String> {
    struct Bytes(Vec<u8>);
    impl Write for Bytes {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > (16 * 1024 * 1024usize).saturating_sub(self.0.len()) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Native helper request exceeds 16MiB",
                ));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut bytes = Bytes(Vec::new());
    serde_json::to_writer(&mut bytes, params).map_err(|_| "Native helper request exceeds 16MiB")?;
    Ok(bytes.0)
}

impl NativeServiceReply {
    fn guards(&self) -> Vec<&NativeProfileGuard> {
        self.guard.iter().chain(&self.related_guards).collect()
    }
    pub(crate) fn is_issued_by(&self, issuer: &Arc<NativeServiceChannel>) -> bool {
        Arc::ptr_eq(&self.channel, issuer)
    }
    pub(crate) fn admit_device<T>(
        &self,
        target: &super::native_devices::NativeDeviceChannel,
        admit: impl FnOnce(&NativeDeviceAdmission<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        self.channel.with_saved(|| {
            let selection = self
                .channel
                .selection
                .as_ref()
                .ok_or("A real desktop issuer is required for device admission")?;
            target.check_saved_locked(&selection.store, &selection.path)?;
            let guards = self.guards();
            NativeProfileGuard::admit_device_with_issuer(
                &self.channel.caller,
                &guards,
                target.caller(),
                &[],
                |admission| {
                    target.check_projection_deadline()?;
                    admit(admission)
                },
            )
        })
    }

    pub(crate) fn with_device_projection<T>(
        &self,
        target: &super::native_devices::NativeDeviceReply,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        self.channel.with_saved(|| {
            let selection = self
                .channel
                .selection
                .as_ref()
                .ok_or("A real desktop issuer is required for device projection")?;
            target.check_saved_locked(&selection.store, &selection.path)?;
            let guards = self.guards();
            NativeProfileGuard::admit_device_with_issuer(
                &self.channel.caller,
                &guards,
                target.caller(),
                &target.guards(),
                |_| {
                    target.check_projection_deadline()?;
                    consume(target.value())
                },
            )
        })
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        let guards = self.guards();
        self.channel.with_current(&guards, || Ok(()))
    }
    pub(crate) fn project<T>(
        &self,
        consume: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        delivery::project(self, consume)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_ws::native_profile::NativeProfileBroker;
    use crate::host_ws::tests::{accept, hello, next, result, Server};
    use base64::Engine;

    struct Fixture {
        root: PathBuf,
        broker: NativeProfileBroker,
        channel: Arc<NativeServiceChannel>,
    }
    impl Fixture {
        fn new(endpoint: String) -> Self {
            let root = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("bycoda-service-ws-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            let path = root.join("connections.json");
            let machine = StoredMachine {
                id: "machine.1".into(),
                name: "Local fixture".into(),
                endpoint: endpoint.clone(),
                environment_id: "host.1".into(),
                token: "secret-native-token".into(),
                ssh: None,
                local_host: true,
            };
            write(&path, std::slice::from_ref(&machine)).unwrap();
            let broker = NativeProfileBroker::default();
            let caller = broker
                .capture_service(
                    NativeRoute::new(
                        &machine.id,
                        &machine.environment_id,
                        &endpoint,
                        &machine.token,
                        "fixture-principal",
                    )
                    .unwrap(),
                )
                .unwrap();
            let channel = Arc::new(NativeServiceChannel {
                selection: Some(Selection {
                    store: Arc::default(),
                    path,
                    machine,
                    endpoint,
                    tunnel: None,
                }),
                caller,
                websocket: true,
                peer: false,
                delivery_supported: false,
                delivery_ack_supported: false,
                delivery_epochs_supported: false,
                journal: None,
                delivery_cursor: Mutex::new(None),
                delivery_ack_cursor: Mutex::new(None),
            });
            Self {
                root,
                broker,
                channel,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.broker.shutdown();
            assert_eq!(
                self.root.canonicalize().unwrap().parent(),
                Some(std::env::temp_dir().canonicalize().unwrap().as_path())
            );
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn actual_service_ws_stages_original_large_finish_and_consumes_one_guarded_result() {
        let params = json!({"id":"original-desktop-job", "result":"😀\\\"".repeat(150_000)});
        let original = bounded_params(&params).unwrap();
        assert!(original.len() > 1024 * 1024);
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.services.upload.begin",
                    "native.services.upload.append",
                    "native.services.upload.commit",
                ],
                "host.1",
            )
            .await;
            let begin = next(&mut socket).await;
            assert_eq!(begin["method"], "native.services.upload.begin");
            assert_eq!(
                begin["params"]["target"],
                "native.services.conversation.desktop.finish"
            );
            let mut status = begin["params"].clone();
            status["receivedBytes"] = json!(0);
            status["state"] = json!("receiving");
            status["expiresAt"] = json!(1000000);
            result(&mut socket, &begin, status.clone()).await;
            let mut received = Vec::new();
            while received.len() < original.len() {
                let chunk = next(&mut socket).await;
                assert_eq!(chunk["method"], "native.services.upload.append");
                assert_eq!(chunk["params"]["uploadId"], status["uploadId"]);
                assert_eq!(chunk["params"]["offset"], received.len());
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(chunk["params"]["data"].as_str().unwrap())
                    .unwrap();
                assert!(bytes.len() <= 65536);
                received.extend(bytes);
                status["receivedBytes"] = json!(received.len());
                result(&mut socket, &chunk, status.clone()).await;
            }
            assert_eq!(received, original);
            assert_eq!(status["sha256"], format!("{:x}", Sha256::digest(&received)));
            let commit = next(&mut socket).await;
            assert_eq!(commit["method"], "native.services.upload.commit");
            assert_eq!(commit["params"]["uploadId"], status["uploadId"]);
            status["state"] = json!("completed");
            status["result"] = json!({"accepted":true});
            result(&mut socket, &commit, status).await;
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        });
        let fixture = Fixture::new(server.endpoint.clone());
        let reply = fixture
            .channel
            .request("conversation.desktop.finish", params)
            .unwrap();
        assert_eq!(
            reply.project(|v| Ok(v.clone())).unwrap(),
            json!({"accepted":true})
        );
        fixture.broker.invalidate_machine("machine.1");
        assert!(reply.project(|_| Ok(())).is_err());
        assert!(fixture.root.exists());
    }

    #[test]
    fn service_saved_issuer_change_rejects_original_reply_without_reselecting() {
        let fixture = Fixture::new("http://127.0.0.1:9".into());
        let reply = NativeServiceReply {
            value: json!({"token":"fixture-scoped"}),
            guard: None,
            channel: fixture.channel.clone(),
            delivery: None,
            related_guards: Vec::new(),
            result_charge: None,
            consumed: Mutex::new(false),
        };
        assert!(reply.check().is_ok());
        let selection = fixture.channel.selection.as_ref().unwrap();
        let mut replacement = selection.machine.clone();
        replacement.token = "replacement-device-credential".into();
        write(&selection.path, &[replacement]).unwrap();
        let mut applied = false;
        assert!(reply
            .project(|_| {
                applied = true;
                Ok(())
            })
            .is_err());
        assert!(!applied);
    }
    #[test]
    fn helper_mapping_is_finite_and_private() {
        assert_eq!(
            wire_method("desktop.stop").as_deref(),
            Some("native.services.desktop.stop")
        );
        assert_eq!(
            wire_method("desktop.status").as_deref(),
            Some("native.services.desktop.status")
        );
        assert_eq!(
            wire_method("assistant.presence.get").as_deref(),
            Some("native.services.assistant.presence.get")
        );
        assert_eq!(
            wire_method("assistant.presence.set").as_deref(),
            Some("native.services.assistant.presence.set")
        );
        assert!(wire_method("assistant.request").is_none());
        assert_eq!(
            wire_method("conversation.desktop.finish").as_deref(),
            Some("native.services.conversation.desktop.finish")
        );
        for method in [
            "conversation.call",
            "native.services.upload.commit",
            "models.list",
            "workspace.delete",
            "devices.action",
            "desktop.request",
            "desktop.act",
            "desktop.resume",
        ] {
            assert!(wire_method(method).is_none());
        }
    }
    #[test]
    fn helper_staging_preserves_large_json_and_has_a_real_byte_ceiling() {
        let value = json!({"result":"😀\\\"".repeat(250_000)});
        let bytes = bounded_params(&value).unwrap();
        assert!(bytes.len() > 1024 * 1024);
        assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), value);
        assert!(bounded_params(&json!({"result":"x".repeat(16*1024*1024)})).is_err());
    }
}
