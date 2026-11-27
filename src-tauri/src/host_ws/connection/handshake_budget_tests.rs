//! A slow link spends its handshake in round trips. Each phase has its own budget, so
//! an attempt whose phases are each within budget connects even when their sum is
//! longer than one handshake budget.
use super::HandshakePhases;
use crate::host_ws::tests::{accept, hello, Server};
use crate::host_ws::{Contracts, HostWsBroker, NativeEvent};
use std::{
    sync::{mpsc, Arc},
    time::Duration,
};
use tokio::time;

#[test]
fn every_phase_has_at_least_one_handshake_budget() {
    let contracts = Contracts::get().unwrap();
    let base = contracts.duration("handshakeTimeoutMs");
    let phases = HandshakePhases::new(&contracts);
    assert!(phases.transport >= base);
    assert!(phases.hello >= base);
    // The Host spends one budget authenticating the upgrade before it answers.
    assert!(phases.upgrade > base);
    assert!(phases.transport + phases.upgrade + phases.hello > base);
}

#[test]
fn slow_upgrade_and_hello_connect_when_each_phase_is_within_budget() {
    let contracts = Contracts::get().unwrap();
    // Two waits of three fifths of one budget: each phase is within its own budget,
    // their sum is not within a single one.
    let slow = contracts.duration("handshakeTimeoutMs") * 3 / 5;
    assert!(slow * 2 > contracts.duration("handshakeTimeoutMs"));
    let (done_tx, done_rx) = mpsc::sync_channel::<()>(1);
    let server = Server::spawn_with_watchdog(Duration::from_secs(30), move |listener| async move {
        // The connection waits in the listen backlog: TCP is up, the upgrade is not.
        time::sleep(slow).await;
        let mut socket = accept(&listener).await;
        // The hello waits in the socket; the client sees the Host answer late.
        time::sleep(slow).await;
        hello(&mut socket, &["projects.list"], "host.1").await;
        tokio::task::spawn_blocking(move || done_rx.recv().unwrap())
            .await
            .unwrap();
    });
    let broker = HostWsBroker::default();
    let (events_tx, events_rx) = mpsc::channel();
    broker
        .attach(
            &server.route(),
            "window.a",
            Arc::new(move |event| {
                let _ = events_tx.send(event);
            }),
        )
        .unwrap();
    let mut phases = Vec::new();
    while let Ok(event) = events_rx.recv_timeout(Duration::from_secs(20)) {
        if let NativeEvent::State { phase, .. } = event {
            let ready = phase == "ready";
            phases.push(phase);
            if ready {
                break;
            }
        }
    }
    broker.shutdown();
    done_tx.send(()).unwrap();
    assert_eq!(
        phases.last().map(String::as_str),
        Some("ready"),
        "phases: {phases:?}"
    );
    assert!(
        !phases.iter().any(|phase| phase == "retry-wait"),
        "a progressing connection was retried: {phases:?}"
    );
}
