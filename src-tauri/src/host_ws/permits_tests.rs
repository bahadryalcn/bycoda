use super::*;
use serde_json::json;

fn descriptor(id: &str) -> Value {
    json!({"kind":"bulk","transferId":id,"environmentId":"env.1","totalBytes":32,"chunkBytes":32,
        "sha256":"a".repeat(64),"expiresAt":bulk::millis()+60_000})
}
fn event(logical: &str, stream: &str, data: Value) -> Value {
    json!({"jsonrpc":"2.0","method":"subscription.event","params":{"subscriptionId":logical,
        "streamId":stream,"kind":"snapshot","cursor":{"epoch":"epoch.1","sequence":0},"data":data}})
}
fn permits() -> Arc<Permits> {
    let grants = Arc::new(Permits::new("env.1"));
    grants.phase(7, true);
    for owner in ["window.a", "window.b"] {
        grants
            .begin_open(owner, "logical.1", "open.1", &json!({"kind":"environment"}))
            .unwrap();
        assert!(grants.opened(owner, "logical.1", "open.1", "stream.1"));
    }
    grants
}

#[test]
fn a_renderer_descriptor_cannot_mint_authority_and_all_fields_and_owner_must_match() {
    let contracts = Contracts::get().unwrap();
    let permits = permits();
    let descriptor = descriptor("transfer.1");
    assert!(permits.fetch("window.a", &descriptor).is_err());
    permits
        .stream(
            &contracts,
            "window.a",
            7,
            &event("logical.1", "stream.1", descriptor.clone()),
        )
        .unwrap();
    assert!(permits.fetch("window.b", &descriptor).is_err());
    for (key, value) in [
        ("transferId", json!("another")),
        ("environmentId", json!("env.2")),
        ("totalBytes", json!(31)),
        ("chunkBytes", json!(31)),
        ("sha256", json!("b".repeat(64))),
        ("expiresAt", json!(bulk::millis() + 120_000)),
        ("extra", json!(true)),
    ] {
        let mut changed = descriptor.clone();
        changed[key] = value;
        assert!(permits.fetch("window.a", &changed).is_err(), "{key}");
    }
    let lease = permits.fetch("window.a", &descriptor).unwrap();
    assert!(permits.fetch("window.a", &descriptor).is_err());
    assert_eq!(lease.disclose("verified bytes").unwrap(), "verified bytes");
    drop(lease);
    assert!(permits.fetch("window.a", &descriptor).is_err());
}

#[test]
fn logical_resync_detach_and_generation_retirement_revoke_held_disclosure() {
    let contracts = Contracts::get().unwrap();
    for action in 0..4 {
        let permits = permits();
        let descriptor = descriptor("transfer.1");
        permits
            .stream(
                &contracts,
                "window.a",
                7,
                &event("logical.1", "stream.1", descriptor.clone()),
            )
            .unwrap();
        let lease = permits.fetch("window.a", &descriptor).unwrap();
        match action {
            0 => permits.revoke_member("window.a", "logical.1"),
            1 => permits.revoke_owner("window.a"),
            2 => permits.phase(8, true),
            _ => {
                let mut resync = event("logical.1", "stream.1", Value::Null);
                resync["params"]["kind"] = json!("resync-required");
                permits.stream(&contracts, "window.a", 7, &resync).unwrap();
            }
        }
        assert!(!lease.live());
        assert!(lease.disclose("late secret").is_err());
    }
}

#[test]
fn one_windows_revocation_does_not_remove_another_owned_demand_or_expose_unary_grants() {
    let contracts = Contracts::get().unwrap();
    let permits = permits();
    let descriptor = descriptor("transfer.1");
    for window in ["window.a", "window.b"] {
        permits
            .stream(
                &contracts,
                window,
                7,
                &event("logical.1", "stream.1", descriptor.clone()),
            )
            .unwrap();
    }
    permits.revoke_owner("window.a");
    assert!(permits.fetch("window.a", &descriptor).is_err());
    assert!(permits.fetch("window.b", &descriptor).is_ok());
    let unary = permits
        .unary(
            &contracts,
            "window.a",
            7,
            "request.1",
            &descriptor,
            permits.scope("window.a", "request.1", &json!({})).unwrap(),
        )
        .unwrap();
    assert!(permits.fetch("window.a", &descriptor).is_err());
    permits.revoke_unary("window.a", "request.1");
    assert!(unary.disclose("late unary").is_err());
}

