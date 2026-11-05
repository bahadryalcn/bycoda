use super::*;

fn union() -> DemandUnion {
    DemandUnion::new(64, 64, 512, 32, 2_097_152, 8_388_608)
}
fn params(id: &str, session: &str) -> Value {
    json!({"subscriptionId":id,"target":{"kind":"session","sessionId":session}})
}
fn cursor(sequence: u64) -> Value {
    json!({"epoch":"epoch","sequence":sequence})
}
fn event(operation: &Operation, kind: &str, sequence: u64) -> Value {
    json!({"jsonrpc":"2.0","method":"subscription.event","params":{
        "subscriptionId":operation.params["subscriptionId"],"streamId":"host-stream","cursor":cursor(sequence),"kind":kind,"data":{"revision":sequence}}})
}
fn opened(union: &mut DemandUnion, owner: &str, id: &str, target: &str) -> (MemberId, Operation) {
    let (member, mut effects) = union.open(owner, &params(id, target)).unwrap();
    let operation = effects.operations.remove(0);
    union
        .complete(
            &operation,
            &json!({"subscriptionId":operation.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    (member, operation)
}
fn operation(effects: &Effects, kind: OperationKind) -> Operation {
    effects
        .operations
        .iter()
        .find(|op| op.kind == kind)
        .unwrap()
        .clone()
}

#[test]
fn concurrent_windows_coalesce_one_host_target_and_keep_logical_ids() {
    let mut union = union();
    let (_, first) = union
        .open("window-a", &params("logical-a", "session"))
        .unwrap();
    let (_, second) = union
        .open("window-b", &params("logical-b", "session"))
        .unwrap();
    assert!(second.operations.is_empty());
    let op = operation(&first, OperationKind::Open);
    let result = union
        .complete(
            &op,
            &json!({"subscriptionId":op.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert_eq!(result.notices.len(), 2);
    let events = union.event(&event(&op, "snapshot", 1)).unwrap();
    let ids: BTreeSet<_> = events
        .notices
        .iter()
        .filter_map(|notice| match notice {
            Notice::Event { event, .. } => {
                Some(event["params"]["subscriptionId"].as_str().unwrap())
            }
            _ => None,
        })
        .collect();
    assert_eq!(ids, BTreeSet::from(["logical-a", "logical-b"]));
    assert!(events.operations.is_empty()); // Receipt of a snapshot is never an application ACK.
}

#[test]
fn whole_projection_shape_is_in_the_union_key_but_cursors_are_per_consumer() {
    let mut union = union();
    let mut a = params("a", "session");
    a["projection"] = "full".into();
    a["cursor"] = cursor(10);
    let (_, initial) = union.open("a", &a).unwrap();
    let mut b = a.clone();
    b["subscriptionId"] = "b".into();
    b["cursor"] = cursor(20);
    assert!(union.open("b", &b).unwrap().1.operations.is_empty());
    b["subscriptionId"] = "c".into();
    b["projection"] = "preview".into();
    assert_eq!(union.open("c", &b).unwrap().1.operations.len(), 1);
    assert_eq!(initial.operations.len(), 1);
}

#[test]
fn verified_resume_accepts_delta_without_fabricating_a_new_application_ack() {
    let mut union = union();
    let (member, effects) = union
        .open_resumable("a", &params("a", "s"), Some(&cursor(10)))
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    assert_eq!(open.params["cursor"], cursor(10));
    union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    let delta = union.event(&event(&open, "delta", 11)).unwrap();
    assert_eq!(delta.notices.len(), 1);
    assert!(delta.operations.is_empty());
    let ack = union.acknowledge(&member, &cursor(11)).unwrap();
    assert_eq!(
        operation(&ack, OperationKind::Ack).params["cursor"],
        cursor(11)
    );
}

#[test]
fn verified_resume_with_no_replay_events_does_not_emit_a_fabricated_ack() {
    let mut union = union();
    let (member, effects) = union
        .open_resumable("a", &params("a", "s"), Some(&cursor(10)))
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    let opened = union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert!(opened.operations.is_empty());
    assert!(union
        .acknowledge(&member, &cursor(10))
        .unwrap()
        .operations
        .is_empty());
}

#[test]
fn resumed_delta_gap_or_changed_epoch_requires_fresh_snapshot() {
    for (epoch, sequence) in [("epoch", 12), ("other-epoch", 11)] {
        let mut union = union();
        let (_, effects) = union
            .open_resumable("a", &params("a", "s"), Some(&cursor(10)))
            .unwrap();
        let open = operation(&effects, OperationKind::Open);
        union
            .complete(
                &open,
                &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
            )
            .unwrap();
        let mut update = event(&open, "delta", sequence);
        update["params"]["cursor"]["epoch"] = epoch.into();
        let resync = union.event(&update).unwrap();
        assert_eq!(
            operation(&resync, OperationKind::Close).kind,
            OperationKind::Close
        );
        assert!(resync.notices.iter().any(|notice| matches!(notice, Notice::Event { event, .. } if event["params"]["kind"] == "resync-required")));
    }
}

#[test]
fn a_new_member_during_resume_forces_fresh_snapshot() {
    let mut union = union();
    let (_, effects) = union
        .open_resumable("a", &params("a", "s"), Some(&cursor(10)))
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    union.sent(&open);
    let (_, joined) = union.open("b", &params("b", "s")).unwrap();
    let close = operation(&joined, OperationKind::Close);
    let reopen = union.complete(&close, &json!({"accepted":true})).unwrap();
    assert!(operation(&reopen, OperationKind::Open)
        .params
        .get("cursor")
        .is_none());
}

#[test]
fn cohort_resumes_at_slowest_cursor_and_suppresses_faster_duplicates() {
    let mut union = union();
    let a = MemberId::new("a", "a");
    let b = MemberId::new("b", "b");
    let members = vec![(a.clone(), cursor(10)), (b.clone(), cursor(12))];
    let (_, effects) = union
        .open_cohort(
            "b",
            &params("b", "s"),
            &members,
            Instant::now() + std::time::Duration::from_secs(10),
        )
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    assert_eq!(open.params["cursor"], cursor(10));
    let opened = union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert_eq!(opened.notices.len(), 1);
    assert!(union
        .event(&event(&open, "delta", 11))
        .unwrap()
        .notices
        .is_empty());
    assert!(union
        .event(&event(&open, "delta", 12))
        .unwrap()
        .notices
        .is_empty());
    assert_eq!(
        union
            .event(&event(&open, "delta", 13))
            .unwrap()
            .notices
            .len(),
        1
    );
    let joined = union
        .rejoin_cohort(&a, &params("a", "s"), &cursor(10))
        .unwrap();
    assert_eq!(joined.notices.len(), 4); // registration and three retained deltas
    assert!(joined.operations.is_empty());
}

#[test]
fn missing_cohort_member_expires_to_fresh_snapshot() {
    let mut union = union();
    let now = Instant::now();
    let members = vec![
        (MemberId::new("a", "a"), cursor(10)),
        (MemberId::new("b", "b"), cursor(10)),
    ];
    let (_, effects) = union
        .open_cohort("a", &params("a", "s"), &members, now)
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    let expired = union.expire_cohorts(now, |_| true);
    assert_eq!(
        operation(&expired, OperationKind::Close).kind,
        OperationKind::Close
    );
}

#[test]
fn equal_cursor_cohort_rejoins_without_fabricated_events_or_ack() {
    let mut union = union();
    let a = MemberId::new("a", "a");
    let b = MemberId::new("b", "b");
    let members = vec![(a.clone(), cursor(7)), (b.clone(), cursor(7))];
    let (_, effects) = union
        .open_cohort(
            "a",
            &params("a", "s"),
            &members,
            Instant::now() + std::time::Duration::from_secs(10),
        )
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    let joined = union
        .rejoin_cohort(&b, &params("b", "s"), &cursor(7))
        .unwrap();
    assert_eq!(joined.notices.len(), 1);
    assert!(joined.operations.is_empty());
    assert!(union
        .acknowledge(&a, &cursor(7))
        .unwrap()
        .operations
        .is_empty());
    assert!(union
        .acknowledge(&b, &cursor(7))
        .unwrap()
        .operations
        .is_empty());
    assert!(union.next_cohort_deadline().is_none());
    // Host may reject replay even after everyone rejoined. Start a new
    // baseline so no delta can outrun application of that snapshot.
    let fallback = union.event(&event(&open, "snapshot", 8)).unwrap();
    assert_eq!(
        operation(&fallback, OperationKind::Close).kind,
        OperationKind::Close
    );
}

#[test]
fn retirement_cut_marks_uncommitted_and_awaiting_members_incomplete() {
    let mut first_union = union();
    let (_, open) = opened(&mut first_union, "a", "a", "s");
    first_union.event(&event(&open, "snapshot", 1)).unwrap();
    assert!(first_union.retirement_cut()[0].1.is_empty());
    let mut resumed = union();
    let members = vec![
        (MemberId::new("a", "a"), cursor(1)),
        (MemberId::new("b", "b"), cursor(1)),
    ];
    let (_, effects) = resumed
        .open_cohort(
            "a",
            &params("a", "s"),
            &members,
            Instant::now() + std::time::Duration::from_secs(10),
        )
        .unwrap();
    let operation = operation(&effects, OperationKind::Open);
    resumed
        .complete(
            &operation,
            &json!({"subscriptionId":operation.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert!(resumed.retirement_cut()[0].1.is_empty());
}

#[test]
fn revoked_cohort_member_and_host_snapshot_force_fresh_baseline() {
    for host_snapshot in [false, true] {
        let mut union = union();
        let members = vec![
            (MemberId::new("a", "a"), cursor(1)),
            (MemberId::new("b", "b"), cursor(1)),
        ];
        let (_, effects) = union
            .open_cohort(
                "a",
                &params("a", "s"),
                &members,
                Instant::now() + std::time::Duration::from_secs(10),
            )
            .unwrap();
        let open = operation(&effects, OperationKind::Open);
        union
            .complete(
                &open,
                &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
            )
            .unwrap();
        let effects = if host_snapshot {
            union.event(&event(&open, "snapshot", 2)).unwrap()
        } else {
            union.expire_cohorts(Instant::now(), |_| false)
        };
        assert!(effects.notices.iter().all(|notice| match notice {
            Notice::Opened { member, .. }
            | Notice::Event { member, .. }
            | Notice::Rejected { member } => member != &members[1].0,
        }));
        assert_eq!(
            operation(&effects, OperationKind::Close).kind,
            OperationKind::Close
        );
        union.prune_missing();
        assert!(!union.is_ghost(&members[1].0));
    }
}

#[test]
fn closed_cohort_does_not_notify_absent_member() {
    let mut union = union();
    let members = vec![
        (MemberId::new("a", "a"), cursor(1)),
        (MemberId::new("b", "b"), cursor(1)),
    ];
    let (_, effects) = union
        .open_cohort(
            "a",
            &params("a", "s"),
            &members,
            Instant::now() + std::time::Duration::from_secs(10),
        )
        .unwrap();
    let open = operation(&effects, OperationKind::Open);
    union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    let closed = union.event(&event(&open, "closed", 1)).unwrap();
    assert!(closed.notices.iter().all(|notice| match notice {
        Notice::Opened { member, .. }
        | Notice::Event { member, .. }
        | Notice::Rejected { member } => member != &members[1].0,
    }));
}

#[test]
fn host_ack_never_outruns_the_slowest_real_applied_window_cursor() {
    let mut union = union();
    let (a, first) = union.open("a", &params("logical-a", "s")).unwrap();
    let (b, _) = union.open("b", &params("logical-b", "s")).unwrap();
    let op = operation(&first, OperationKind::Open);
    union
        .complete(
            &op,
            &json!({"subscriptionId":op.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    union.event(&event(&op, "snapshot", 1)).unwrap();
    assert!(union
        .acknowledge(&a, &cursor(1))
        .unwrap()
        .operations
        .is_empty());
    // B cannot receive a delta until its fresh baseline was actually applied.
    let delta = union.event(&event(&op, "delta", 2)).unwrap();
    assert_eq!(delta.notices.len(), 1);
    assert!(union
        .acknowledge(&a, &cursor(2))
        .unwrap()
        .operations
        .is_empty());
    let ack_one = union.acknowledge(&b, &cursor(1)).unwrap();
    assert_eq!(ack_one.notices.len(), 1); // B's queued delta is released in order.
    let ack = operation(&ack_one, OperationKind::Ack);
    assert_eq!(ack.params["cursor"], cursor(1));
    assert!(union
        .complete(&ack, &json!({"accepted":true}))
        .unwrap()
        .operations
        .is_empty());
    let ack_two = union.acknowledge(&b, &cursor(2)).unwrap();
    assert_eq!(
        operation(&ack_two, OperationKind::Ack).params["cursor"],
        cursor(2)
    );
}

#[test]
fn a_late_window_gets_its_own_snapshot_without_restarting_the_running_registration() {
    let mut union = union();
    let (a, initial) = opened(&mut union, "a", "logical-a", "s");
    union.event(&event(&initial, "snapshot", 1)).unwrap();
    let ack = operation(
        &union.acknowledge(&a, &cursor(1)).unwrap(),
        OperationKind::Ack,
    );
    union.complete(&ack, &json!({"accepted":true})).unwrap();
    let (b, join) = union.open("b", &params("logical-b", "s")).unwrap();
    // The running registration is neither closed nor reopened for A.
    assert!(!join
        .operations
        .iter()
        .any(|op| op.kind == OperationKind::Close));
    let fresh = operation(&join, OperationKind::Open);
    assert_ne!(
        fresh.params["subscriptionId"],
        initial.params["subscriptionId"]
    );
    assert!(fresh.params.get("cursor").is_none());
    let delta = union.event(&event(&initial, "delta", 2)).unwrap();
    assert_eq!(delta.notices.len(), 1); // A keeps receiving on its own wire.
    let ready = union
        .complete(
            &fresh,
            &json!({"subscriptionId":fresh.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert_eq!(ready.notices.len(), 1); // B opens on the same Host stream.
                                        // B's own snapshot is the only thing it is sent for the join.
    let baseline = union.event(&event(&fresh, "snapshot", 2)).unwrap();
    assert_eq!(baseline.notices.len(), 1);
    assert!(matches!(&baseline.notices[0], Notice::Event { member, .. } if *member == b));
    let ack_b = operation(
        &union.acknowledge(&b, &cursor(2)).unwrap(),
        OperationKind::Ack,
    );
    assert_eq!(
        ack_b.params["subscriptionId"],
        fresh.params["subscriptionId"]
    );
    assert!(union.acknowledge(&a, &cursor(2)).is_ok());
}

#[test]
fn a_sidecar_registration_closes_alone_without_disturbing_the_primary() {
    let mut union = union();
    let (a, initial) = opened(&mut union, "a", "a", "s");
    union.event(&event(&initial, "snapshot", 1)).unwrap();
    union.acknowledge(&a, &cursor(1)).unwrap();
    let (b, join) = union.open("b", &params("b", "s")).unwrap();
    let fresh = operation(&join, OperationKind::Open);
    union
        .complete(
            &fresh,
            &json!({"subscriptionId":fresh.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    let leave = union.close(&b).unwrap();
    let close = operation(&leave, OperationKind::Close);
    assert_eq!(
        close.params["subscriptionId"],
        fresh.params["subscriptionId"]
    );
    let done = union.complete(&close, &json!({"accepted":true})).unwrap();
    assert!(done.operations.is_empty());
    // The primary registration keeps its wire and its member.
    assert_eq!(
        union
            .event(&event(&initial, "delta", 2))
            .unwrap()
            .notices
            .len(),
        1
    );
}

#[test]
fn joining_before_the_first_baseline_does_not_reopen_the_host() {
    let mut union = union();
    let (_, op) = opened(&mut union, "a", "a", "s");
    let (_, effects) = union.open("b", &params("b", "s")).unwrap();
    assert!(effects.operations.is_empty());
    assert_eq!(effects.notices.len(), 1);
    assert_eq!(
        union
            .event(&event(&op, "snapshot", 1))
            .unwrap()
            .notices
            .len(),
        2
    );
}

#[test]
fn only_the_last_window_release_closes_host_demand_and_detach_keeps_other_consumers() {
    let mut union = union();
    let (_, first) = union.open("a", &params("a", "s")).unwrap();
    let (b, _) = union.open("b", &params("b", "s")).unwrap();
    let op = operation(&first, OperationKind::Open);
    union
        .complete(
            &op,
            &json!({"subscriptionId":op.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert!(union.detach(|owner| owner == "b").operations.is_empty());
    let delivery = union.event(&event(&op, "snapshot", 1)).unwrap();
    assert!(matches!(&delivery.notices[..], [Notice::Event { member, .. }] if member.owner == "b"));
    let close = union.close(&b).unwrap();
    assert_eq!(close.operations.len(), 1);
    assert_eq!(close.operations[0].kind, OperationKind::Close);
}

#[test]
fn window_identity_and_real_delivered_cursor_are_required_for_acknowledgement() {
    let mut union = union();
    let (a, op) = opened(&mut union, "a", "same-id", "s");
    union.event(&event(&op, "snapshot", 5)).unwrap();
    assert_eq!(
        union
            .acknowledge(&MemberId::new("b", "same-id"), &cursor(5))
            .unwrap_err(),
        "owner"
    );
    assert_eq!(union.acknowledge(&a, &cursor(4)).unwrap_err(), "cursor");
    assert_eq!(union.acknowledge(&a, &cursor(6)).unwrap_err(), "cursor");
    let effects = union.acknowledge(&a, &cursor(5)).unwrap();
    assert_eq!(effects.operations.len(), 1);
}

#[test]
fn tombstones_fence_the_primary_window_and_leave_a_joined_sidecar_isolated() {
    let mut union = union();
    let (_, initial) = opened(&mut union, "a", "a", "s");
    union.event(&event(&initial, "snapshot", 1)).unwrap();
    let (b, join) = union.open("b", &params("b", "s")).unwrap();
    let fresh = operation(&join, OperationKind::Open);
    union
        .complete(
            &fresh,
            &json!({"subscriptionId":fresh.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    let closed = union.event(&event(&initial, "closed", 2)).unwrap();
    assert_eq!(closed.notices.len(), 1);
    assert!(matches!(&closed.notices[0], Notice::Event { member, .. } if member.logical_id == "a"));
    assert!(union
        .event(&event(&initial, "delta", 3))
        .unwrap()
        .notices
        .is_empty());
    // The sidecar is a separate Host registration: its own events still reach B.
    let sidecar = union.event(&event(&fresh, "snapshot", 2)).unwrap();
    assert!(matches!(&sidecar.notices[0], Notice::Event { member, .. } if *member == b));
}

#[test]
fn first_open_tombstone_retires_registration_and_never_discloses_early_data() {
    let mut union = union();
    let (_, first) = union.open("a", &params("a", "s")).unwrap();
    let op = operation(&first, OperationKind::Open);
    let effects = union.event(&event(&op, "closed", 1)).unwrap();
    assert_eq!(effects.retired, vec![op.id.clone()]);
    assert!(matches!(&effects.notices[..], [Notice::Rejected { .. }]));
    assert!(union
        .complete(
            &op,
            &json!({"subscriptionId":op.params["subscriptionId"],"streamId":"host-stream"})
        )
        .unwrap()
        .notices
        .is_empty());
}

#[test]
fn early_events_wait_for_verified_host_stream_registration() {
    let mut union = union();
    let (_, first) = union.open("a", &params("a", "s")).unwrap();
    let op = operation(&first, OperationKind::Open);
    assert!(union
        .event(&event(&op, "snapshot", 1))
        .unwrap()
        .notices
        .is_empty());
    let effects = union
        .complete(
            &op,
            &json!({"subscriptionId":op.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    assert!(matches!(
        &effects.notices[..],
        [Notice::Opened { .. }, Notice::Event { .. }]
    ));
}

#[test]
fn stream_window_and_per_window_member_budgets_are_finite() {
    let mut union = DemandUnion::new(1, 1, 2, 2, 65536, 65536);
    let (_, first) = union.open("a", &params("a", "s")).unwrap();
    assert_eq!(union.open("a", &params("other", "s")).unwrap_err(), "limit");
    union.open("b", &params("b", "s")).unwrap();
    assert_eq!(union.open("c", &params("c", "s")).unwrap_err(), "limit");
    let op = operation(&first, OperationKind::Open);
    union
        .complete(
            &op,
            &json!({"subscriptionId":op.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    union.event(&event(&op, "snapshot", 1)).unwrap();
    union.event(&event(&op, "delta", 2)).unwrap();
    let overflow = union.event(&event(&op, "delta", 3)).unwrap();
    assert_eq!(
        operation(&overflow, OperationKind::Close).kind,
        OperationKind::Close
    );
    assert_eq!(overflow.notices.len(), 2);
}

#[test]
fn close_or_ack_failure_never_marks_an_upstream_cursor_as_applied() {
    let mut union = union();
    let (a, op) = opened(&mut union, "a", "a", "s");
    union.event(&event(&op, "snapshot", 1)).unwrap();
    let ack = operation(
        &union.acknowledge(&a, &cursor(1)).unwrap(),
        OperationKind::Ack,
    );
    assert!(union.demands[&ack.key].last_ack.is_none());
    let failed = union.failed(&ack);
    assert!(union.demands[&ack.key].last_ack.is_none());
    assert_eq!(
        operation(&failed, OperationKind::Close).kind,
        OperationKind::Close
    );
}

#[test]
fn resnapshot_of_an_already_committed_cursor_still_acknowledges_the_new_host_registration() {
    let mut union = union();
    let (a, initial) = opened(&mut union, "a", "a", "s");
    union.event(&event(&initial, "snapshot", 1)).unwrap();
    let ack = operation(
        &union.acknowledge(&a, &cursor(1)).unwrap(),
        OperationKind::Ack,
    );
    union.complete(&ack, &json!({"accepted":true})).unwrap();
    let close = operation(
        &union.event(&event(&initial, "resync-required", 1)).unwrap(),
        OperationKind::Close,
    );
    let fresh = operation(
        &union.complete(&close, &json!({"accepted":true})).unwrap(),
        OperationKind::Open,
    );
    union
        .complete(
            &fresh,
            &json!({"subscriptionId":fresh.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    union.event(&event(&fresh, "snapshot", 1)).unwrap();
    let acknowledgement = operation(
        &union.acknowledge(&a, &cursor(1)).unwrap(),
        OperationKind::Ack,
    );
    assert_eq!(
        acknowledgement.params["subscriptionId"],
        fresh.params["subscriptionId"]
    );
    assert_eq!(acknowledgement.params["cursor"], cursor(1));
}

#[test]
fn lagging_member_is_resynced_without_fabricating_its_ack() {
    let mut union = DemandUnion::new(64, 64, 512, 8, 2_097_152, 8_388_608);
    let (fast, opened_effects) = union.open("fast", &params("a", "session")).unwrap();
    let (slow, _) = union.open("slow", &params("b", "session")).unwrap();
    let open = operation(&opened_effects, OperationKind::Open);
    union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    union.event(&event(&open, "snapshot", 1)).unwrap();
    union.acknowledge(&fast, &cursor(1)).unwrap();
    let first_ack = operation(
        &union.acknowledge(&slow, &cursor(1)).unwrap(),
        OperationKind::Ack,
    );
    union
        .complete(&first_ack, &json!({"accepted":true}))
        .unwrap();
    for sequence in 2..=5 {
        union.event(&event(&open, "delta", sequence)).unwrap();
        union.acknowledge(&fast, &cursor(sequence)).unwrap();
    }
    let isolated = union.event(&event(&open, "delta", 6)).unwrap();
    assert!(isolated.notices.iter().any(|notice| matches!(notice, Notice::Event { member, event } if member == &slow && event["params"]["kind"] == "resync-required")));
    let ack = operation(&isolated, OperationKind::Ack);
    assert_eq!(ack.params["cursor"], cursor(5));
    assert!(union.acknowledge(&slow, &cursor(6)).is_err());
    assert!(union.acknowledge(&fast, &cursor(6)).is_ok());
    // A rejoining member gets a sidecar registration; the running one is not restarted.
    let (_, reopening) = union.open("slow", &params("b", "session")).unwrap();
    assert!(!reopening
        .operations
        .iter()
        .any(|op| op.kind == OperationKind::Close));
    assert!(reopening
        .operations
        .iter()
        .any(|op| op.kind == OperationKind::Open));
}

#[test]
fn member_still_awaiting_its_first_snapshot_is_not_evicted_for_lagging() {
    let mut union = DemandUnion::new(64, 64, 512, 8, 2_097_152, 8_388_608);
    let (fast, opened_effects) = union.open("fast", &params("a", "session")).unwrap();
    let (pending, _) = union.open("pending", &params("b", "session")).unwrap();
    let open = operation(&opened_effects, OperationKind::Open);
    union
        .complete(
            &open,
            &json!({"subscriptionId":open.params["subscriptionId"],"streamId":"host-stream"}),
        )
        .unwrap();
    union.event(&event(&open, "snapshot", 1)).unwrap();
    union.acknowledge(&fast, &cursor(1)).unwrap();
    // The joiner has not applied a baseline yet, so it has nothing to acknowledge.
    let key = union.members.get(&fast).unwrap().clone();
    union
        .demands
        .get_mut(&key)
        .unwrap()
        .members
        .get_mut(&pending)
        .unwrap()
        .baseline = None;
    for sequence in 2..=6 {
        union.event(&event(&open, "delta", sequence)).unwrap();
        union.acknowledge(&fast, &cursor(sequence)).unwrap();
    }
    let effects = union.event(&event(&open, "delta", 7)).unwrap();
    assert!(!effects
        .notices
        .iter()
        .any(|notice| matches!(notice, Notice::Rejected { member } if member == &pending)));
    assert!(union.members.contains_key(&pending));
}
