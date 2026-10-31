//! Process-owned Native workspace channel. It is never selected by renderer
//! arguments and never borrows a window's lifetime or operation authority.
use super::*;
use crate::host_ws::native_profile::{NativeProfileBroker, NativeProfileCaller};

pub(super) struct NativeWorkspaceChannel {
    pub(super) selection: NativeRecoverySelection,
    pub(super) caller: Option<Arc<NativeProfileCaller>>,
    pub(super) pending: Arc<super::native_upload::NativeUploads>,
    pub(super) uploads: bool,
    pub(super) delivery: bool,
    pub(super) delivery_ack: bool,
    pub(super) delivery_epochs: bool,
    pub(super) delivery_cursors: Arc<super::native_buffer_delivery::RecoveryCursors>,
    pub(super) delivery_ack_cursors: Arc<super::native_buffer_delivery::RecoveryCursors>,
}

pub(super) struct NativeWorkspaceResponse {
    pub(super) reply: NativeRecoveryReply,
    pub(super) upload: Option<super::native_upload::UploadLease>,
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
                    revision: state.recovery_routes.capture()?,
                    selected_endpoint: machine.endpoint.clone(),
                },
                machine,
            }
        };
        let machine = selection.machine.clone();
        selection.with_current(|| Ok(()))?;
        let descriptor = cached_describe(&state, &machine, selection.pin.revision)?;
        selection.with_current(|| Ok(()))?;
        if descriptor["environmentId"] != machine.environment_id
            || descriptor["protocolVersion"] != 1
        {
            return Err(
                "Local Host identity or protocol changed; reconnect before managed execution"
                    .into(),
            );
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
            recovery: None,
            workspace: Some(Arc::new(Self {
                selection,
                caller,
                pending: state.native_workspace_uploads.clone(),
                uploads: has_capability(&descriptor, "native.buffers.upload.v1"),
                // Full delivery requires its raw-byte staging dependency even
                // when WS is unavailable. Incomplete older catalogs select the
                // existing legacy protocol before any effect is dispatched.
                delivery: has_capability(&descriptor, "native.buffers.delivery.v1")
                    && has_capability(&descriptor, "native.buffers.upload.v1")
                    && descriptor["methods"].as_array().is_some_and(|methods| {
                        [
                            "native.buffers.delivery.apply",
                            "native.buffers.delivery.status",
                            "native.buffers.upload.start",
                            "native.buffers.upload.write",
                            "native.buffers.upload.commit",
                        ]
                        .iter()
                        .all(|required| {
                            methods
                                .iter()
                                .any(|method| method.as_str() == Some(*required))
                        })
                    }),
                delivery_cursors: state.native_buffer_delivery_cursors.clone(),
                delivery_ack: has_capability(&descriptor, "native.buffers.delivery.ack.v1")
                    && descriptor["methods"].as_array().is_some_and(|methods| {
                        methods
                            .iter()
                            .any(|method| method.as_str() == Some("native.buffers.delivery.ack"))
                    }),
                delivery_ack_cursors: state.native_buffer_delivery_ack_cursors.clone(),
                delivery_epochs: super::native_delivery_epochs::supports(&descriptor),
            })),
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
    ) -> Result<NativeWorkspaceResponse, String> {
        if method == "native.buffers.update"
            && self.uploads
            && self.caller.is_some()
            && NativeProfileBroker::validates_workspace_params(method, &params)
            && !NativeProfileBroker::supports_workspace_params(method, &params)
        {
            return super::native_upload::upload_buffers(self, params);
        }
        if self.caller.is_some() && NativeProfileBroker::supports_workspace_params(method, &params)
        {
            match self.wire(method, params.clone(), RequestOptions::default()) {
                Ok(reply) => {
                    return Ok(NativeWorkspaceResponse {
                        reply,
                        upload: None,
                    })
                }
                Err(error) if error.unsupported => {}
                Err(error) => return Err(native_ws_failure(error)),
            }
        }
        self.selection.with_current(|| Ok(()))?;
        let value = transport.rpc_compat(method, params)?;
        Ok(NativeWorkspaceResponse {
            reply: NativeRecoveryReply {
                value,
                guard: None,
                selection: self.selection.clone(),
            },
            upload: None,
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
                && descriptor["protocolVersion"] == 1 =>
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
        Some(ttl) if state.recovery_routes.current(revision) => {
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
            let response = channel.request(self, method, params)?;
            let result = response
                .reply
                .inspect(|value| consume(value, &NativeProjection::new(&response.reply)));
            if result.is_ok() {
                if let Some(upload) = response.upload {
                    upload.applied();
                }
            }
            return result;
        }
        // Isolated legacy fixtures have no application/saved route. Production
        // constructors never obtain this test-only compatibility path.
        #[cfg(test)]
        if self.recovery.is_none() {
            return consume(
                &self.rpc_compat(method, params)?,
                &NativeProjection::fixture(),
            );
        }
        Err("Native workspace channel is unavailable".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_ws::tests::{accept, hello, next, result, Server};
    use base64::Engine;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn actual_native_ws_upload_keeps_original_bytes_and_commits_under_reply_guard() {
        let params = json!({"clientId":"native-client","instanceId":"native-instance","processId":1,
            "owners":[{"ownerId":"native-window","updatedAt":1,"unknown":true,
                "buffers":(0..6000).map(|n| json!({"path":format!("G:/{}-{n}", "x".repeat(180)),"dirty":false})).collect::<Vec<_>>()}]});
        let original = serde_json::to_vec(&params).unwrap();
        assert!(original.len() > 1024 * 1024);
        assert!(NativeProfileBroker::validates_workspace_params(
            "native.buffers.update",
            &params
        ));
        assert!(!NativeProfileBroker::supports_workspace_params(
            "native.buffers.update",
            &params
        ));
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let server = Server::spawn(move |listener| async move {
            let mut socket = accept(&listener).await;
            hello(
                &mut socket,
                &[
                    "native.buffers.upload.start",
                    "native.buffers.upload.write",
                    "native.buffers.upload.commit",
                    "native.buffers.upload.status",
                ],
                "host.1",
            )
            .await;
            let start = next(&mut socket).await;
            assert_eq!(start["method"], "native.buffers.upload.start");
            let input = &start["params"];
            assert_eq!(input["byteLength"], original.len());
            assert_eq!(input["sha256"], format!("{:x}", Sha256::digest(&original)));
            let mut status = json!({"uploadId":input["uploadId"],"byteLength":input["byteLength"],"sha256":input["sha256"],
                "receivedBytes":0,"state":"receiving","expiresAt":4_000_000_000_000_u64});
            result(&mut socket, &start, status.clone()).await;
            let mut received = Vec::new();
            loop {
                let request = next(&mut socket).await;
                assert_eq!(request["params"]["uploadId"], input["uploadId"]);
                match request["method"].as_str().unwrap() {
                    "native.buffers.upload.write" => {
                        assert_eq!(request["params"]["offset"], received.len());
                        let bytes = base64::engine::general_purpose::STANDARD
                            .decode(request["params"]["data"].as_str().unwrap())
                            .unwrap();
                        assert!(bytes.len() <= 65_536);
                        received.extend_from_slice(&bytes);
                        status["receivedBytes"] = json!(received.len());
                        result(&mut socket, &request, status.clone()).await;
                    }
                    "native.buffers.upload.commit" => {
                        assert_eq!(received, original);
                        status["state"] = json!("completed");
                        status["result"] = json!({"acknowledged":true});
                        result(&mut socket, &request, status).await;
                        break;
                    }
                    other => panic!("Unexpected request or replay: {other}"),
                }
            }
            tokio::task::spawn_blocking(move || {
                done_rx.recv_timeout(Duration::from_secs(5)).unwrap()
            })
            .await
            .unwrap();
        });
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let root = parent.join(format!(
            "bycoda-native-upload-wire-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("connections.json");
        let state = RemoteConnections::default();
        let machine = StoredMachine {
            id: "machine.1".into(),
            name: "Native fixture".into(),
            endpoint: server.endpoint.clone(),
            environment_id: "host.1".into(),
            token: "secret-native-token".into(),
            ssh: None,
            local_host: true,
        };
        write(&path, std::slice::from_ref(&machine)).unwrap();
        let selection = NativeRecoverySelection {
            store: state.store.clone(),
            routes: state.recovery_routes.clone(),
            path,
            machine: machine.clone(),
            pin: RecoveryRoute {
                revision: state.recovery_routes.capture().unwrap(),
                selected_endpoint: machine.endpoint.clone(),
            },
        };
        let caller = state
            .native_profile_ws
            .capture_workspace(
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
        let transport = NativeWorkspaceTransport {
            machine,
            recovery: None,
            workspace: Some(Arc::new(NativeWorkspaceChannel {
                selection,
                caller: Some(caller),
                pending: state.native_workspace_uploads.clone(),
                uploads: true,
                delivery: false,
                delivery_ack: false,
                delivery_epochs: false,
                delivery_cursors: state.native_buffer_delivery_cursors.clone(),
                delivery_ack_cursors: state.native_buffer_delivery_ack_cursors.clone(),
            })),
        };
        let database = rusqlite::Connection::open_in_memory().unwrap();
        database
            .execute_batch("CREATE TABLE confirmations(value INTEGER)")
            .unwrap();
        transport
            .project(
                "native.buffers.update",
                params,
                |acknowledgement, context| {
                    assert_eq!(acknowledgement, &json!({"acknowledged":true}));
                    NativeProjection::commit(&[context], || {
                        database
                            .execute("INSERT INTO confirmations VALUES(1)", [])
                            .map_err(|error| error.to_string())?;
                        Ok(())
                    })
                },
            )
            .unwrap();
        assert_eq!(
            database
                .query_row("SELECT count(*) FROM confirmations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        done_tx.send(()).unwrap();
        drop(server);
        state.native_profile_ws.shutdown();
        assert_eq!(
            root.canonicalize().unwrap().parent(),
            Some(parent.as_path())
        );
        assert!(!std::fs::symlink_metadata(&root)
            .unwrap()
            .file_type()
            .is_symlink());
        std::fs::remove_dir_all(root).unwrap();
    }
}
