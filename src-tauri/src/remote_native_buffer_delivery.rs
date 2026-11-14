//! Original buffer delivery across small WS, staged bytes and compatibility
//! HTTP. A retained journal row is data, never a new source/route authority.
use super::native_delivery_epochs as epoch_wire;
use super::native_workspace_transport::{NativeWorkspaceChannel, NativeWorkspaceResponse};
use super::*;
use crate::host_ws::native_profile::{NativeProfileBroker, NativeProfileGuard};
use crate::session_store::{authority, native_delivery as journal, SessionStore};

const APPLY: &str = "native.buffers.delivery.apply";
const STATUS: &str = "native.buffers.delivery.status";
const ACK: &str = "native.buffers.delivery.ack";
const RECOVERY_PAGE: usize = 2;
/// Best-effort remote cleanup (retirement ACK and epoch compaction) after a
/// local source confirmation. It must not hold the caller; whatever it misses
/// stays in the outbox for reconciliation. Tests assert the cleanup itself, so
/// they allow a stalled CI runner.
#[cfg(not(test))]
const ACK_BUDGET: std::time::Duration = std::time::Duration::from_millis(250);
#[cfg(test)]
const ACK_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);

fn epochs_supported(channel: &NativeWorkspaceChannel) -> bool {
    channel.delivery && channel.delivery_ack && channel.delivery_epochs
}

fn commit_epoch(
    channel: &NativeWorkspaceChannel,
    store: &SessionStore,
    reply: &NativeRecoveryReply,
) -> Result<journal::epochs::EpochHandle, String> {
    let description = epoch_wire::description(&reply.value)?;
    let route = ws_fingerprint(&channel.selection.machine);
    let admission = journal::completion_admission(store)?;
    let projection = NativeProjection::new(reply);
    let outcome = NativeProjection::commit(&[&projection], || {
        let commit = || {
            authority::with_full_projection_transaction(store, |tx| {
                let epoch = journal::epochs::bind_tx(tx.connection(), store, &route, &description)?;
                journal::epochs::compact_tx(tx.connection(), &epoch, &description)?;
                Ok(epoch)
            })
        };
        if reply.guard.is_none() {
            if let Some(caller) = &channel.caller {
                return NativeProfileGuard::admit_workspace(&[caller.as_ref()], &[], commit);
            }
        }
        commit()
    });
    let epoch = admission.finish(outcome)?;
    journal::epochs::current(store, &epoch)
}

fn ensure_epoch(
    channel: &NativeWorkspaceChannel,
    store: &SessionStore,
) -> Result<journal::epochs::EpochHandle, String> {
    if !epochs_supported(channel) {
        return Err(held());
    }
    channel.selection.with_current(|| Ok(()))?;
    let route = ws_fingerprint(&channel.selection.machine);
    let params = epoch_wire::open_params(store, &route)?;
    let response = call(channel, epoch_wire::OPEN, params, None).map_err(|error| error.message)?;
    let epoch = commit_epoch(channel, store, &response.reply)?;
    if let Some(params) = epoch_wire::compact_params(store, &epoch)? {
        let deadline = std::time::Instant::now() + ACK_BUDGET;
        if let Ok(response) = call_until(channel, epoch_wire::COMPACT, params, None, deadline) {
            let _ = commit_epoch(channel, store, &response.reply);
        }
    }
    journal::epochs::current(store, &epoch)
}

fn compact_epoch(
    channel: &NativeWorkspaceChannel,
    store: &SessionStore,
    original: &journal::Original,
    deadline: std::time::Instant,
) -> Result<(), String> {
    if !epoch_wire::required(original) {
        return Ok(());
    }
    if !epochs_supported(channel) {
        return Err(held());
    }
    let Some(epoch) = journal::epochs::for_original(store, original)? else {
        return Err(held());
    };
    let request = epoch_wire::compact_params(store, &epoch)?;
    let (method, params) = match request {
        Some(params) => (epoch_wire::COMPACT, params),
        None => (epoch_wire::STATUS, epoch_wire::reference(&epoch)),
    };
    let response =
        call_until(channel, method, params, None, deadline).map_err(|error| error.message)?;
    commit_epoch(channel, store, &response.reply)?;
    Ok(())
}
pub(super) type RecoveryCursors = Mutex<HashMap<String, (String, Option<String>)>>;

