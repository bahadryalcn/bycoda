//! Neutral epoch codecs only. These values never grant a caller, local ACK,
//! producer freshness or permission to replay an original.
use crate::session_store::{native_delivery as journal, SessionStore};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(super) const OPEN: &str = "native.delivery.epochs.open";
pub(super) const STATUS: &str = "native.delivery.epochs.status";
pub(super) const COMPACT: &str = "native.delivery.epochs.compact";
pub(super) const CLOSE: &str = "native.delivery.epochs.close";
pub(super) const GAP_RESOLVE: &str = "native.delivery.epochs.gap.resolve";
const GAP_CAPABILITY: &str = "native.delivery.epochs.gaps.v1";

/// A gap lookup settles its slot for good, so it gets its own window instead of the
/// 250 ms cleanup budget: on a busy Host that budget expired on every attempt and one
/// unresolved slot held the whole epoch prefix (tens of thousands of retained rows).
#[cfg(not(test))]
pub(super) const GAP_BUDGET: Duration = Duration::from_secs(3);
#[cfg(test)]
pub(super) const GAP_BUDGET: Duration = Duration::from_secs(10);
/// After a failed lookup, maintenance skips the gap this long instead of holding every
/// caller for a full `GAP_BUDGET` while the Host stays unreachable.
#[cfg(not(test))]
const GAP_RETRY: Duration = Duration::from_secs(30);
#[cfg(test)]
const GAP_RETRY: Duration = Duration::ZERO;

struct GapBackoff(Mutex<Option<Instant>>);

impl GapBackoff {
    const fn new() -> Self {
        Self(Mutex::new(None))
    }
    fn allowed(&self, now: Instant) -> bool {
        self.0
            .lock()
            .map_or(true, |next| next.map_or(true, |next| now >= next))
    }
    fn settle(&self, now: Instant, failed: bool, retry: Duration) {
        if let Ok(mut next) = self.0.lock() {
            *next = failed.then(|| now + retry);
        }
    }
}

static GAP_BACKOFF: GapBackoff = GapBackoff::new();

/// Separately negotiated; a Host without it keeps gaps held (never guessed).
pub(super) fn supports_gaps(descriptor: &Value) -> bool {
    supports(descriptor)
        && descriptor["capabilities"]
            .as_array()
            .is_some_and(|caps| caps.iter().any(|cap| cap.as_str() == Some(GAP_CAPABILITY)))
        && descriptor["methods"]
            .as_array()
            .is_some_and(|methods| methods.iter().any(|m| m.as_str() == Some(GAP_RESOLVE)))
}

fn gap_kind(method: &str) -> Result<&'static str, String> {
    match method {
        "native.buffers.update" => Ok("buffer"),
        "native.services.conversation.desktop.finish" => {
            Ok("native.services.conversation.desktop.finish")
        }
        "native.services.workspace.format" => Ok("native.services.workspace.format"),
        _ => Err("NATIVE_DELIVERY_METHOD: unsupported original request method".into()),
    }
}

/// Exact allocated identity of one missing v2 original. Never sent for an
/// original that may still be in flight on this connection.
pub(super) fn gap_params(original: &journal::Original) -> Result<Value, String> {
    let id = journal::epochs::parse_original_id(original.id()).ok_or_else(|| {
        "NATIVE_DELIVERY_EPOCH_INVALID: original is not an epoch original".to_string()
    })?;
    Ok(json!({"ownerId":id.0,"generation":id.1,"sequence":id.2,
        "kind":gap_kind(original.method())?,"sha256":original.payload_sha256(),
        "byteLength":original.payload_bytes()}))
}

/// Host's answer for that exact identity. `true`: durable no-effect fence
/// (never admitted, never admittable; not success). `false`: Host holds a
/// receipt; resolve through ordinary delivery. Any mismatch is an error.
pub(super) fn gap_outcome(params: &Value, response: &Value) -> Result<bool, String> {
    let invalid = || "NATIVE_DELIVERY_EPOCH_INVALID: Host gap resolution is invalid".to_string();
    let fields = response.as_object().ok_or_else(invalid)?;
    if fields.len() != 7 {
        return Err(invalid());
    }
    for key in [
        "ownerId",
        "generation",
        "sequence",
        "kind",
        "sha256",
        "byteLength",
    ] {
        if response[key] != params[key] {
            return Err(invalid());
        }
    }
    match response["outcome"].as_str() {
        Some("not_admitted") => Ok(true),
        Some("admitted") => Ok(false),
        _ => Err(invalid()),
    }
}

