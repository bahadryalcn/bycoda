use super::*;
use serde_json::json;

struct PreparedQueue {
    broker: super::super::HostWsBroker,
    route: super::super::NativeRoute,
    handle: Arc<super::super::Handle>,
    receiver: tokio::sync::mpsc::Receiver<super::super::Request>,
}

impl PreparedQueue {
    fn new() -> Self {
        use super::super::*;
        let broker = HostWsBroker::default();
        let route = NativeRoute::new(
            "fixture",
            "env.1",
            "http://127.0.0.1:9",
            "fixture-token",
            "fixture-principal",
        )
        .unwrap();
        let (tx, receiver) = tokio::sync::mpsc::channel(1);
        let shared = Arc::new(Shared {
            route: route.clone(),
            consumers: Mutex::new(HashMap::new()),
            cancelled: Arc::new(Mutex::new(HashSet::new())),
            ids: Arc::new(Mutex::new(HashMap::new())),
            stop: AtomicBool::new(false),
            pending: Arc::new(AtomicUsize::new(0)),
            bytes: Arc::new(AtomicUsize::new(0)),
            control_pending: Arc::new(AtomicUsize::new(0)),
            control_bytes: Arc::new(AtomicUsize::new(0)),
            next_generation: broker.next_generation.clone(),
            last_state: Mutex::new(None),
            permits: Arc::new(Permits::new("env.1")),
            resume: Mutex::new(HashMap::new()),
            resume_cuts: Mutex::new(HashMap::new()),
            resume_disabled: AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
        });
        let handle = Arc::new(Handle { shared, tx });
        broker
            .connections
            .lock()
            .unwrap()
            .insert(route.key.clone(), handle.clone());
        Self {
            broker,
            route,
            handle,
            receiver,
        }
    }

    fn prepare(&self, id: &str) -> super::super::PreparedRequest {
        self.prepare_until(id, None)
    }

    fn prepare_until(&self, id: &str, deadline: Option<Instant>) -> super::super::PreparedRequest {
        use super::super::*;
        self.broker.prepare_request_scoped(&self.route, "native", "native.services.delivery.ack", json!({
            "originalId":"11111111-1111-4111-8111-111111111111","sha256":"a".repeat(64),"byteLength":2,
            "target":"native.services.conversation.desktop.finish","consumedResult":{"sha256":"b".repeat(64),"byteLength":17}
        }), RequestOptions {request_id:Some(id.into()), absolute_deadline:deadline, ..RequestOptions::default()}, RequestScope::NativeService).unwrap()
    }

    fn guard(&self) -> super::super::ReplyGuard {
        use super::super::*;
        ReplyGuard {
            disclosure: Some(Arc::new(ReplyDisclosure {
                resource: self
                    .handle
                    .shared
                    .permits
                    .scope("native", "original", &json!({}))
                    .unwrap(),
                failure: WsFailure::local("RPC_WS_RESOURCE_RETIRED", "fixture resource retired"),
            })),
            bulk: None,
        }
    }
}

#[test]
fn resume_requires_prior_committed_cursor_unique_owner_and_live_resource() {
    let fixture = PreparedQueue::new();
    let shared = &fixture.handle.shared;
    shared.consumers().insert("a".into(), None);
    shared.consumers().insert("b".into(), None);
    let member = super::super::demand::MemberId::new("a", "logical");
    let other = super::super::demand::MemberId::new("b", "other");
    let shape = json!({"target":{"kind":"session","sessionId":"s"}});
    let cursor = json!({"epoch":"epoch","sequence":1});
    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    let replacement = Arc::new(crate::control::receipts::WindowIssuer::default());
    let scope = shared.permits.scope("a", "open", &shape).unwrap();
    assert!(shared
        .register_resume(&member, shape.clone(), Some(&cursor), 1, Some(&issuer))
        .is_none());
    shared.record_resume(&member, 1, cursor.clone(), scope.clone(), Some(&issuer));
    assert_eq!(
        shared.register_resume(&member, shape.clone(), Some(&cursor), 2, Some(&issuer)),
        Some(cursor.clone())
    );
    shared.record_resume(&member, 2, cursor.clone(), scope.clone(), Some(&issuer));
    assert!(shared
        .register_resume(&member, shape.clone(), Some(&cursor), 3, Some(&replacement))
        .is_none());
    shared.record_resume(
        &member,
        3,
        cursor.clone(),
        scope.clone(),
        Some(&replacement),
    );
    assert!(shared
        .register_resume(&other, shape.clone(), None, 3, Some(&issuer))
        .is_none());
    assert!(shared
        .register_resume(&member, shape.clone(), Some(&cursor), 4, Some(&replacement))
        .is_none());
    shared.remove_resume(&other);
    shared.record_resume(
        &member,
        4,
        cursor.clone(),
        scope.clone(),
        Some(&replacement),
    );
    shared.permits.revoke_owner("a");
    assert!(shared
        .register_resume(&member, shape, Some(&cursor), 5, Some(&replacement))
        .is_none());
}