fn held() -> String {
    "NATIVE_DELIVERY_UNKNOWN: original buffer delivery is not confirmed; its exact bytes remain retained. Do not replay it or confirm a newer report from this outcome.".into()
}

fn binding(original: &journal::Original) -> Value {
    json!({"originalId":original.id(),"sha256":original.payload_sha256(),"byteLength":original.payload_bytes()})
}

fn matches(value: &Value, original: &journal::Original) -> bool {
    value["originalId"] == original.id()
        && value["sha256"] == original.payload_sha256()
        && value["byteLength"] == original.payload_bytes()
}

fn recorded<'a>(value: &'a Value, original: &journal::Original) -> Result<&'a Value, String> {
    if !matches(value, original)
        || value["state"] != "recorded"
        || value["result"]["acknowledged"] != true
    {
        return Err(held());
    }
    Ok(&value["result"])
}

struct CallFailure {
    message: String,
    definitely_unsent: bool,
}

fn call(
    channel: &NativeWorkspaceChannel,
    method: &str,
    params: Value,
    original_id: Option<&str>,
) -> Result<NativeWorkspaceResponse, CallFailure> {
    let deadline = std::time::Instant::now() + DEFAULT_RPC_TIMEOUT;
    call_until(channel, method, params, original_id, deadline)
}

fn call_until(
    channel: &NativeWorkspaceChannel,
    method: &str,
    params: Value,
    original_id: Option<&str>,
    deadline: std::time::Instant,
) -> Result<NativeWorkspaceResponse, CallFailure> {
    if params["originalId"]
        .as_str()
        .is_some_and(|id| id.starts_with("nd2:"))
        && !epochs_supported(channel)
    {
        return Err(CallFailure {
            message: held(),
            definitely_unsent: true,
        });
    }
    if channel.caller.is_some() && NativeProfileBroker::supports_workspace_params(method, &params) {
        match channel.wire(
            method,
            params.clone(),
            RequestOptions {
                request_id: original_id.map(str::to_owned),
                absolute_deadline: Some(deadline),
                ..RequestOptions::default()
            },
        ) {
            Ok(reply) => {
                return Ok(NativeWorkspaceResponse {
                    reply,
                    upload: None,
                })
            }
            Err(error) if error.unsupported && !error.uncertain => {}
            Err(error) => {
                return Err(CallFailure {
                    definitely_unsent: !error.uncertain,
                    message: native_ws_failure(error),
                })
            }
        }
    }
    channel
        .selection
        .with_current(|| Ok(()))
        .map_err(|message| CallFailure {
            message,
            definitely_unsent: true,
        })?;
    // Negotiated absence may choose HTTP before dispatch. It retains the same
    // selected profile, wrapper identity and absolute deadline, never bare retry.
    let machine = &channel.selection.machine;
    let value = rpc_until(
        &machine.endpoint,
        &machine.token,
        Some(&machine.environment_id),
        method,
        params,
        deadline,
    )
    .map_err(|message| CallFailure {
        message,
        definitely_unsent: false,
    })?;
    Ok(NativeWorkspaceResponse {
        reply: NativeRecoveryReply {
            value,
            guard: None,
            selection: channel.selection.clone(),
        },
        upload: None,
    })
}

