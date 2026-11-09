//! A Host that refuses a request for capacity did not run it: the failure is a
//! retryable overload, not a definitive refusal, so the views keep their last
//! data and retry instead of reporting the request as rejected.
use crate::host_ws::tests::{accept, hello, next, Server};
use crate::host_ws::{HostWsBroker, RequestOptions};
use futures_util::SinkExt;
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;

#[test]
fn host_capacity_refusal_is_a_retryable_overload() {
    let server = Server::spawn(|listener| async move {
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        let read = next(&mut socket).await;
        let refusal = json!({"jsonrpc":"2.0","id":read["id"],"error":{
            "code":-32004,"message":"Host read capacity is busy; retry later.",
            "data":{"category":"overload","retryable":true,"delivery":"not-sent"}}});
        socket
            .send(Message::Text(refusal.to_string().into()))
            .await
            .unwrap();
    });
    let broker = HostWsBroker::default();
    let error = broker
        .request(
            &server.route(),
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(error.code, "RPC_WS_OVERLOAD");
    assert!(!error.uncertain);
    broker.shutdown();
}
