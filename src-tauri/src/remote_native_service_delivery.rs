//! Exact original helper requests on the actual managed Native Store.
//! A retained row is data, never an issuer, pending desktop grant or replay permit.
use super::super::native_delivery_epochs as epoch_wire;
use super::*;
use crate::session_store::{authority, native_delivery as journal, SessionStore};
use journal::{Original, Phase};

/// Best-effort remote cleanup (retirement ACK and epoch compaction) after work
/// that already succeeded locally. It must not hold the caller; whatever it
/// misses stays retained and is retried by reconciliation or the next epoch
/// open. Tests assert the cleanup itself, so they allow a stalled CI runner.
#[cfg(not(test))]
const CLEANUP_BUDGET: std::time::Duration = std::time::Duration::from_millis(250);
#[cfg(test)]
const CLEANUP_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);

fn epochs_supported(channel: &NativeServiceChannel) -> bool {
    channel.delivery_supported
        && channel.delivery_ack_supported
        && channel.delivery_epochs_supported
}

fn epoch_call(
    channel: &Arc<NativeServiceChannel>,
    method: &str,
    params: Value,
    deadline: Instant,
) -> Result<NativeServiceReply, String> {
    channel.check()?;
    if channel.websocket {
        match channel.wire(method, params.clone(), deadline) {
            Ok(reply) => return Ok(reply),
            Err(error) if error.unsupported && !error.uncertain => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    channel.with_current(&[], || Ok(()))?;
    http(channel, method, params, deadline)
}

fn commit_epoch(
    channel: &Arc<NativeServiceChannel>,
    response: &NativeServiceReply,
) -> Result<journal::epochs::EpochHandle, String> {
    let description = epoch_wire::description(&response.value)?;
    let fingerprint = route(channel)?;
    access(channel)?.with(|store| {
        let admission = journal::completion_admission(store)?;
        let guards = response.guards();
        let result = channel.with_current(&guards, || {
            authority::with_full_projection_transaction(store, |tx| {
                let epoch =
                    journal::epochs::bind_tx(tx.connection(), store, &fingerprint, &description)?;
                journal::epochs::compact_tx(tx.connection(), &epoch, &description)?;
                Ok(epoch)
            })
        });
        let epoch = admission.finish(result)?;
        journal::epochs::current(store, &epoch)
    })
}

fn ensure_epoch(
    channel: &Arc<NativeServiceChannel>,
    deadline: Instant,
) -> Result<journal::epochs::EpochHandle, String> {
    if !epochs_supported(channel) {
        return Err("NATIVE_DELIVERY_EPOCH_REQUIRED: update the selected Host".into());
    }
    let fingerprint = route(channel)?;
    let request = access(channel)?.with(|store| epoch_wire::open_params(store, &fingerprint))?;
    let response = epoch_call(channel, epoch_wire::OPEN, request, deadline)?;
    let epoch = commit_epoch(channel, &response)?;
    let maintenance = access(channel)?.with(|store| epoch_wire::compact_params(store, &epoch))?;
    if let Some(params) = maintenance {
        let cleanup_deadline = deadline.min(Instant::now() + CLEANUP_BUDGET);
        if let Ok(response) = epoch_call(channel, epoch_wire::COMPACT, params, cleanup_deadline) {
            let _ = commit_epoch(channel, &response);
        }
    }
    access(channel)?.with(|store| journal::epochs::current(store, &epoch))
}

fn compact_epoch(
    channel: &Arc<NativeServiceChannel>,
    original: &Original,
    deadline: Instant,
) -> Result<(), String> {
    if !epoch_wire::required(original) {
        return Ok(());
    }
    if !epochs_supported(channel) {
        return Err(held(original));
    }
    let epoch = access(channel)?
        .with(|store| journal::epochs::for_original(store, original))?
        .ok_or_else(|| held(original))?;
    let request = access(channel)?.with(|store| epoch_wire::compact_params(store, &epoch))?;
    let (method, params) = match request {
        Some(params) => (epoch_wire::COMPACT, params),
        None => (epoch_wire::STATUS, epoch_wire::reference(&epoch)),
    };
    let response = epoch_call(channel, method, params, deadline)?;
    commit_epoch(channel, &response)?;
    Ok(())
}

pub(super) fn supports_host(descriptor: &Value) -> bool {
    let Some(capabilities) = descriptor["capabilities"].as_array() else {
        return false;
    };
    let Some(methods) = descriptor["methods"].as_array() else {
        return false;
    };
    ["native.services.delivery.v1", "native.services.v1"]
        .iter()
        .all(|cap| {
            capabilities
                .iter()
                .any(|value| value.as_str() == Some(*cap))
        })
        && [
            "native.services.delivery.apply",
            "native.services.delivery.status",
            "native.services.delivery.result.read",
            "native.services.upload.begin",
            "native.services.upload.append",
            "native.services.upload.commit",
        ]
        .iter()
        .all(|method| methods.iter().any(|value| value.as_str() == Some(*method)))
}

pub(super) fn supports_ack_host(descriptor: &Value) -> bool {
    supports_host(descriptor)
        && descriptor["capabilities"].as_array().is_some_and(|caps| {
            caps.iter()
                .any(|cap| cap.as_str() == Some("native.services.delivery.ack.v1"))
        })
        && descriptor["methods"].as_array().is_some_and(|methods| {
            methods
                .iter()
                .any(|method| method.as_str() == Some("native.services.delivery.ack"))
        })
}

const RESULT_BYTES: usize = 32 * 1024 * 1024;
pub(super) fn supports_bounded_format_host(descriptor: &Value) -> bool {
    supports_host(descriptor)
        && descriptor["capabilities"].as_array().is_some_and(|caps| {
            caps.iter()
                .any(|cap| cap.as_str() == Some("native.services.workspace.format.bounded.v1"))
        })
}

static FORMAT_OWNERS: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

/// Lifetime of the actual formatter caller, including its unconsumed reply.
/// Recovery may discard a terminal result only after this owner is gone.
pub(super) struct FormatOwner(String);
impl FormatOwner {
    fn claim(original: &Original) -> Result<Self, String> {
        let mut owners = FORMAT_OWNERS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| "Native formatter owners are unavailable")?;
        if owners.len() >= 256 || !owners.insert(original.id().to_owned()) {
            return Err("Native formatter callers are at capacity".into());
        }
        Ok(Self(original.id().to_owned()))
    }
    fn is_live(original: &Original) -> bool {
        FORMAT_OWNERS
            .get_or_init(Mutex::default)
            .lock()
            .map(|owners| owners.contains(original.id()))
            .unwrap_or(true)
    }
}
impl Drop for FormatOwner {
    fn drop(&mut self) {
        if let Ok(mut owners) = FORMAT_OWNERS.get_or_init(Mutex::default).lock() {
            owners.remove(&self.0);
        }
    }
}
static RESULT_BUDGET: std::sync::OnceLock<Mutex<(usize, usize)>> = std::sync::OnceLock::new();

/// Whole decoded target-result ownership, retained beside actual reply guards.
pub(super) struct ResultCharge {
    bytes: usize,
}
impl ResultCharge {
    fn reserve(bytes: usize) -> Result<Self, String> {
        if bytes == 0 || bytes > RESULT_BYTES {
            return Err("Native helper result exceeds its existing32MiB limit".into());
        }
        let mut budget = RESULT_BUDGET
            .get_or_init(|| Mutex::new((0, 0)))
            .lock()
            .map_err(|_| "Native helper result budget is unavailable")?;
        if budget.0 > (64 * 1024 * 1024usize).saturating_sub(bytes) || budget.1 >= 4 {
            return Err(
                "Native helper result capacity is held by unfinished original deliveries".into(),
            );
        }
        budget.0 += bytes;
        budget.1 += 1;
        Ok(Self { bytes })
    }
}
impl Drop for ResultCharge {
    fn drop(&mut self) {
        let mut budget = RESULT_BUDGET
            .get_or_init(|| Mutex::new((0, 0)))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        budget.0 = budget.0.saturating_sub(self.bytes);
        budget.1 = budget.1.saturating_sub(1);
    }
}

pub(super) enum JournalAccess {
    Managed {
        app: AppHandle,
        instance: uuid::Uuid,
    },
    #[cfg(test)]
    Fixture {
        store: Arc<SessionStore>,
        instance: uuid::Uuid,
    },
}

impl JournalAccess {
    pub(super) fn capture(app: &AppHandle) -> Option<Self> {
        let instance = app.try_state::<SessionStore>()?.native_instance_id();
        Some(Self::Managed {
            app: app.clone(),
            instance,
        })
    }

    #[cfg(test)]
    fn fixture(store: Arc<SessionStore>) -> Self {
        Self::Fixture {
            instance: store.native_instance_id(),
            store,
        }
    }

    fn with<T>(
        &self,
        action: impl FnOnce(&SessionStore) -> Result<T, String>,
    ) -> Result<T, String> {
        match self {
            Self::Managed { app, instance } => {
                let store = app
                    .try_state::<SessionStore>()
                    .ok_or("Native helper Store is unavailable")?;
                if store.native_instance_id() != *instance {
                    return Err(
                        "Native helper Store was replaced; the original delivery remains held"
                            .into(),
                    );
                }
                action(&store)
            }
            #[cfg(test)]
            Self::Fixture { store, instance } => {
                if store.native_instance_id() != *instance {
                    return Err("Native helper fixture Store was replaced".into());
                }
                action(store)
            }
        }
    }
}

fn access(channel: &NativeServiceChannel) -> Result<&JournalAccess, String> {
    channel.journal.as_ref().ok_or_else(|| {
        "Native helper delivery requires the actual managed Store; no request was dispatched".into()
    })
}

fn route(channel: &NativeServiceChannel) -> Result<String, String> {
    channel.with_saved(|| {
        let selection = channel
            .selection
            .as_ref()
            .ok_or("Native helper profile is unavailable")?;
        Ok(ws_fingerprint(&selection.machine))
    })
}

fn held(original: &Original) -> String {
    format!("NATIVE_SERVICE_DELIVERY_UNCONFIRMED: original {} may have completed; its outcome must be reconciled. Do not repeat the helper effect or create another request for it.", original.id())
}

fn retired(original: &Original) -> String {
    format!("NATIVE_SERVICE_DELIVERY_RETIRED: original {} was consumed and retired. Do not repeat the helper effect or consume its result again.", original.id())
}

pub(super) fn binding(original: &Original) -> Value {
    json!({"originalId":original.id(),"sha256":original.payload_sha256(),"byteLength":original.payload_bytes()})
}

fn status_params(original: &Original) -> Value {
    let mut value = binding(original);
    value["target"] = json!(original.method());
    value
}

pub(super) fn mark_possible(
    channel: &Arc<NativeServiceChannel>,
    original: &Original,
) -> Result<Original, String> {
    channel.admit(|| access(channel)?.with(|store| journal::mark_possible(store, original)))
}

pub(super) fn retain_failure(
    channel: &NativeServiceChannel,
    original: &Original,
    error: &WsFailure,
) {
    if !error.uncertain {
        // Only a trusted, definite never-dispatched transport outcome can reopen
        // this same runtime's preparation. Missing remote status never does.
        let _ = access(channel)
            .and_then(|access| access.with(|store| journal::definitely_unsent(store, original)));
    }
}

fn valid_result(target: &str, result: &Value) -> bool {
    match target {
        "native.services.conversation.desktop.finish" => result
            .as_object()
            .is_some_and(|value| value.len() == 1 && value.get("accepted") == Some(&json!(true))),
        "native.services.workspace.format" => {
            result.is_null()
                || result.as_object().is_some_and(|value| {
                    // Older Hosts forwarded Prettier's internal comments array.
                    // Accept that known metadata so their retained original result
                    // can be reconciled without replaying the formatter effect.
                    (value.len() == 2
                        || (value.len() == 3 && value.get("comments").is_some_and(Value::is_array)))
                        && value.get("formatted").is_some_and(Value::is_string)
                        && value
                            .get("cursorOffset")
                            .and_then(Value::as_u64)
                            .is_some_and(|value| value <= 9_007_199_254_740_991)
                })
        }
        _ => false,
    }
}

#[cfg(test)]
mod formatter_result_tests {
    use super::*;

    #[test]
    fn accepts_public_and_legacy_prettier_results_only() {
        let target = "native.services.workspace.format";
        assert!(valid_result(target, &Value::Null));
        assert!(valid_result(
            target,
            &json!({"formatted":"const a = 1;\n","cursorOffset":0})
        ));
        assert!(valid_result(
            target,
            &json!({"formatted":"// comment\n","cursorOffset":0,"comments":[{"type":"CommentLine","value":" comment"}]})
        ));
        assert!(!valid_result(
            target,
            &json!({"formatted":"x","cursorOffset":0,"comments":false})
        ));
        assert!(!valid_result(
            target,
            &json!({"formatted":"x","cursorOffset":0,"other":[]})
        ));
        assert!(!valid_result(
            target,
            &json!({"formatted":"x","cursorOffset":-1,"comments":[]})
        ));
        assert!(!valid_result(
            target,
            &json!({"formatted":"x","cursorOffset":0,"comments":[],"other":true})
        ));
    }
}

fn exact_binding(value: &Value, original: &Original) -> bool {
    value["originalId"] == original.id()
        && value["sha256"] == original.payload_sha256()
        && value["byteLength"] == original.payload_bytes()
        && value["target"] == original.method()
}

fn recorded_binding(value: &Value, original: &Original) -> Result<(), String> {
    if value["state"] != "recorded" || !exact_binding(value, original) {
        return Err(held(original));
    }
    Ok(())
}

fn read_result_source(
    reply: &mut NativeServiceReply,
    original: &Original,
    deadline: Instant,
) -> Result<(), String> {
    use base64::Engine;
    let source = reply.project(|value| {
        recorded_binding(value, original)?;
        if value.get("result").is_some() {
            return Err(held(original));
        }
        let source = value.get("resultSource").ok_or_else(|| held(original))?;
        let hash = source["sha256"]
            .as_str()
            .filter(|hash| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
            .ok_or_else(|| held(original))?;
        let bytes = source["byteLength"]
            .as_u64()
            .and_then(|bytes| usize::try_from(bytes).ok())
            .filter(|bytes| *bytes > 0 && *bytes <= original.result_budget())
            .ok_or_else(|| held(original))?;
        Ok((source.clone(), hash.to_owned(), bytes))
    })?;
    let charge = ResultCharge::reserve(source.2)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(source.2)
        .map_err(|_| held(original))?;
    reply
        .related_guards
        .try_reserve(source.2.div_ceil(65_536))
        .map_err(|_| held(original))?;
    while bytes.len() < source.2 {
        let offset = bytes.len();
        let limit = (source.2 - offset).min(65_536);
        let mut params = status_params(original);
        params["resultSource"] = source.0.clone();
        params["offset"] = json!(offset);
        params["limit"] = json!(limit);
        let mut chunk = if reply.channel.websocket {
            match reply.channel.wire(
                "native.services.delivery.result.read",
                params.clone(),
                deadline,
            ) {
                Ok(reply) => reply,
                Err(error) if error.unsupported && !error.uncertain => http(
                    &reply.channel,
                    "native.services.delivery.result.read",
                    params,
                    deadline,
                )?,
                Err(_) => return Err(held(original)),
            }
        } else {
            http(
                &reply.channel,
                "native.services.delivery.result.read",
                params,
                deadline,
            )?
        };
        let mut guards = reply.guards();
        guards.extend(chunk.guards());
        reply.channel.with_current(&guards, || {
            let value = &chunk.value;
            if value["originalId"] != original.id()
                || value["sha256"] != original.payload_sha256()
                || value["byteLength"] != original.payload_bytes()
                || value["target"] != original.method()
                || value["resultSource"] != source.0
                || value["offset"] != offset
            {
                return Err(held(original));
            }
            let data = value["data"]
                .as_str()
                .filter(|data| data.len() == limit.div_ceil(3) * 4)
                .ok_or_else(|| held(original))?;
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| held(original))?;
            if decoded.len() != limit
                || base64::engine::general_purpose::STANDARD.encode(&decoded) != data
            {
                return Err(held(original));
            }
            bytes.extend_from_slice(&decoded);
            Ok(())
        })?;
        drop(guards);
        if let Some(guard) = chunk.guard.take() {
            reply.related_guards.push(guard);
        }
        reply.related_guards.append(&mut chunk.related_guards);
        // Encoded chunk values are released now; only their real native guards
        // and the whole decoded-result reservation survive through consumption.
    }
    if bytes.len() != source.2 || format!("{:x}", Sha256::digest(&bytes)) != source.1 {
        return Err(held(original));
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| held(original))?;
    drop(bytes);
    let guards = reply.guards();
    reply.channel.with_current(&guards, || {
        if !valid_result(original.method(), &value) {
            return Err(held(original));
        }
        Ok(())
    })?;
    reply.value = value;
    reply.result_charge = Some(charge);
    Ok(())
}

fn persist_reply(
    mut reply: NativeServiceReply,
    original: &Original,
    mut wrapped: bool,
    deadline: Instant,
) -> Result<NativeServiceReply, String> {
    // Uploads attach the actual possible-dispatch revision after staging.
    let original = reply.delivery.take().unwrap_or_else(|| original.clone());
    if original.phase() == Phase::Acknowledged {
        // Local consumption is terminal even when an older Host still retains
        // a recorded result. Never download or project that old output again.
        return reply.project(|_| Err(retired(&original)));
    }
    if wrapped
        && reply.channel.bounded_format_supported
        && original.method() == "native.services.workspace.format"
        && reply.value["state"] == "unknown"
        && reply.value["resultUnavailable"] == true
    {
        let channel = reply.channel.clone();
        access(&channel)?.with(|store| {
            let admission = journal::completion_admission(store)?;
            let outcome = reply.project(|value| {
                if !exact_binding(value, &original)
                    || value.get("result").is_some()
                    || value.get("resultSource").is_some()
                    || value.get("consumedResult").is_some()
                {
                    return Err(held(&original));
                }
                authority::with_full_projection_transaction(store, |tx| {
                    journal::release_unavailable_result_tx(tx.connection(), &original)
                })
            });
            admission.finish(outcome)
        })?;
        return Err(held(&original));
    }
    if wrapped && reply.value["state"] == "retired" {
        return reply.project(|value| {
            if !exact_binding(value, &original) {
                return Err(held(&original));
            }
            Err(retired(&original))
        });
    }
    if wrapped && reply.value.get("resultSource").is_some() {
        read_result_source(&mut reply, &original, deadline)?;
        wrapped = false;
    }
    let mut owned = std::mem::take(&mut reply.value);
    let channel = reply.channel.clone();
    let (result, recorded, charge) = access(&channel)?.with(|store| {
        let admission = journal::completion_admission(store)?;
        let outcome = reply.project(|_| {
            let result = if wrapped {
                recorded_binding(&owned, &original)?;
                if owned.get("resultSource").is_some() {
                    return Err(held(&original));
                }
                owned
                    .as_object_mut()
                    .and_then(|value| value.remove("result"))
                    .ok_or_else(|| held(&original))?
            } else {
                owned
            };
            if !valid_result(original.method(), &result) {
                return Err(held(&original));
            }
            let result_json = serde_json::to_string(&result).map_err(|_| held(&original))?;
            let charge = if reply.result_charge.is_none() {
                Some(ResultCharge::reserve(result_json.len())?)
            } else {
                None
            };
            let recorded = authority::with_full_projection_transaction(store, |tx| {
                journal::record_result_tx(tx.connection(), &original, &result_json)
            })?;
            Ok((result, recorded, charge))
        });
        admission.finish(outcome)
    })?;
    reply.value = result;
    if charge.is_some() {
        reply.result_charge = charge;
    }
    reply.delivery = (recorded.phase() != Phase::Acknowledged).then_some(recorded);
    Ok(reply)
}

pub(super) fn http(
    channel: &Arc<NativeServiceChannel>,
    method: &str,
    params: Value,
    deadline: Instant,
) -> Result<NativeServiceReply, String> {
    channel.check()?;
    let selection = channel
        .selection
        .as_ref()
        .ok_or("Native helper profile is unavailable")?;
    let value = rpc_until(
        &selection.endpoint,
        &selection.machine.token,
        Some(&selection.machine.environment_id),
        method,
        params,
        deadline,
    )?;
    channel.check()?;
    Ok(NativeServiceReply {
        value,
        guard: None,
        channel: channel.clone(),
        delivery: None,
        related_guards: Vec::new(),
        result_charge: None,
        consumed: Mutex::new(false),
        format_owner: None,
    })
}

fn status(
    channel: &Arc<NativeServiceChannel>,
    original: &Original,
    deadline: Instant,
) -> Result<NativeServiceReply, String> {
    if epoch_wire::required(original) && !epochs_supported(channel) {
        return Err(held(original));
    }
    if !channel.delivery_supported || route(channel)? != original.route_fingerprint() {
        return Err(held(original));
    }
    let params = status_params(original);
    let reply = if channel.websocket {
        match channel.wire("native.services.delivery.status", params.clone(), deadline) {
            Ok(reply) => reply,
            Err(error) if error.unsupported && !error.uncertain => {
                http(channel, "native.services.delivery.status", params, deadline)?
            }
            Err(_) => return Err(held(original)),
        }
    } else {
        http(channel, "native.services.delivery.status", params, deadline)?
    };
    persist_reply(reply, original, true, deadline)
}

fn apply(
    channel: &Arc<NativeServiceChannel>,
    legacy: &str,
    original: &Original,
    params_json: &str,
    deadline: Instant,
) -> Result<NativeServiceReply, String> {
    if epoch_wire::required(original) && !epochs_supported(channel) {
        return Err(held(original));
    }
    let mut wrapper = status_params(original);
    wrapper["paramsJson"] = json!(params_json);
    if channel.delivery_supported {
        if !crate::host_ws::native_profile::NativeProfileBroker::supports_service_params(
            "native.services.delivery.apply",
            &wrapper,
        ) {
            let reply = channel.upload_bytes(
                original.method(),
                params_json.as_bytes(),
                Some(original),
                true,
                deadline,
            )?;
            return persist_reply(reply, original, true, deadline);
        }
        let possible = mark_possible(channel, original)?;
        let reply = if channel.websocket {
            match channel.wire("native.services.delivery.apply", wrapper.clone(), deadline) {
                Ok(reply) => reply,
                Err(error) if error.unsupported && !error.uncertain => {
                    // Same durable owner and original ID, compatibility ingress only.
                    http(channel, "native.services.delivery.apply", wrapper, deadline)
                        .map_err(|_| held(&possible))?
                }
                Err(error) => {
                    retain_failure(channel, &possible, &error);
                    return Err(held(&possible));
                }
            }
        } else {
            http(channel, "native.services.delivery.apply", wrapper, deadline)
                .map_err(|_| held(&possible))?
        };
        return persist_reply(reply, &possible, true, deadline);
    }

    // Old Hosts still get only one original effect attempt. Their missing status
    // protocol can never turn a restored/possible original into another call.
    let params: Value = serde_json::from_str(params_json).map_err(|_| held(original))?;
    if channel.websocket {
        if !crate::host_ws::native_profile::NativeProfileBroker::supports_service_params(
            original.method(),
            &params,
        ) {
            let reply = channel.upload_bytes(
                original.method(),
                params_json.as_bytes(),
                Some(original),
                false,
                deadline,
            )?;
            return persist_reply(reply, original, false, deadline);
        }
        let possible = mark_possible(channel, original)?;
        match channel.wire(original.method(), params.clone(), deadline) {
            Ok(reply) => return persist_reply(reply, &possible, false, deadline),
            Err(error) if error.unsupported && !error.uncertain => {
                retain_failure(channel, &possible, &error);
            }
            Err(error) => {
                retain_failure(channel, &possible, &error);
                return Err(held(&possible));
            }
        }
    }
    // Re-read the same immutable preparation after a proven predispatch WS miss.
    let prepared = access(channel)?.with(|store| {
        journal::prepare(
            store,
            original.semantic_key(),
            original.route_fingerprint(),
            original.method(),
            params_json,
        )
    })?;
    let possible = mark_possible(channel, &prepared)?;
    let reply = http(channel, legacy, params, deadline).map_err(|_| held(&possible))?;
    persist_reply(reply, &possible, false, deadline)
}

pub(super) fn request(
    channel: &Arc<NativeServiceChannel>,
    legacy: &str,
    target: &str,
    params: Value,
    deadline: Instant,
) -> Result<NativeServiceReply, String> {
    let fingerprint = route(channel)?;
    if target == "native.services.workspace.format" {
        reconcile_pending(
            channel,
            deadline.min(Instant::now() + std::time::Duration::from_secs(2)),
        )?;
    }
    let bytes = bounded_params(&params)?;
    let params_json =
        std::str::from_utf8(&bytes).map_err(|_| "Native helper original is not UTF8")?;
    let semantic_key = match target {
        "native.services.conversation.desktop.finish" => {
            let id = params["id"]
                .as_str()
                .ok_or("Native desktop finish requires its original relay ID")?;
            format!(
                "service.finish:{fingerprint}:{:x}",
                Sha256::digest(id.as_bytes())
            )
        }
        "native.services.workspace.format" => {
            format!("service.format:{fingerprint}:{}", uuid::Uuid::new_v4())
        }
        _ => return Err("Unsupported durable Native helper target".into()),
    };
    let original = if epochs_supported(channel) {
        let epoch = ensure_epoch(channel, deadline)?;
        access(channel)?.with(|store| {
            journal::epochs::prepare_with_budget(
                store,
                &semantic_key,
                &fingerprint,
                target,
                params_json,
                &epoch,
                if target == "native.services.workspace.format" && channel.bounded_format_supported
                {
                    journal::FORMAT_RESULT_BYTES
                } else if target == "native.services.workspace.format" {
                    journal::MAX_RESULT_BYTES
                } else {
                    64 * 1024
                },
            )
        })?
    } else {
        access(channel)?.with(|store| {
            journal::prepare_with_budget(
                store,
                &semantic_key,
                &fingerprint,
                target,
                params_json,
                if target == "native.services.workspace.format" && channel.bounded_format_supported
                {
                    journal::FORMAT_RESULT_BYTES
                } else if target == "native.services.workspace.format" {
                    journal::MAX_RESULT_BYTES
                } else {
                    64 * 1024
                },
            )
        })?
    };
    if epoch_wire::required(&original) && !epochs_supported(channel) {
        return Err(held(&original));
    }
    let owner = (target == "native.services.workspace.format")
        .then(|| FormatOwner::claim(&original))
        .transpose()?;
    let mut reply = if !original.can_dispatch() {
        status(channel, &original, deadline)?
    } else {
        apply(channel, legacy, &original, params_json, deadline)?
    };
    reply.format_owner = owner;
    Ok(reply)
}

pub(super) fn project<T>(
    reply: &NativeServiceReply,
    consume: impl FnOnce(&Value) -> Result<T, String>,
) -> Result<T, String> {
    project_with_deadline(reply, consume, None)
}

fn project_with_deadline<T>(
    reply: &NativeServiceReply,
    consume: impl FnOnce(&Value) -> Result<T, String>,
    cleanup_deadline: Option<Instant>,
) -> Result<T, String> {
    let Some(original) = &reply.delivery else {
        let guards = reply.guards();
        return reply
            .channel
            .with_current(&guards, || consume(&reply.value));
    };
    let mut consumed = reply
        .consumed
        .lock()
        .map_err(|_| "Native helper consumption state is unavailable")?;
    if *consumed {
        return Err(retired(original));
    }
    let value = access(&reply.channel)?.with(|store| {
        // Admission precedes Remote reply/lifecycle gates; SQL then runs inside
        // those retained gates without taking another process admission.
        let admission = journal::completion_admission(store)?;
        let guards = reply.guards();
        let outcome = reply.channel.with_current(&guards, || {
            let value = consume(&reply.value)?;
            *consumed = true;
            authority::with_full_projection_transaction(store, |tx| {
                journal::acknowledge_tx(tx.connection(), original)?;
                Ok(value)
            }).map_err(|error| format!("{error} Native helper output may already have been consumed; the local receipt for original {} is unconfirmed. Do not repeat the helper effect.", original.id()))
        });
        admission.finish(outcome)
    })?;
    drop(consumed);
    // The successful consumer and local FULL receipt are already complete.
    // Remote capacity retirement is best-effort and cannot turn that success
    // into an error or authorize another effect/consumer attempt.
    let _ = acknowledge_consumed(
        reply,
        original,
        cleanup_deadline.unwrap_or_else(|| Instant::now() + CLEANUP_BUDGET),
    );
    Ok(value)
}

fn acknowledge_consumed(
    reply: &NativeServiceReply,
    original: &Original,
    deadline: Instant,
) -> Result<(), String> {
    if !reply.channel.delivery_ack_supported {
        return Ok(());
    }
    let candidate =
        access(&reply.channel)?.with(|store| journal::remote_ack_candidate(store, original))?;
    if let Some(candidate) = candidate {
        acknowledge_remote(&reply.channel, &candidate, &reply.guards(), deadline)?;
    }
    Ok(())
}

fn acknowledge_remote(
    channel: &Arc<NativeServiceChannel>,
    original: &Original,
    retained_guards: &[&NativeProfileGuard],
    deadline: Instant,
) -> Result<(), String> {
    if epoch_wire::required(original) && !epochs_supported(channel) {
        return Err(held(original));
    }
    if !channel.delivery_ack_supported || route(channel)? != original.route_fingerprint() {
        return Err("Native helper retirement requires its current original issuer".into());
    }
    let (sha256, byte_length) = original.consumed_result()?;
    let consumed = json!({"sha256":sha256,"byteLength":byte_length});
    let mut params = status_params(original);
    params["consumedResult"] = consumed.clone();
    let response = if channel.websocket {
        match channel.wire_ack(params.clone(), retained_guards, deadline) {
            Ok(reply) => reply,
            Err(error) if error.unsupported && !error.uncertain => {
                channel.with_current(retained_guards, || Ok(()))?;
                http(channel, "native.services.delivery.ack", params, deadline)?
            }
            Err(error) => return Err(error.to_string()),
        }
    } else {
        channel.with_current(retained_guards, || Ok(()))?;
        http(channel, "native.services.delivery.ack", params, deadline)?
    };
    access(channel)?.with(|store| {
        let admission = journal::completion_admission(store)?;
        let mut guards = retained_guards.to_vec();
        guards.extend(response.guards());
        let outcome = channel.with_current(&guards, || {
            let value = &response.value;
            if value["state"] != "retired"
                || !exact_binding(value, original)
                || value["consumedResult"] != consumed
            {
                return Err(
                    "Native helper retirement receipt does not match the consumed original".into(),
                );
            }
            authority::with_full_projection_transaction(store, |tx| {
                journal::mark_remote_acked_tx(tx.connection(), original)
            })
        });
        admission.finish(outcome)
    })?;
    compact_epoch(channel, original, deadline)
}

/// Retry only already consumed local receipts, never effects or old consumers.
/// A separate cursor keeps buffer and service outboxes independently fair.
pub(super) fn reconcile_remote_acks(
    channel: &Arc<NativeServiceChannel>,
    deadline: Instant,
) -> Result<usize, String> {
    if !channel.delivery_ack_supported {
        return Ok(0);
    }
    let fingerprint = route(channel)?;
    let after = channel
        .delivery_ack_cursor
        .lock()
        .map_err(|_| "Native helper retirement cursor is unavailable")?
        .clone();
    let page = access(channel)?
        .with(|store| journal::pending_remote_acks(store, &fingerprint, after.as_deref(), 4))?;
    let mut acknowledged = 0;
    let mut cursor = after;
    let mut complete_page = true;
    for original in page.originals {
        if !matches!(
            original.method(),
            "native.services.conversation.desktop.finish" | "native.services.workspace.format"
        ) {
            cursor = Some(original.ack_cursor());
            continue;
        }
        if Instant::now() >= deadline {
            complete_page = false;
            break;
        }
        if acknowledge_remote(channel, &original, &[], deadline).is_ok() {
            acknowledged += 1;
        }
        cursor = Some(original.ack_cursor());
    }
    *channel
        .delivery_ack_cursor
        .lock()
        .map_err(|_| "Native helper retirement cursor is unavailable")? =
        if complete_page { page.next } else { cursor };
    Ok(acknowledged)
}

/// Status reconciliation, bounded by the caller's single deadline. It never
/// recreates a former requester. Terminal orphan formatter output is explicitly
/// discarded; no editor receives it and the original effect is never replayed.
pub(super) fn reconcile_pending(
    channel: &Arc<NativeServiceChannel>,
    deadline: Instant,
) -> Result<usize, String> {
    if !channel.delivery_supported {
        return Ok(0);
    }
    if channel.delivery_ack_supported {
        let now = Instant::now();
        let ack_deadline = now + deadline.saturating_duration_since(now) / 2;
        let _ = reconcile_remote_acks(channel, ack_deadline);
    }
    let fingerprint = route(channel)?;
    let after = channel
        .delivery_cursor
        .lock()
        .map_err(|_| "Native helper recovery cursor is unavailable")?
        .clone();
    let page = access(channel)?
        .with(|store| journal::pending(store, &fingerprint, after.as_deref(), 4))?;
    let mut recorded = 0;
    let mut cursor = after;
    let mut complete_page = true;
    for original in page.originals {
        if !matches!(
            original.method(),
            "native.services.conversation.desktop.finish" | "native.services.workspace.format"
        ) || original.can_dispatch()
            || FormatOwner::is_live(&original)
        {
            cursor = Some(original.id().to_owned());
            continue;
        }
        if Instant::now() >= deadline {
            complete_page = false;
            break;
        }
        if let Ok(reply) = status(channel, &original, deadline) {
            if original.method() == "native.services.workspace.format" {
                // No new owner can be constructed for this original: format
                // invocations allocate fresh identities, and the live owner
                // stays registered through its reply's final drop.
                let _ = project_with_deadline(&reply, |_| Ok(()), Some(deadline));
            }
            drop(reply);
            recorded += 1;
        }
        cursor = Some(original.id().to_owned());
    }
    *channel
        .delivery_cursor
        .lock()
        .map_err(|_| "Native helper recovery cursor is unavailable")? =
        if complete_page { page.next } else { cursor };
    Ok(recorded)
}

#[cfg(test)]
#[path = "remote_native_service_delivery_tests.rs"]
mod tests;