fn remote_ack(
    channel: &NativeWorkspaceChannel,
    store: &SessionStore,
    original: &journal::Original,
    original_reply: Option<&NativeRecoveryReply>,
    deadline: std::time::Instant,
) -> Result<(), String> {
    if epoch_wire::required(original) && !epochs_supported(channel) {
        return Err(held());
    }
    if !channel.delivery || !channel.delivery_ack {
        return Ok(());
    }
    let Some(original) = journal::remote_ack_candidate(store, original)? else {
        return Ok(());
    };
    if original.method() != "native.buffers.update"
        || original.route_fingerprint() != ws_fingerprint(&channel.selection.machine)
    {
        return Err(held());
    }
    let (hash, bytes) = original.consumed_result()?;
    let mut params = binding(&original);
    params["consumedResult"] = json!({"sha256":hash,"byteLength":bytes});
    let guards = original_reply
        .and_then(|reply| reply.guard.as_ref())
        .into_iter()
        .collect::<Vec<_>>();
    let mut reply = None;
    if let Some(caller) = &channel.caller {
        let admitted = channel.selection.with_current(|| {
            Ok(caller.begin_workspace_with_guards(
                &guards,
                ACK,
                params.clone(),
                RequestOptions {
                    absolute_deadline: Some(deadline),
                    ..RequestOptions::default()
                },
            ))
        })?;
        match admitted.and_then(|pending| pending.wait()) {
            Ok(response) => {
                let (value, guard) = response.into_guarded();
                reply = Some(NativeRecoveryReply {
                    value,
                    guard: Some(guard),
                    selection: channel.selection.clone(),
                });
            }
            Err(error) if error.unsupported && !error.uncertain => {}
            Err(error) => return Err(native_ws_failure(error)),
        }
    }
    let reply = match reply {
        Some(reply) => reply,
        None => {
            channel.selection.with_current(|| {
                if let Some(caller) = &channel.caller {
                    NativeProfileGuard::admit_workspace(&[caller.as_ref()], &guards, || Ok(()))
                } else {
                    NativeProfileGuard::commit_many(&guards, || Ok(()))
                }
            })?;
            let machine = &channel.selection.machine;
            let value = rpc_until(
                &machine.endpoint,
                &machine.token,
                Some(&machine.environment_id),
                ACK,
                params.clone(),
                deadline,
            )?;
            NativeRecoveryReply {
                value,
                guard: None,
                selection: channel.selection.clone(),
            }
        }
    };
    let mut expected = params;
    expected["state"] = json!("retired");
    let admission = journal::completion_admission(store)?;
    let ack_projection = NativeProjection::new(&reply);
    let old_projection = original_reply.map(NativeProjection::new);
    let mut projections = vec![&ack_projection];
    if let Some(projection) = &old_projection {
        projections.push(projection);
    }
    let result = NativeProjection::commit(&projections, || {
        if reply.value != expected {
            return Err(held());
        }
        let mark = || {
            authority::with_full_projection_transaction(store, |tx| {
                journal::mark_remote_acked_tx(tx.connection(), &original)
            })
        };
        if reply.guard.is_none() && guards.is_empty() {
            // HTTP has no manufactured reply grant. Recovery has no old reply
            // either, so explicitly retain the captured caller's lifecycle at
            // the final commit (the saved-route projection alone is not enough).
            if let Some(caller) = &channel.caller {
                return NativeProfileGuard::admit_workspace(&[caller.as_ref()], &[], mark);
            }
        }
        mark()
    });
    admission.finish(result)?;
    compact_epoch(channel, store, &original, deadline)
}

fn record_held_result(
    store: &SessionStore,
    original: &journal::Original,
    reply: &NativeRecoveryReply,
    result: &Value,
) -> Result<journal::Original, String> {
    let raw = serde_json::to_string(result).map_err(|error| error.to_string())?;
    // Admission precedes saved-route/lifecycle/SQL gates; no network is enclosed.
    let admission = journal::completion_admission(store)?;
    let projection = NativeProjection::new(reply);
    let outcome = NativeProjection::commit(&[&projection], || {
        authority::with_full_projection_transaction(store, |tx| {
            journal::record_result_tx(tx.connection(), original, &raw)
        })
    });
    admission.finish(outcome)
}

