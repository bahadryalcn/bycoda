//! One result that drifts from its contract fails only that request; the lane
//! keeps serving later calls instead of blocking until restart.
use crate::host_ws::tests::{accept, hello, next, result, Server};
use crate::host_ws::{HostWsBroker, RequestOptions};
use serde_json::json;

#[test]
fn result_contract_drift_fails_only_that_request() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        let drifted = next(&mut socket).await;
        result(&mut socket, &drifted, json!({"unexpected": true})).await;
        let healthy = next(&mut socket).await;
        result(
            &mut socket,
            &healthy,
            json!([{"id":"after","cwd":"/fixture","name":"fixture"}]),
        )
        .await;
    });
    let broker = HostWsBroker::default();
    let route = server.route();
    let list = || {
        broker.request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
    };
    let refused = list().unwrap_err();
    assert_eq!(refused.code, "RPC_WS_SCHEMA");
    let reply = list().unwrap();
    assert_eq!(reply.generation, refused.generation.unwrap());
    assert_eq!(reply.result[0]["id"], "after");
    broker.shutdown();
}

/// Room requests carry their thread scope instead of a session; refusing them lost each
/// already-claimed request until the Host's relay deadline.
#[test]
fn desktop_relay_take_accepts_session_and_room_requests() {
    let contracts = crate::host_ws::schema::Contracts::get().unwrap();
    let take = &contracts.methods["native.services.conversation.desktop.take"].result;
    let base = |extra: serde_json::Value| {
        let mut request = json!({"id":"r","action":"privacy.scope.capture","input":{},"environmentId":"host.1","deadline":1});
        request
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        request
    };
    assert!(take.is_valid(&json!([
        base(json!({"cwd":"/p","sessionId":"s"})),
        base(json!({"threadId":"t","projectId":"p","targetProjectCwd":"/p"})),
        base(json!({"threadId":"t"})),
    ])));
    assert!(!take.is_valid(&json!([base(json!({}))])));
    assert!(!take.is_valid(&json!([base(json!({"threadId":"t","unexpected":true}))])));
}
