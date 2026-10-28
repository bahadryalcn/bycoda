use super::*;
use crate::native_authority_peer::NativePeerExpectation;
use crate::native_authority_pipe::{AuthorityPipeListener, PipeCancellation};
use serde_json::json;
use std::future::Future;
use std::sync::mpsc;
use std::task::{Context, Poll, Waker};

fn budget() -> PipeBudget {
    PipeBudget::new(Duration::from_secs(5), PipeCancellation::default()).unwrap()
}

#[test]
fn captured_retained_reads_use_actual_owned_store_and_reject_changed_identity() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let source = store
        .authority_test_retained_snapshot(
            "native-environment",
            "retained",
            "migration.retained",
            "exact 漢🦀 bytes",
        )
        .unwrap();
    let binding = CapturedSourceBinding::capture(store.clone(), "native-environment").unwrap();
    assert!(binding
        .read_retained_snapshot("retained", "missing")
        .unwrap()
        .is_none());
    let read = binding
        .read_retained_snapshot("retained", "migration.retained")
        .unwrap()
        .unwrap();
    assert_eq!(read.snapshot_json, source.snapshot_json);
    assert_eq!(read.fence, source.fence);
    assert_eq!(
        binding
            .read_retained_snapshot("foreign", "migration.retained")
            .err(),
        Some(ChannelError::SourceUnavailable)
    );
    assert_eq!(
        binding
            .read_retained_snapshot("bad scope", "migration.retained")
            .err(),
        Some(ChannelError::InvalidScope)
    );
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE native_authority_identity SET source_profile_id='replaced'",
            [],
        )
        .unwrap();
    assert_eq!(
        binding
            .read_retained_snapshot("retained", "migration.retained")
            .err(),
        Some(ChannelError::SourceChanged)
    );
}

fn pipe_pair() -> (AuthorityPipeConnection, AuthorityPipeConnection) {
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let connector = std::thread::spawn(move || {
        AuthorityPipeConnection::connect(
            &address,
            &NativePeerExpectation::current_process().unwrap(),
            &budget(),
        )
        .unwrap()
    });
    let server = listener
        .accept(
            &NativePeerExpectation::current_process().unwrap(),
            &budget(),
        )
        .unwrap();
    (server, connector.join().unwrap())
}

fn channel_for(store: Arc<SessionStore>) -> (NativeAuthorityChannel, AuthorityPipeConnection) {
    let (server, peer) = pipe_pair();
    let source = CapturedSourceBinding::capture(store, "native-environment").unwrap();
    (NativeAuthorityChannel::open(server, source).unwrap(), peer)
}

fn fixture() -> (
    Arc<SessionStore>,
    NativeAuthorityChannel,
    AuthorityPipeConnection,
) {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let (channel, peer) = channel_for(store.clone());
    (store, channel, peer)
}

fn scope() -> AuthorityScope {
    AuthorityScope::new("native-environment", "session", "migration", 7).unwrap()
}

fn issued(
    channel: &mut NativeAuthorityChannel,
    peer: &mut AuthorityPipeConnection,
    step: AuthorityStep,
) -> ChallengeContext {
    let context = channel
        .issue_challenge(step, &scope(), MAX_CHALLENGE_LIFETIME, &budget())
        .unwrap();
    let received: ChallengeContext =
        serde_json::from_value(peer.read_json(&budget()).unwrap()).unwrap();
    assert_eq!(received, context);
    context
}

fn request(peer: &mut AuthorityPipeConnection, context: &ChallengeContext) {
    peer.send_json(
        &json!({"context":context,"payload":{"retained":"value"}}),
        &budget(),
    )
    .unwrap();
}

fn admitted(
    channel: &mut NativeAuthorityChannel,
    peer: &mut AuthorityPipeConnection,
    step: AuthorityStep,
) -> AcceptedOperation {
    let context = issued(channel, peer, step);
    request(peer, &context);
    let (operation, payload) = channel.admit_next(step, &scope(), &budget()).unwrap();
    assert_eq!(payload, json!({"retained":"value"}));
    operation
}