impl NativeWorkspaceTransport {
    /// Only already-consumed metadata is retried. No result/source owner is
    /// reconstructed, and one page cannot hold a fresh report for a full RPC.
    pub(crate) fn reconcile_buffer_acknowledgements(
        &self,
        store: &SessionStore,
    ) -> Result<(), String> {
        let channel = self.workspace.as_ref().ok_or_else(held)?;
        if !channel.delivery || !channel.delivery_ack {
            return Ok(());
        }
        channel.selection.with_current(|| Ok(()))?;
        let route = ws_fingerprint(&channel.selection.machine);
        let after = channel
            .delivery_ack_cursors
            .lock()
            .map_err(|_| held())?
            .get(&channel.selection.machine.id)
            .filter(|(fingerprint, _)| fingerprint == &route)
            .and_then(|(_, cursor)| cursor.clone());
        let page = journal::pending_remote_acks(store, &route, after.as_deref(), RECOVERY_PAGE)?;
        let deadline = std::time::Instant::now() + ACK_BUDGET;
        let mut cursor = after;
        let mut complete = true;
        for original in page.originals {
            if std::time::Instant::now() >= deadline {
                complete = false;
                break;
            }
            cursor = Some(original.ack_cursor());
            if original.method() == "native.buffers.update" {
                // A consumed local report can outlive its remote receipt. Probe
                // before cleanup; absence/unknown is no proof of remote retirement.
                let Ok(status) = call_until(channel, STATUS, binding(&original), None, deadline)
                else {
                    continue;
                };
                if matches(&status.reply.value, &original)
                    && matches!(
                        status.reply.value["state"].as_str(),
                        Some("recorded" | "retired")
                    )
                {
                    let _held =
                        remote_ack(channel, store, &original, Some(&status.reply), deadline);
                }
            }
        }
        if complete {
            cursor = page.next;
        }
        channel
            .delivery_ack_cursors
            .lock()
            .map_err(|_| held())?
            .insert(channel.selection.machine.id.clone(), (route, cursor));
        Ok(())
    }
    /// Reconcile a bounded page using only status. Historical results are stored
    /// independently of current source freshness; no old report is confirmed.
    pub(crate) fn reconcile_buffer_deliveries(&self, store: &SessionStore) -> Result<(), String> {
        let channel = self.workspace.as_ref().ok_or_else(held)?;
        if !channel.delivery {
            return Ok(());
        }
        channel.selection.with_current(|| Ok(()))?;
        let route = ws_fingerprint(&channel.selection.machine);
        let after = channel
            .delivery_cursors
            .lock()
            .map_err(|_| held())?
            .get(&channel.selection.machine.id)
            .filter(|(fingerprint, _)| fingerprint == &route)
            .and_then(|(_, cursor)| cursor.clone());
        let page = journal::pending(store, &route, after.as_deref(), RECOVERY_PAGE)?;
        let next = page.next.clone();
        let mut held_error = None;
        for original in page.originals {
            if original.method() != "native.buffers.update" {
                continue;
            }
            let attempt = (|| {
                let response = call(channel, STATUS, binding(&original), None)
                    .map_err(|error| error.message)?;
                response.reply.inspect(|value| {
                    if value["state"] == "absent" || value["state"] == "unknown" {
                        if value["state"] == "unknown" && !matches(value, &original) {
                            return Err(held());
                        }
                        return Ok(());
                    }
                    let result = recorded(value, &original)?;
                    record_held_result(store, &original, &response.reply, result)?;
                    Ok(())
                })
            })();
            if attempt.is_err() && held_error.is_none() {
                // Keep the original held, but one damaged/unavailable historical
                // row must not starve all later outcomes on every page attempt.
                held_error = Some(format!(
                    "NATIVE_DELIVERY_HELD: original {} could not be reconciled; its retained state was not advanced",
                    original.id(),
                ));
            }
        }
        channel
            .delivery_cursors
            .lock()
            .map_err(|_| held())?
            .insert(channel.selection.machine.id.clone(), (route, next));
        held_error.map_or(Ok(()), Err)
    }

