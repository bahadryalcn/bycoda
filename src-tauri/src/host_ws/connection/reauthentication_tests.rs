use super::reauthentication::{unauthorized_disposition, REAUTHENTICATION_RETRY_ATTEMPTS};
use super::*;
use crate::host_ws::tests::{accept, hello, next, result, Server};
use crate::host_ws::{NativeEvent, NativeRoute, RequestOptions};
use std::sync::{mpsc as std_mpsc, Arc};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn upgrade_401_is_permanent_only_without_an_earlier_success_or_after_the_streak() {
    assert_eq!(
        unauthorized_disposition(false, 1),
        ("authentication", true),
        "a lane that never authenticated keeps the immediate block"
    );
    for streak in 1..=REAUTHENTICATION_RETRY_ATTEMPTS {
        assert_eq!(
            unauthorized_disposition(true, streak),
            ("authentication", false),
            "401 #{streak} after a success is a temporary refusal"
        );
    }
    assert_eq!(
        unauthorized_disposition(true, REAUTHENTICATION_RETRY_ATTEMPTS + 1),
        ("authentication", true),
        "the fourth consecutive 401 blocks the lane"
    );
}

// Answers the next upgrade with a plain HTTP 401, which tungstenite reports
// as an HTTP error rather than a WebSocket handshake.
async fn refuse_upgrade(listener: &tokio::net::TcpListener) {
    let (mut stream, _) = listener.accept().await.unwrap();
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read_u8().await {
            Ok(byte) => head.push(byte),
            Err(_) => break,
        }
    }
    stream
        .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let _ = stream.shutdown().await;
}

fn project_list(id: &str) -> Value {
    json!([{"id":id,"cwd":"/fixture","name":"fixture"}])
}

fn route(server: &Server) -> NativeRoute {
    NativeRoute::new(
        "machine.1",
        "host.1",
        &server.endpoint,
        "secret-native-token",
        "principal.1",
    )
    .unwrap()
}

fn wait_for_phase(events: &std_mpsc::Receiver<NativeEvent>, wanted: &str) {
    loop {
        match events
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
        {
            NativeEvent::State { phase, .. } if phase == wanted => return,
            _ => {}
        }
    }
}

#[test]
fn upgrade_401_after_success_is_retried_and_the_lane_recovers() {
    let server = Server::spawn(|listener| async move {
        let mut first = accept(&listener).await;
        hello(&mut first, &["projects.list"], "host.1").await;
        let request = next(&mut first).await;
        result(&mut first, &request, project_list("before-restart")).await;
        drop(first);
        // A restarting Host refuses three upgrades, then accepts again.
        for _ in 0..3 {
            refuse_upgrade(&listener).await;
        }
        let mut recovered = accept(&listener).await;
        hello(&mut recovered, &["projects.list"], "host.1").await;
        let request = next(&mut recovered).await;
        result(&mut recovered, &request, project_list("after-restart")).await;
    });
    let broker = super::super::HostWsBroker::default();
    let route = route(&server);
    let (events_tx, events) = std_mpsc::channel();
    broker
        .attach(
            &route,
            "window.a",
            Arc::new(move |event| {
                let _ = events_tx.send(event);
            }),
        )
        .unwrap();
    let first = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    assert_eq!(first.result, project_list("before-restart"));
    wait_for_phase(&events, "retry-wait");
    let second = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap();
    assert_eq!(second.result, project_list("after-restart"));
    drop(server);
    broker.shutdown();
}

#[test]
fn a_fourth_consecutive_upgrade_401_after_success_blocks_the_lane() {
    let server = Server::spawn(|listener| async move {
        let mut first = accept(&listener).await;
        hello(&mut first, &["projects.list"], "host.1").await;
        drop(first);
        for _ in 0..4 {
            refuse_upgrade(&listener).await;
        }
    });
    let broker = super::super::HostWsBroker::default();
    let route = route(&server);
    let (events_tx, events) = std_mpsc::channel();
    broker
        .attach(
            &route,
            "window.a",
            Arc::new(move |event| {
                let _ = events_tx.send(event);
            }),
        )
        .unwrap();
    wait_for_phase(&events, "blocked");
    let failure = broker
        .request(
            &route,
            "window.a",
            "projects.list",
            json!({}),
            RequestOptions::default(),
        )
        .unwrap_err();
    assert_eq!(failure.code, "RPC_WS_BLOCKED");
    drop(server);
    broker.shutdown();
}