#[test]
fn real_pipe_context_is_bound_to_captured_store_and_exact_step() {
    let (store, mut channel, mut peer) = fixture();
    let identity = store.authority_identity().unwrap();
    let original_instance = store.native_instance_id();
    assert_eq!(
        managed_store_identity(&store, original_instance).unwrap(),
        identity
    );
    let context = issued(&mut channel, &mut peer, AuthorityStep::ReadSnapshot);
    assert_eq!(context.source_store_id, identity.source_store_id);
    assert_eq!(context.source_profile_id, identity.source_profile_id);
    assert_ne!(context.channel_epoch, context.native_actor_epoch);
    assert!(!channel.observation().unwrap().qualified);
    request(&mut peer, &context);
    let (operation, payload) = channel
        .admit_next(AuthorityStep::ReadSnapshot, &scope(), &budget())
        .unwrap();
    assert_eq!(operation.step, AuthorityStep::ReadSnapshot);
    assert_eq!(operation.scope, scope());
    assert_eq!(channel.observation().unwrap().accepted_operations, 1);
    assert_eq!(
        operation.run_sync(|| Err::<(), _>("original domain failure")),
        Err("original domain failure")
    );
    assert_eq!(channel.observation().unwrap().accepted_operations, 0);
    channel.send_reply(&payload, &budget()).unwrap();
    assert_eq!(peer.read_json(&budget()).unwrap(), payload);
}

#[test]
fn replay_cannot_create_a_second_handle_or_cancel_the_first_owner() {
    let (_, mut channel, mut peer) = fixture();
    let context = issued(&mut channel, &mut peer, AuthorityStep::Prepare);
    request(&mut peer, &context);
    let (first, _) = channel
        .admit_next(AuthorityStep::Prepare, &scope(), &budget())
        .unwrap();
    request(&mut peer, &context);
    assert!(matches!(
        channel.admit_next(AuthorityStep::Prepare, &scope(), &budget()),
        Err(ChannelError::UnknownChallenge)
    ));
    let observation = channel.observation().unwrap();
    assert!(observation.closed);
    assert_eq!(observation.pending_challenges, 0);
    assert_eq!(observation.accepted_operations, 1);
    assert_eq!(first.settle(41), 41);
    assert_eq!(channel.observation().unwrap().accepted_operations, 0);
}

#[test]
fn wrong_expected_step_is_not_admission() {
    let (_, mut channel, mut peer) = fixture();
    let context = issued(&mut channel, &mut peer, AuthorityStep::ReadSnapshot);
    request(&mut peer, &context);
    assert!(matches!(
        channel.admit_next(AuthorityStep::Fence, &scope(), &budget()),
        Err(ChannelError::WrongStep)
    ));
    assert_eq!(channel.observation().unwrap().accepted_operations, 0);
    assert!(channel.observation().unwrap().closed);
}

#[test]
fn forged_source_scope_generation_and_step_fields_never_create_handles() {
    for field in [
        "sourceStoreId",
        "sourceProfileId",
        "environmentId",
        "sessionId",
        "migrationId",
        "generation",
        "step",
    ] {
        let (_, mut channel, mut peer) = fixture();
        let context = issued(&mut channel, &mut peer, AuthorityStep::Stage);
        let mut wire = serde_json::to_value(&context).unwrap();
        wire[field] = match field {
            "generation" => json!(8),
            "step" => json!("activate"),
            _ => json!("another"),
        };
        peer.send_json(&json!({"context":wire,"payload":{}}), &budget())
            .unwrap();
        assert!(
            matches!(
                channel.admit_next(AuthorityStep::Stage, &scope(), &budget()),
                Err(ChannelError::WrongScope | ChannelError::WrongStep)
            ),
            "field {field}"
        );
        assert_eq!(channel.observation().unwrap().accepted_operations, 0);
    }
}

#[test]
fn a_native_expected_scope_or_generation_change_rejects_an_original_context() {
    for expected in [
        AuthorityScope::new("native-environment", "another-session", "migration", 7).unwrap(),
        AuthorityScope::new("native-environment", "session", "another-migration", 7).unwrap(),
        AuthorityScope::new("native-environment", "session", "migration", 8).unwrap(),
        AuthorityScope::new("another-environment", "session", "migration", 7).unwrap(),
    ] {
        let (_, mut channel, mut peer) = fixture();
        let context = issued(&mut channel, &mut peer, AuthorityStep::Abort);
        request(&mut peer, &context);
        assert!(matches!(
            channel.admit_next(AuthorityStep::Abort, &expected, &budget()),
            Err(ChannelError::WrongScope)
        ));
    }
}