#[test]
fn retirement_cut_requires_every_exact_live_proof() {
    use super::super::demand::MemberId;
    let fixture = PreparedQueue::new();
    let shared = &fixture.handle.shared;
    shared.consumers().insert("a".into(), None);
    shared.consumers().insert("b".into(), None);
    let a = MemberId::new("a", "a");
    let b = MemberId::new("b", "b");
    let shape = json!({"target":{"kind":"session","sessionId":"s"}});
    let cursor = json!({"epoch":"epoch","sequence":1});
    let issuer = Arc::new(crate::control::receipts::WindowIssuer::default());
    let scope_a = shared.permits.scope("a", "open-a", &shape).unwrap();
    let scope_b = shared.permits.scope("b", "open-b", &shape).unwrap();
    shared.register_resume(&a, shape.clone(), None, 1, Some(&issuer));
    shared.record_resume(&a, 1, cursor.clone(), scope_a, Some(&issuer));
    let cut = vec![(
        shape.clone(),
        vec![(a.clone(), cursor.clone()), (b.clone(), cursor.clone())],
    )];
    shared.capture_resume_cuts(1, cut.clone());
    assert!(shared.take_resume_cut(&shape).unwrap().is_empty());
    shared.register_resume(&b, shape.clone(), None, 1, Some(&issuer));
    shared.record_resume(&b, 1, cursor, scope_b, Some(&issuer));
    shared.capture_resume_cuts(1, cut.clone());
    assert_eq!(shared.take_resume_cut(&shape).unwrap().len(), 2);
    shared.permits.revoke_owner("b");
    shared.capture_resume_cuts(1, cut);
    assert!(shared.take_resume_cut(&shape).unwrap().is_empty());
}

#[test]
fn reconnect_queue_expires_unsent_effect_using_injected_monotonic_time() {
    let fixture = PreparedQueue::new();
    let shared = &fixture.handle.shared;
    shared.consumers().insert("native".into(), None);
    let mut prepared = fixture.prepare("queued-effect");
    let now = Instant::now();
    let mut request = prepared.request.take().unwrap();
    request.admission_deadline = now + Duration::from_secs(5);
    request.deadline = now + Duration::from_secs(8);
    let pending = prepared.pending.take().unwrap();
    let mut queue = std::collections::VecDeque::from([request]);
    super::super::connection::prune_reconnect_queue(
        shared,
        &mut queue,
        7,
        now + Duration::from_secs(4),
    );
    assert_eq!(queue.len(), 1);
    super::super::connection::prune_reconnect_queue(
        shared,
        &mut queue,
        7,
        now + Duration::from_secs(5),
    );
    assert!(queue.is_empty());
    let failure = pending.wait().unwrap_err();
    assert_eq!(failure.code, "RPC_WS_DEADLINE");
    assert!(!failure.uncertain);
    assert_eq!(failure.request_id.as_deref(), Some("queued-effect"));
}