pub(super) fn supports(descriptor: &Value) -> bool {
    descriptor["capabilities"].as_array().is_some_and(|caps| {
        caps.iter()
            .any(|cap| cap.as_str() == Some("native.delivery.epochs.v2"))
    }) && descriptor["methods"].as_array().is_some_and(|methods| {
        [OPEN, STATUS, COMPACT, CLOSE].iter().all(|required| {
            methods
                .iter()
                .any(|method| method.as_str() == Some(*required))
        })
    })
}

pub(super) fn required(original: &journal::Original) -> bool {
    original.id().starts_with("nd2:")
}

pub(super) fn open_params(store: &SessionStore, route: &str) -> Result<Value, String> {
    Ok(json!({"openId": journal::epochs::open_id(store, route)?}))
}

pub(super) fn reference(epoch: &journal::epochs::EpochHandle) -> Value {
    json!({"ownerId":epoch.owner_id(),"generation":epoch.generation()})
}

pub(super) fn description(value: &Value) -> Result<journal::epochs::EpochDescription, String> {
    serde_json::from_value(value.clone())
        .map_err(|_| "NATIVE_DELIVERY_EPOCH_INVALID: Host epoch metadata is invalid".into())
}

pub(super) fn compact_params(
    store: &SessionStore,
    epoch: &journal::epochs::EpochHandle,
) -> Result<Option<Value>, String> {
    let plan = journal::epochs::maintenance_plan(store, epoch, false)?;
    Ok(compact_request(epoch, &plan))
}

fn compact_request(
    epoch: &journal::epochs::EpochHandle,
    plan: &journal::epochs::MaintenancePlan,
) -> Option<Value> {
    (plan.eligible_through > plan.expected_through).then(|| {
        let target = plan
            .eligible_through
            .min(plan.expected_through.saturating_add(32));
        json!({"ownerId":epoch.owner_id(),"generation":epoch.generation(),
            "expectedThrough":plan.expected_through,"through":target})
    })
}

/// Give the existing retired prefix priority. Try one abandoned gap when the
/// prefix stalls and only compact across it after its local proof is durable.
pub(super) fn maintenance_params(
    store: &SessionStore,
    epoch: &journal::epochs::EpochHandle,
    gap_supported: bool,
    recover: impl FnOnce(&journal::Original) -> Result<bool, String>,
) -> Result<Option<Value>, String> {
    let plan = journal::epochs::maintenance_plan(store, epoch, gap_supported)?;
    if let Some(original) = plan
        .gap
        .as_ref()
        .filter(|_| GAP_BACKOFF.allowed(Instant::now()))
    {
        // Log only the sequence and a bounded diagnostic, never request or reply data.
        let sequence = plan.eligible_through + 1;
        let outcome = recover(original);
        GAP_BACKOFF.settle(Instant::now(), outcome.is_err(), GAP_RETRY);
        match outcome {
            Ok(true) => {
                log::info!("Native delivery gap {sequence}: Host fence saved");
                return compact_params(store, epoch);
            }
            Ok(false) => log::debug!("Native delivery gap {sequence}: already admitted by Host"),
            Err(error) => log::warn!("Native delivery gap {sequence}: {error}"),
        }
    }
    Ok(compact_request(epoch, &plan))
}