#[test]
fn descriptor_registry_has_bounded_metadata_and_expiring_grants() {
    let contracts = Contracts::get().unwrap();
    let permits = permits();
    for index in 0..MAX_GRANTS {
        permits
            .stream(
                &contracts,
                "window.a",
                7,
                &event(
                    "logical.1",
                    "stream.1",
                    descriptor(&format!("transfer.{index}")),
                ),
            )
            .unwrap();
    }
    assert_eq!(
        permits.stream(
            &contracts,
            "window.a",
            7,
            &event("logical.1", "stream.1", descriptor("overflow"))
        ),
        Err("overload")
    );
    permits.revoke_member("window.a", "logical.1");
    assert!(permits.lock().grants.is_empty());
    permits
        .begin_open(
            "window.a",
            "logical.1",
            "open.2",
            &json!({"kind":"environment"}),
        )
        .unwrap();
    assert!(permits.opened("window.a", "logical.1", "open.2", "stream.1"));
    let mut expired = descriptor("expired");
    expired["expiresAt"] = json!(bulk::millis());
    assert!(permits
        .stream(
            &contracts,
            "window.a",
            7,
            &event("logical.1", "stream.1", expired)
        )
        .is_err());
    let mut oversized = descriptor("oversized");
    oversized["totalBytes"] = json!(32 * 1024 * 1024 + 1);
    assert!(permits
        .stream(
            &contracts,
            "window.a",
            7,
            &event("logical.1", "stream.1", oversized)
        )
        .is_err());
}

#[test]
fn local_close_cannot_be_undone_by_an_older_event_or_open_receipt() {
    let contracts = Contracts::get().unwrap();
    let permits = permits();
    let data = descriptor("old.transfer");
    permits.revoke_member("window.a", "logical.1");
    assert_eq!(
        permits.stream(
            &contracts,
            "window.a",
            7,
            &event("logical.1", "stream.1", data.clone())
        ),
        Err("retired")
    );
    assert!(!permits.opened("window.a", "logical.1", "open.1", "stream.1"));
    permits
        .begin_open(
            "window.a",
            "logical.1",
            "new.open",
            &json!({"kind":"environment"}),
        )
        .unwrap();
    assert!(!permits.opened("window.a", "logical.1", "open.1", "stream.1"));
    assert!(permits.opened("window.a", "logical.1", "new.open", "new.stream"));
    assert!(permits
        .stream(
            &contracts,
            "window.a",
            7,
            &event("logical.1", "new.stream", data.clone())
        )
        .is_ok());
    assert!(permits.fetch("window.a", &data).is_ok());
}

#[test]
fn validated_resource_retirement_fences_cross_window_unary_and_late_descriptor_registration() {
    let contracts = Contracts::get().unwrap();
    for field in ["projectId", "sessionId"] {
        let permits = permits();
        let data = descriptor("resource.transfer");
        let target =
            json!({"kind":if field=="projectId"{"project"}else{"session"},field:"resource.a"});
        for owner in ["window.a", "window.b"] {
            permits
                .begin_open(owner, "logical.1", "open.resource", &target)
                .unwrap();
            assert!(permits.opened(owner, "logical.1", "open.resource", "stream.1"));
            permits
                .stream(
                    &contracts,
                    owner,
                    7,
                    &event("logical.1", "stream.1", data.clone()),
                )
                .unwrap();
        }
        let cross_window_stream = permits.fetch("window.b", &data).unwrap();
        let pending = permits
            .scope("window.b", "pending.request", &json!({field:"resource.a"}))
            .unwrap();
        let independent = permits
            .scope("window.b", "other.request", &json!({field:"resource.b"}))
            .unwrap();
        let held = permits
            .unary(
                &contracts,
                "window.b",
                7,
                "held.request",
                &data,
                pending.clone(),
            )
            .unwrap();
        let other = permits
            .unary(
                &contracts,
                "window.b",
                7,
                "other.request",
                &data,
                independent,
            )
            .unwrap();
        let mut resync = event("logical.1", "stream.1", Value::Null);
        resync["params"]["kind"] = json!("resync-required");
        permits.stream(&contracts, "window.a", 7, &resync).unwrap();
        assert!(held.disclose("already downloaded unary bytes").is_err());
        assert!(cross_window_stream
            .disclose("other windows old stream bytes")
            .is_err());
        assert!(!pending.live());
        assert!(permits
            .unary(&contracts, "window.b", 7, "late.reply", &data, pending)
            .is_err());
        assert_eq!(
            other.disclose("independent resource bytes").unwrap(),
            "independent resource bytes"
        );
    }
}

#[test]
fn an_old_target_tombstone_cannot_revoke_a_new_target_using_the_same_logical_id() {
    let contracts = Contracts::get().unwrap();
    let permits = permits();
    let old = json!({"kind":"project","projectId":"old.project"});
    let new = json!({"kind":"project","projectId":"new.project"});
    permits
        .begin_open("window.a", "logical.1", "old.attempt", &old)
        .unwrap();
    assert!(permits.opened("window.a", "logical.1", "old.attempt", "old.stream"));
    let pending = permits
        .scope("window.a", "new.request", &json!({"target":new}))
        .unwrap();
    permits
        .begin_open("window.a", "logical.1", "new.attempt", &new)
        .unwrap();
    let mut closed = event("logical.1", "old.stream", Value::Null);
    closed["params"]["kind"] = json!("closed");
    permits
        .stream_bound(&contracts, "window.a", 7, &closed, "old.attempt", &old)
        .unwrap();
    permits.revoke_attempt("window.a", "logical.1", "old.attempt");
    assert!(pending.live());
    assert!(permits.opened("window.a", "logical.1", "new.attempt", "new.stream"));
}