#[test]
fn expired_challenge_is_rejected_after_real_monotonic_time_passes() {
    let (_, mut channel, mut peer) = fixture();
    let context = channel
        .issue_challenge(
            AuthorityStep::ReadNativeAck,
            &scope(),
            Duration::from_millis(2),
            &budget(),
        )
        .unwrap();
    peer.read_json(&budget()).unwrap();
    std::thread::sleep(Duration::from_millis(8));
    request(&mut peer, &context);
    assert!(matches!(
        channel.admit_next(AuthorityStep::ReadNativeAck, &scope(), &budget()),
        Err(ChannelError::Expired)
    ));
    assert_eq!(channel.observation().unwrap().pending_challenges, 0);
}

#[test]
fn reconnect_same_process_and_store_never_revives_an_old_epoch_or_actor() {
    let (store, mut old, mut old_peer) = fixture();
    let original = issued(&mut old, &mut old_peer, AuthorityStep::HostAck);
    old.revoke();
    assert_eq!(old.observation().unwrap().pending_challenges, 0);
    let (mut next, mut peer) = channel_for(store);
    let fresh = issued(&mut next, &mut peer, AuthorityStep::HostAck);
    assert_ne!(fresh.channel_epoch, original.channel_epoch);
    assert_ne!(fresh.native_actor_epoch, original.native_actor_epoch);
    assert_ne!(fresh.challenge, original.challenge);
    request(&mut peer, &original);
    assert!(matches!(
        next.admit_next(AuthorityStep::HostAck, &scope(), &budget()),
        Err(ChannelError::WrongEpoch)
    ));
    assert_eq!(next.observation().unwrap().accepted_operations, 0);
}

#[test]
fn pending_challenges_have_a_real_bound_and_overload_revokes_the_channel() {
    let (_, mut channel, mut peer) = fixture();
    for _ in 0..MAX_CHALLENGES {
        issued(&mut channel, &mut peer, AuthorityStep::ReadSnapshot);
    }
    assert_eq!(
        channel.observation().unwrap().pending_challenges,
        MAX_CHALLENGES
    );
    assert!(matches!(
        channel.issue_challenge(
            AuthorityStep::ReadSnapshot,
            &scope(),
            MAX_CHALLENGE_LIFETIME,
            &budget()
        ),
        Err(ChannelError::Capacity)
    ));
    let observation = channel.observation().unwrap();
    assert!(observation.closed);
    assert_eq!(observation.pending_challenges, 0);
}

#[test]
fn accepted_handle_capacity_remains_charged_after_transport_closes() {
    let (_, mut channel, mut peer) = fixture();
    let mut accepted = Vec::new();
    for _ in 0..MAX_ACCEPTED_OPERATIONS {
        accepted.push(admitted(&mut channel, &mut peer, AuthorityStep::Prepare));
    }
    let context = issued(&mut channel, &mut peer, AuthorityStep::Prepare);
    request(&mut peer, &context);
    assert!(matches!(
        channel.admit_next(AuthorityStep::Prepare, &scope(), &budget()),
        Err(ChannelError::Capacity)
    ));
    assert_eq!(
        channel.observation().unwrap().accepted_operations,
        MAX_ACCEPTED_OPERATIONS
    );
    for operation in accepted {
        operation.settle(());
    }
    assert_eq!(channel.observation().unwrap().accepted_operations, 0);
    assert!(channel.observation().unwrap().closed);
}

#[test]
fn actual_accepted_owner_outlives_transport_and_retains_the_captured_store() {
    let (store, mut channel, mut peer) = fixture();
    let weak_store = Arc::downgrade(&store);
    let operation = admitted(&mut channel, &mut peer, AuthorityStep::VerifyDecision);
    let (started, ready) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    let owner = std::thread::spawn(move || {
        operation.run_sync(|| {
            started.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            Err::<(), _>("accepted actual outcome")
        })
    });
    ready.recv_timeout(Duration::from_secs(5)).unwrap();
    channel.revoke();
    assert_eq!(channel.observation().unwrap().accepted_operations, 1);
    drop(channel);
    drop(store);
    assert!(weak_store.upgrade().is_some());
    release.send(()).unwrap();
    assert_eq!(owner.join().unwrap(), Err("accepted actual outcome"));
    assert!(weak_store.upgrade().is_none());
}