#[test]
fn prepared_ack_enqueue_finishes_while_revoker_holds_permits_state() {
    use super::super::ReplyGuard;
    let mut fixture = PreparedQueue::new();
    let guard = fixture.guard();
    let resource = guard.disclosure.as_ref().unwrap().resource.clone();
    let mut prepared = fixture.prepare("prepared-ack");
    let permits = fixture.handle.shared.permits.clone();
    let (start, started) = std::sync::mpsc::channel();
    let (locked, state_locked) = std::sync::mpsc::channel();
    let (enqueued, enqueue_seen) = std::sync::mpsc::channel();
    let revoker = std::thread::spawn(move || {
        started.recv_timeout(Duration::from_secs(3)).unwrap();
        let state = permits.lock();
        assert!(matches!(
            resource.commit.try_lock(),
            Err(std::sync::TryLockError::WouldBlock)
        ));
        locked.send(()).unwrap();
        // Positive enqueue completion must arrive while real state is held.
        // A bounded receive only releases this fixture if a regression blocks;
        // no elapsed sleep or missing event is accepted as successful proof.
        let observed = enqueue_seen.recv_timeout(Duration::from_secs(3));
        drop(state);
        Permits::revoke_resource(&mut permits.lock(), &json!({"kind":"environment"}));
        assert!(
            observed.is_ok(),
            "enqueue attempted Permits.state under the retained resource gate"
        );
    });
    let pending = ReplyGuard::commit_many(&[&guard], || {
        start.send(()).unwrap();
        state_locked.recv_timeout(Duration::from_secs(3)).unwrap();
        let result = prepared.enqueue();
        enqueued.send(()).unwrap();
        Ok(result)
    })
    .unwrap()
    .unwrap();
    revoker.join().unwrap();
    assert!(!guard.disclosure.as_ref().unwrap().resource.live());
    let request = fixture.receiver.try_recv().unwrap();
    assert_eq!(request.method, "native.services.delivery.ack");
    assert!(!request.resource_scope.live());
    drop(request);
    drop(pending);
    assert!(fixture.handle.shared.ids.lock().unwrap().is_empty());
}

#[test]
fn rejected_prepared_ack_keeps_slot_cleanup_outside_resource_gates() {
    use super::super::ReplyGuard;
    for full_queue in [false, true] {
        let mut fixture = PreparedQueue::new();
        let guard = fixture.guard();
        let _filler = if full_queue {
            Some(fixture.prepare("filler").enqueue().unwrap())
        } else {
            None
        };
        let mut prepared = fixture.prepare("rejected");
        if !full_queue {
            fixture
                .handle
                .shared
                .permits
                .revoke_unary("native", "original");
        }
        let shared = fixture.handle.shared.clone();
        let ids = shared.ids.lock().unwrap();
        let (finished, completion) = std::sync::mpsc::channel();
        let enqueue = std::thread::spawn(move || {
            let mut called = false;
            let result = ReplyGuard::commit_many(&[&guard], || {
                called = true;
                Ok(prepared.enqueue())
            });
            let retained = prepared.request.is_some();
            let rejected = result.is_err() || result.is_ok_and(|nested| nested.is_err());
            // Report positive completion while IDs is still locked. Dropping
            // Request/Slot here would block; cleanup belongs after all gates.
            finished.send((called, retained, rejected)).unwrap();
            drop(prepared);
        });
        let observed = completion.recv_timeout(Duration::from_secs(3));
        assert!(ids.contains_key("rejected"));
        drop(ids);
        enqueue.join().unwrap();
        assert_eq!(observed.unwrap(), (full_queue, true, true));
        assert!(!shared.ids.lock().unwrap().contains_key("rejected"));
        if full_queue {
            drop(fixture.receiver.try_recv().unwrap());
        }
        assert!(shared.ids.lock().unwrap().is_empty());
        assert_eq!(
            shared.pending.load(Ordering::Acquire) + shared.control_pending.load(Ordering::Acquire),
            0
        );
        assert_eq!(
            shared.bytes.load(Ordering::Acquire) + shared.control_bytes.load(Ordering::Acquire),
            0
        );
    }
}

#[test]
fn prepared_admission_never_renews_absolute_wait_but_preserves_default_grace() {
    let mut fixture = PreparedQueue::new();
    let deadline = Instant::now() + Duration::from_secs(1);
    let mut prepared = fixture.prepare_until("absolute", Some(deadline));
    let pending = prepared.enqueue().unwrap();
    // Observe the actual admitted request at a controlled late time, as if
    // retained resource/lifecycle admission consumed its preparation budget.
    // This uses the same budget function as wait(), without sleeps or a fake
    // successful network reply proving a deadline that was already renewed.
    assert_eq!(pending.absolute_deadline, Some(deadline));
    assert_eq!(
        pending.wait_budget_at(deadline - Duration::from_millis(7)),
        Duration::from_millis(7)
    );
    assert_eq!(
        pending.wait_budget_at(deadline + Duration::from_millis(1)),
        Duration::ZERO
    );
    drop(fixture.receiver.try_recv().unwrap());
    drop(pending);
    let mut normal = fixture.prepare("normal-grace");
    let pending = normal.enqueue().unwrap();
    assert!(pending.absolute_deadline.is_none());
    assert_eq!(
        pending.wait_budget_at(deadline + Duration::from_secs(120)),
        pending.wait
    );
    assert!(!pending.wait.is_zero());
    drop(fixture.receiver.try_recv().unwrap());
}

