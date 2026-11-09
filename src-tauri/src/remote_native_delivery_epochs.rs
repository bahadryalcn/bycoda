//! Neutral epoch codecs only. These values never grant a caller, local ACK,
//! producer freshness or permission to replay an original.
use crate::session_store::{native_delivery as journal, SessionStore};
use serde_json::{json, Value};

pub(super) const OPEN: &str = "native.delivery.epochs.open";
pub(super) const STATUS: &str = "native.delivery.epochs.status";
pub(super) const COMPACT: &str = "native.delivery.epochs.compact";
pub(super) const CLOSE: &str = "native.delivery.epochs.close";

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
    let current = journal::epochs::current(store, epoch)?;
    let eligible = journal::epochs::eligible_through(store, &current)?;
    if eligible <= current.through() {
        return Ok(None);
    }
    let target = eligible.min(current.through().saturating_add(32));
    Ok(Some(
        json!({"ownerId":current.owner_id(),"generation":current.generation(),
        "expectedThrough":current.through(),"through":target}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

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