#[test]
fn abandoned_native_handle_is_unknown_not_a_false_idle_receipt() {
    let (_, mut channel, mut peer) = fixture();
    let operation = admitted(&mut channel, &mut peer, AuthorityStep::ApplyDecision);
    drop(operation);
    channel.revoke();
    let observation = channel.observation().unwrap();
    assert!(!observation.qualified);
    assert_eq!(observation.accepted_operations, 1);
    assert_eq!(observation.abandoned_operations, 1);
}

#[test]
fn actual_pipe_deadline_revokes_unused_challenges_but_keeps_accepted_work() {
    let (_, mut channel, mut peer) = fixture();
    let operation = admitted(&mut channel, &mut peer, AuthorityStep::Prepare);
    issued(&mut channel, &mut peer, AuthorityStep::Activate);
    let short = PipeBudget::new(Duration::from_millis(20), PipeCancellation::default()).unwrap();
    assert!(matches!(
        channel.admit_next(AuthorityStep::Activate, &scope(), &short),
        Err(ChannelError::Transport(PipeError::Deadline))
    ));
    let observation = channel.observation().unwrap();
    assert!(observation.closed);
    assert_eq!(observation.pending_challenges, 0);
    assert_eq!(observation.accepted_operations, 1);
    assert_eq!(operation.run_sync(|| "completed"), "completed");
}

#[test]
fn actual_async_owner_stays_admitted_through_pending_and_channel_drop_until_await_settles() {
    let (store, mut channel, mut peer) = fixture();
    let weak_store = Arc::downgrade(&store);
    let operation = admitted(&mut channel, &mut peer, AuthorityStep::Stage);
    let (settle, actual_work) = tokio::sync::oneshot::channel::<Result<(), &str>>();
    let mut owner = Box::pin(operation.run_async(async move { actual_work.await.unwrap() }));
    let mut context = Context::from_waker(Waker::noop());
    assert!(owner.as_mut().poll(&mut context).is_pending());
    channel.revoke();
    assert_eq!(channel.observation().unwrap().accepted_operations, 1);
    drop(channel);
    drop(store);
    assert!(weak_store.upgrade().is_some());
    settle.send(Err("actual async outcome")).unwrap();
    assert_eq!(
        owner.as_mut().poll(&mut context),
        Poll::Ready(Err("actual async outcome"))
    );
    drop(owner);
    assert!(weak_store.upgrade().is_none());
}

#[test]
fn cancelling_a_pending_async_owner_leaves_unknown_accounting_not_idle() {
    let (_, mut channel, mut peer) = fixture();
    let operation = admitted(&mut channel, &mut peer, AuthorityStep::Stage);
    let (settle, actual_work) = tokio::sync::oneshot::channel::<()>();
    let mut owner = Box::pin(operation.run_async(actual_work));
    let mut context = Context::from_waker(Waker::noop());
    assert!(owner.as_mut().poll(&mut context).is_pending());
    drop(owner);
    assert!(settle.send(()).is_err());
    channel.revoke();
    let observation = channel.observation().unwrap();
    assert!(!observation.qualified);
    assert!(observation.closed);
    assert_eq!(observation.accepted_operations, 1);
    assert_eq!(observation.abandoned_operations, 1);
}

#[test]
fn dropping_an_unpolled_async_owner_already_retains_unknown_admission() {
    let (_, mut channel, mut peer) = fixture();
    let operation = admitted(&mut channel, &mut peer, AuthorityStep::Stage);
    let owner = operation.run_async(std::future::pending::<()>());
    drop(owner);
    let observation = channel.observation().unwrap();
    assert_eq!(observation.accepted_operations, 1);
    assert_eq!(observation.abandoned_operations, 1);
    assert!(!observation.qualified);
}