    /// Every actual physical report binds its first exact outbound envelope
    /// before any dispatch, including the common small/legacy path.
    pub(crate) fn project_buffer_original<T>(
        &self,
        store: &SessionStore,
        semantic_key: &str,
        params: Value,
        consume: impl FnOnce(&Value, &NativeProjection<'_>, &journal::Original) -> Result<T, String>,
    ) -> Result<T, String> {
        let channel = self.workspace.as_ref().ok_or_else(held)?;
        channel.selection.with_current(|| Ok(()))?;
        let bytes = super::native_upload::capture(&params)?;
        let raw = std::str::from_utf8(&bytes).map_err(|_| held())?;
        let route = ws_fingerprint(&channel.selection.machine);
        let mut original = if epochs_supported(channel) {
            let epoch = ensure_epoch(channel, store)?;
            journal::epochs::prepare(
                store,
                semantic_key,
                &route,
                "native.buffers.update",
                raw,
                &epoch,
            )?
        } else {
            journal::prepare(store, semantic_key, &route, "native.buffers.update", raw)?
        };
        if epoch_wire::required(&original) && !epochs_supported(channel) {
            return Err("NATIVE_DELIVERY_EPOCH_REQUIRED: the original cannot fall back to an older Host protocol".into());
        }
        if original.phase() == journal::Phase::Acknowledged {
            return Err("NATIVE_DELIVERY_ALREADY_ACKNOWLEDGED: this original report was consumed; its terminal delivery cannot confirm another report".into());
        }
        // Verify retained bytes too, rather than rebuilding an old envelope from
        // current PID, owners, time or a newly minted report nonce.
        let retained = journal::params_json(store, &original)?;
        if retained.as_bytes() != bytes {
            return Err(held());
        }

        let response = if !original.can_dispatch() {
            if !channel.delivery {
                return Err(held());
            }
            call(channel, STATUS, binding(&original), None).map_err(|error| error.message)?
        } else {
            let mut wrapper = binding(&original);
            wrapper["paramsJson"] = Value::String(retained);
            let method = if channel.delivery {
                APPLY
            } else {
                "native.buffers.update"
            };
            let request = if channel.delivery { wrapper } else { params };
            if channel.uploads && !NativeProfileBroker::supports_workspace_params(method, &request)
            {
                let delivery = channel
                    .delivery
                    .then(|| super::native_upload::DeliveryBinding {
                        original_id: original.id().into(),
                        sha256: original.payload_sha256().into(),
                        byte_length: original.payload_bytes(),
                    });
                let original_id = original.id().to_owned();
                super::native_upload::upload_buffers_original(
                    channel,
                    &bytes,
                    &original_id,
                    delivery,
                    &mut |transition| {
                        original = match transition {
                            super::native_upload::CommitTransition::Possible => {
                                journal::mark_possible(store, &original)?
                            }
                            super::native_upload::CommitTransition::DefinitelyUnsent => {
                                journal::definitely_unsent(store, &original)?
                            }
                        };
                        Ok(())
                    },
                )?
            } else {
                original = journal::mark_possible(store, &original)?;
                match call(channel, method, request, Some(original.id())) {
                    Ok(response) => response,
                    Err(error) => {
                        if error.definitely_unsent {
                            let _ = journal::definitely_unsent(store, &original)?;
                        }
                        return Err(error.message);
                    }
                }
            }
        };
        let result = response.reply.inspect(|value| {
            let result = if channel.delivery {
                recorded(value, &original)?
            } else {
                if value["acknowledged"] != true {
                    return Err(held());
                }
                value
            };
            let recorded = record_held_result(store, &original, &response.reply, result)?;
            consume(result, &NativeProjection::new(&response.reply), &recorded)
        });
        if result.is_ok() {
            if let Some(upload) = response.upload {
                upload.applied();
            }
            channel.pending.applied_original(
                &ws_fingerprint(&channel.selection.machine),
                &super::native_upload::DeliveryBinding {
                    original_id: original.id().into(),
                    sha256: original.payload_sha256().into(),
                    byte_length: original.payload_bytes(),
                },
            );
            // Local source confirmation already committed. Cleanup failure is
            // retryable outbox metadata and must not reverse that success.
            let _retirement = remote_ack(
                channel,
                store,
                &original,
                Some(&response.reply),
                std::time::Instant::now() + ACK_BUDGET,
            );
        }
        result
    }
}

#[cfg(test)]
#[path = "remote_native_buffer_delivery_tests.rs"]
mod tests;