pub(super) fn gap_error(stage: &str, error: &str) -> String {
    let code = error.split([':', ' ']).next().unwrap_or_default();
    if code.starts_with("NATIVE_DELIVERY_")
        && code.len() <= 64
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte == b'_')
    {
        return format!("{stage} ({code})");
    }
    stage.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gap_lookup_waits_out_its_retry_after_a_failure_only() {
        let backoff = GapBackoff::new();
        let now = Instant::now();
        let retry = Duration::from_secs(30);
        assert!(backoff.allowed(now));
        backoff.settle(now, true, retry);
        assert!(!backoff.allowed(now + Duration::from_secs(29)));
        assert!(backoff.allowed(now + retry));
        backoff.settle(now + retry, false, retry);
        assert!(backoff.allowed(now + retry));
    }

    #[test]
    fn epoch_catalog_requires_the_complete_finite_capability() {
        let full = json!({"capabilities":["native.delivery.epochs.v2"],
            "methods":[OPEN,STATUS,COMPACT,CLOSE]});
        assert!(supports(&full));
        let mut missing = full.clone();
        missing["methods"].as_array_mut().unwrap().pop();
        assert!(!supports(&missing));
        assert!(!supports(
            &json!({"capabilities":[],"methods":[OPEN,STATUS,COMPACT,CLOSE]})
        ));
        assert!(!supports(&Value::Null));
    }

    #[test]
    fn gap_resolution_is_separately_negotiated_and_binds_the_exact_identity() {
        let base = json!({"capabilities":["native.delivery.epochs.v2"],
            "methods":[OPEN,STATUS,COMPACT,CLOSE]});
        assert!(!supports_gaps(&base));
        let mut full = base.clone();
        full["capabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!(GAP_CAPABILITY));
        assert!(!supports_gaps(&full), "capability without method");
        full["methods"]
            .as_array_mut()
            .unwrap()
            .push(json!(GAP_RESOLVE));
        assert!(supports_gaps(&full));
        let mut old = full.clone();
        old["methods"].as_array_mut().unwrap().remove(0);
        assert!(!supports_gaps(&old), "requires the base epoch protocol");

        assert_eq!(gap_kind("native.buffers.update").unwrap(), "buffer");
        assert!(gap_kind("native.services.desktop.stop").is_err());
        let params = json!({"ownerId":"11111111-1111-4111-8111-111111111111","generation":2,
            "sequence":7180,"kind":"native.services.workspace.format","sha256":"a".repeat(64),"byteLength":9});
        let mut response = params.clone();
        response["outcome"] = json!("not_admitted");
        assert_eq!(gap_outcome(&params, &response), Ok(true));
        response["outcome"] = json!("admitted");
        assert_eq!(gap_outcome(&params, &response), Ok(false));
        for (key, value) in [
            ("outcome", json!("succeeded")),
            ("sequence", json!(7181)),
            ("kind", json!("buffer")),
            ("sha256", json!("b".repeat(64))),
            ("byteLength", json!(10)),
            ("extra", json!(true)),
        ] {
            let mut changed = response.clone();
            changed[key] = value;
            assert!(gap_outcome(&params, &changed).is_err(), "{key}");
        }
    }

    #[test]
    fn epoch_methods_are_finite_private_producer_scope_operations() {
        use crate::host_ws::{native_profile::NativeProfileBroker, HostWsBroker};
        let reference = json!({"ownerId":"11111111-1111-4111-8111-111111111111","generation":1});
        let mut compact = reference.clone();
        compact["expectedThrough"] = json!(0);
        compact["through"] = json!(1);
        for (method, params) in [
            (
                OPEN,
                json!({"openId":"22222222-2222-4222-8222-222222222222"}),
            ),
            (STATUS, reference),
            (COMPACT, compact.clone()),
            (CLOSE, compact),
            (
                GAP_RESOLVE,
                json!({"ownerId":"11111111-1111-4111-8111-111111111111","generation":1,
                    "sequence":2,"kind":"buffer","sha256":"a".repeat(64),"byteLength":2}),
            ),
        ] {
            assert!(
                NativeProfileBroker::supports_workspace_params(method, &params),
                "{method}"
            );
            assert!(
                NativeProfileBroker::supports_service_params(method, &params),
                "{method}"
            );
            assert!(!HostWsBroker::supports_method(method), "{method}");
            assert!(
                !NativeProfileBroker::supports_params(method, &params),
                "{method}"
            );
            assert!(
                !NativeProfileBroker::supports_gateway_params(method, &params),
                "{method}"
            );
            assert!(
                !NativeProfileBroker::supports_device_params(method, &params),
                "{method}"
            );
            assert!(
                !NativeProfileBroker::supports_peer_service_params(method, &params),
                "{method}"
            );
        }
    }
}