#[test]
fn closed_real_pipe_cannot_expose_a_usable_challenge_context() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let source = CapturedSourceBinding::capture(store, "native-environment").unwrap();
    let (mut server, _peer) = pipe_pair();
    server.close();
    let mut channel = NativeAuthorityChannel::open(server, source).unwrap();
    assert!(matches!(
        channel.issue_challenge(
            AuthorityStep::Prepare,
            &scope(),
            MAX_CHALLENGE_LIFETIME,
            &budget()
        ),
        Err(ChannelError::Transport(PipeError::Closed))
    ));
    assert_eq!(channel.observation().unwrap().pending_challenges, 0);
}

#[test]
fn a_closed_request_envelope_rejects_unknown_fields_before_admission() {
    let (_, mut channel, mut peer) = fixture();
    let context = issued(&mut channel, &mut peer, AuthorityStep::CancelQuiesce);
    peer.send_json(
        &json!({"context":context,"payload":{},"qualified":true}),
        &budget(),
    )
    .unwrap();
    assert!(matches!(
        channel.admit_next(AuthorityStep::CancelQuiesce, &scope(), &budget()),
        Err(ChannelError::Malformed)
    ));
    assert_eq!(channel.observation().unwrap().accepted_operations, 0);
}

#[test]
fn changed_native_store_identity_revokes_instead_of_rebinding_a_session() {
    let (store, mut channel, _peer) = fixture();
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE native_authority_identity SET source_store_id='replacement-store' WHERE id=1",
            [],
        )
        .unwrap();
    assert!(matches!(
        channel.issue_challenge(
            AuthorityStep::Prepare,
            &scope(),
            MAX_CHALLENGE_LIFETIME,
            &budget()
        ),
        Err(ChannelError::SourceChanged)
    ));
    assert!(channel.observation().unwrap().closed);
}

#[test]
fn native_scope_and_lifetime_validation_are_finite_and_do_not_select_another_environment() {
    for id in ["", "bad\n", "-prefix", "İ"] {
        assert!(AuthorityScope::new(id, "session", "migration", 0).is_err());
    }
    assert!(AuthorityScope::new("env", "session", "migration", MAX_SAFE_GENERATION + 1).is_err());
    for lifetime in [Duration::ZERO, Duration::from_secs(31)] {
        let (_, mut channel, _peer) = fixture();
        assert!(matches!(
            channel.issue_challenge(AuthorityStep::Fence, &scope(), lifetime, &budget()),
            Err(ChannelError::InvalidLifetime)
        ));
    }
    let (_, mut channel, _peer) = fixture();
    let foreign = AuthorityScope::new("different-environment", "session", "migration", 7).unwrap();
    assert!(matches!(
        channel.issue_challenge(
            AuthorityStep::Fence,
            &foreign,
            MAX_CHALLENGE_LIFETIME,
            &budget()
        ),
        Err(ChannelError::WrongScope)
    ));
}

#[test]
fn source_binding_uses_durable_identity_of_the_actual_registered_database() {
    struct TemporaryStore {
        directory: std::path::PathBuf,
    }
    impl Drop for TemporaryStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
    let directory =
        std::env::temp_dir().join(format!("bycoda-authority-channel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let directory = directory.canonicalize().unwrap();
    let temporary = TemporaryStore { directory };
    let path = temporary.directory.join("native.db");
    let store = Arc::new(SessionStore::open(path.clone()).unwrap());
    let identity = store.authority_identity().unwrap();
    let original_instance = store.native_instance_id();
    let (mut channel, mut peer) = channel_for(store.clone());
    let context = issued(&mut channel, &mut peer, AuthorityStep::ReadSnapshot);
    assert_eq!(context.source_store_id, identity.source_store_id);
    assert_eq!(context.source_profile_id, identity.source_profile_id);
    drop(channel);
    drop(peer);
    drop(store);
    let reopened = SessionStore::open(path).unwrap();
    assert_eq!(reopened.authority_identity().unwrap(), identity);
    assert_ne!(reopened.native_instance_id(), original_instance);
    assert!(matches!(
        managed_store_identity(&reopened, original_instance),
        Err(ChannelError::SourceChanged)
    ));
    drop(reopened);
}