fn service_result_params(original: &str) -> Value {
    json!({"originalId":original,"sha256":"a".repeat(64),"byteLength":123,
        "target":"native.services.workspace.format",
        "resultSource":{"sha256":"b".repeat(64),"byteLength":MAX_SERVICE_RESULT_BYTES},
        "offset":0,"limit":SERVICE_RESULT_CHUNK_BYTES})
}

#[test]
fn full_service_result_retains_each_gate_without_increasing_general_scope_budget() {
    let permits = Permits::new("env.1");
    let ordinary = (0..MAX_GRANTS)
        .map(|index| {
            permits
                .scope(
                    "ordinary",
                    &index.to_string(),
                    &json!({"projectId":"unrelated"}),
                )
                .unwrap()
        })
        .collect::<Vec<_>>();
    assert!(permits.scope("ordinary", "overflow", &json!({})).is_err());
    let mut params = service_result_params("original.1");
    let chunks = (0..MAX_SERVICE_RESULT_SCOPES)
        .map(|index| {
            params["offset"] = json!(index as u64 * SERVICE_RESULT_CHUNK_BYTES);
            permits
                .service_result_scope("service", &format!("chunk.{index}"), &params)
                .unwrap()
        })
        .collect::<Vec<_>>();
    assert!(permits
        .service_result_scope("service", "overflow", &params)
        .is_err());
    assert!(permits
        .scope("service", "general-overflow", &params)
        .is_err());
    assert!(chunks.iter().all(|scope| scope.live()));
    // Every retained chunk remains visible to the original resource revoker.
    Permits::revoke_resource(
        &mut permits.lock(),
        &json!({"kind":"project","projectId":"deleted"}),
    );
    assert!(chunks.iter().all(|scope| !scope.live()));
    assert!(ordinary.iter().all(|scope| scope.live()));
    drop(ordinary);
    assert!(permits.scope("ordinary", "after-drop", &json!({})).is_ok());
}

#[test]
fn service_result_groups_are_bounded_and_keep_individual_owner_and_request_revocation() {
    let permits = Permits::new("env.1");
    let base = service_result_params("original.1");
    let mut identities = vec![base.clone(); MAX_SERVICE_RESULT_GROUPS + 1];
    identities[1]["sha256"] = json!("c".repeat(64));
    identities[2]["resultSource"]["sha256"] = json!("d".repeat(64));
    identities[3]["originalId"] = json!("original.2");
    // The fifth otherwise-identical result belongs to a separate actual caller.
    let mut scopes = identities[..MAX_SERVICE_RESULT_GROUPS]
        .iter()
        .enumerate()
        .map(|(index, params)| {
            permits
                .service_result_scope("owner.a", &index.to_string(), params)
                .unwrap()
        })
        .collect::<Vec<_>>();
    assert!(permits
        .service_result_scope("owner.b", "fifth", &identities[4])
        .is_err());
    permits.revoke_unary("owner.a", "1");
    assert!(!scopes[1].live());
    assert!(scopes[0].live() && scopes[2].live() && scopes[3].live());
    // Revocation does not evict a live holder to make room; dropping it does.
    assert!(permits
        .service_result_scope("owner.b", "fifth", &identities[4])
        .is_err());
    drop(scopes.remove(1));
    let other = permits
        .service_result_scope("owner.b", "fifth", &identities[4])
        .unwrap();
    permits.revoke_owner("owner.a");
    assert!(scopes.iter().all(|scope| !scope.live()));
    assert!(other.live());
    permits.revoke_all();
    assert!(!other.live());
}

#[test]
fn service_result_scope_admission_rejects_unbounded_or_noncanonical_chunking() {
    let permits = Permits::new("env.1");
    let base = service_result_params("original.1");
    for (key, value) in [
        ("offset", json!(1)),
        ("limit", json!(1)),
        ("offset", json!(MAX_SERVICE_RESULT_BYTES)),
    ] {
        let mut params = base.clone();
        params[key] = value;
        assert!(permits
            .service_result_scope("owner", "request", &params)
            .is_err());
    }
    let mut oversized = base;
    oversized["resultSource"]["byteLength"] = json!(MAX_SERVICE_RESULT_BYTES + 1);
    assert!(permits
        .service_result_scope("owner", "request", &oversized)
        .is_err());
    assert!(permits.lock().scopes.is_empty());
}

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
