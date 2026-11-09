//! A native-profile lane that blocked once must reopen after a fresh identity
//! probe; otherwise every later privacy or service call fails until restart.
use super::super::tests::{accept, hello, native_recovery_page, next, result, Server};
use super::*;
use serde_json::json;

#[test]
fn blocked_native_lane_reopens_only_after_retry_for_its_machine() {
    let server = Server::spawn(|listener| async move {
        let mut stale = accept(&listener).await;
        hello(
            &mut stale,
            &["native.buffers.recovery.list"],
            "different.host",
        )
        .await;
        drop(stale);
        let mut socket = accept(&listener).await;
        hello(&mut socket, &["native.buffers.recovery.list"], "host.1").await;
        let request = next(&mut socket).await;
        assert_eq!(request["method"], "native.buffers.recovery.list");
        result(&mut socket, &request, native_recovery_page()).await;
    });
    let profile = NativeProfileBroker::default();
    let caller = profile.capture(server.route()).unwrap();
    let list = || {
        caller
            .begin(
                "native.buffers.recovery.list",
                json!({}),
                RequestOptions::default(),
            )
            .and_then(NativeProfilePending::wait)
    };
    assert_eq!(list().err().unwrap().code, "RPC_WS_BLOCKED");
    let deadline = Instant::now() + Duration::from_secs(3);
    while !profile.machine_blocked("machine.1") {
        assert!(Instant::now() < deadline, "lane never reported blocked");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!profile.machine_blocked("another.machine"));
    profile.retry_blocked_machine("another.machine");
    assert!(profile.machine_blocked("machine.1"));
    profile.retry_blocked_machine("machine.1");
    assert!(!profile.machine_blocked("machine.1"));
    let (value, _guard) = list().unwrap().into_guarded();
    assert_eq!(value, native_recovery_page());
    profile.shutdown();
}
