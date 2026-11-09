use super::*;
#[test]
fn run_claimed_in_this_process_stays_queued_on_load_but_earlier_run_is_recovered() {
    let store = SessionStore::open_in_memory().unwrap();
    let book = save(&store.lock_conn().unwrap(), &draft(), None).unwrap();
    claim(&store.lock_conn().unwrap(), &status(&book, "live-run")).unwrap();
    claim(&store.lock_conn().unwrap(), &status(&book, "old-run")).unwrap();
    store
        .lock_conn()
        .unwrap()
        .execute(
            "UPDATE automation_runs SET created_at=0 WHERE id='old-run'",
            [],
        )
        .unwrap();
    let live = load_run_with(&store, "main", "live-run").unwrap().unwrap();
    assert!(live
        .targets
        .iter()
        .all(|t| t.state == TargetState::Queued && t.reason.is_none()));
    let old = load_run_with(&store, "main", "old-run").unwrap().unwrap();
    assert!(old.targets.iter().all(|t| t.state == TargetState::Unknown
        && t.reason.as_deref() == Some("interrupted_after_restart")));
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::automations::ensure_tables(&conn).unwrap();
    conn
}
fn draft() -> Profile {
    Profile {
        triggers: None,
        id: "book-one".into(),
        name: "Owned runbook".into(),
        revision: 0,
        script: "printf 'RUNBOOK_BODY_NEVER_IN_RUN_METADATA'\n".into(),
        shell: RemoteShellKind::Posix,
        target_ids: vec!["server-one".into(), "server-two".into()],
        limits: ExecutionLimits {
            concurrency: 2,
            timeout_seconds: 10,
        },
    }
}
fn status(book: &Profile, id: &str) -> RunStatus {
    RunStatus {
        run_id: id.into(),
        automation_id: book.id.clone(),
        revision: book.revision,
        owner: "main".into(),
        digest: "a".repeat(64),
        targets: book
            .target_ids
            .iter()
            .map(|id| ssh_execution::TargetOutcome {
                server_id: id.clone(),
                state: TargetState::Queued,
                exit_code: None,
                reason: None,
            })
            .collect(),
    }
}
fn claim_transaction(conn: &mut Connection, status: &RunStatus) -> Result<ClaimResult, String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let result = claim(&tx, status)?;
    tx.commit().unwrap();
    Ok(result)
}
#[test]
fn existing_table_cas_preserves_unknown_metadata_and_manual_only_policy() {
    let conn = database();
    let first = save(&conn, &draft(), None).unwrap();
    assert_eq!(first.revision, 1);
    let mut value = definition(&conn, &first.id).unwrap().unwrap();
    value["future"] = json!({"otherSession":"preserved"});
    conn.execute(
        "UPDATE automations SET definition_json=?2 WHERE id=?1",
        params![first.id, serde_json::to_string(&value).unwrap()],
    )
    .unwrap();
    let mut edit = first.clone();
    edit.name = "Changed".into();
    let second = save(&conn, &edit, Some(1)).unwrap();
    assert_eq!(second.revision, 2);
    assert!(save(&conn, &edit, Some(1)).is_err());
    let value = definition(&conn, &first.id).unwrap().unwrap();
    assert_eq!(value["future"]["otherSession"], "preserved");
    assert_eq!(value["enabled"], false);
    assert_eq!(value["nextRunAt"], 0);
    assert_eq!(value["triggers"], json!([]));
    assert!(serde_json::from_value::<crate::automations::Automation>(value).is_ok());
    assert_eq!(get(&conn, &first.id).unwrap(), second);
    conn.execute("INSERT INTO automations VALUES('agent-id','{\"id\":\"agent-id\",\"name\":\"Existing agent\"}',0,0,0)",[]).unwrap();
    let mut agent_collision = draft();
    agent_collision.id = "agent-id".into();
    assert!(save(&conn, &agent_collision, None).is_err());
    assert_eq!(
        definition(&conn, "agent-id").unwrap().unwrap()["name"],
        "Existing agent"
    );
}
#[test]
fn claims_are_atomic_metadata_only_and_duplicate_status_never_replays() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    let initial = status(&book, "run-one");
    assert!(matches!(
        claim_transaction(&mut conn, &initial).unwrap(),
        ClaimResult::Claimed
    ));
    assert!(
        matches!(claim_transaction(&mut conn,&initial).unwrap(),ClaimResult::Existing(found) if found==initial)
    );
    let raw: String = conn
        .query_row("SELECT run_json FROM automation_runs", [], |r| r.get(0))
        .unwrap();
    assert!(!raw.contains("RUNBOOK_BODY_NEVER_IN_RUN_METADATA"));
    assert!(!raw.contains("prompt"));
    assert!(!raw.contains("stdout"));
    assert!(serde_json::from_str::<crate::automations::AutomationRun>(&raw).is_ok());
    assert!(ensure_not_active(&conn, &book.id).is_err());
    let mut wrong = initial.clone();
    wrong.owner = "another-window".into();
    assert!(update(&conn, &wrong).is_err());
    let mut complete = initial;
    for target in &mut complete.targets {
        target.state = TargetState::Exited;
        target.exit_code = Some(0);
    }
    update(&conn, &complete).unwrap();
    ensure_not_active(&conn, &book.id).unwrap();
    assert_eq!(read_run(&conn, "run-one").unwrap().unwrap(), complete);
}
#[test]
fn stale_revision_or_failed_insert_rolls_back_claim_without_execution_authority() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    let mut stale = status(&book, "stale-run");
    stale.revision += 1;
    assert!(claim_transaction(&mut conn, &stale).is_err());
    conn.execute_batch("CREATE TRIGGER deny_run BEFORE INSERT ON automation_runs BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;").unwrap();
    assert!(claim_transaction(&mut conn, &status(&book, "failed-run")).is_err());
    let count: i64 = conn
        .query_row("SELECT count(*) FROM automation_event_claims", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}
#[test]
fn recovery_settles_unknown_and_deletion_keeps_non_replay_identity_without_script() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    let initial = status(&book, "owned-run");
    claim_transaction(&mut conn, &initial).unwrap();
    assert!(remove(&conn, &book.id, book.revision).is_err());
    recover_run(&conn, "owned-run").unwrap();
    let recovered = read_run(&conn, "owned-run").unwrap().unwrap();
    assert!(recovered.finished());
    assert!(recovered
        .targets
        .iter()
        .all(|t| t.state == TargetState::Unknown
            && t.reason.as_deref() == Some("interrupted_after_restart")));
    assert!(
        matches!(claim_transaction(&mut conn,&initial).unwrap(),ClaimResult::Existing(found) if found==recovered)
    );
    conn.execute("DELETE FROM automation_runs WHERE id='owned-run'", [])
        .unwrap();
    assert!(claim_transaction(&mut conn, &initial).is_err());
    remove(&conn, &book.id, book.revision).unwrap();
    assert!(get(&conn, &book.id).is_err());
    assert!(save(&conn, &draft(), None).is_err());
    let value = definition(&conn, &book.id).unwrap().unwrap();
    assert_eq!(value["sshRunbookDeleted"], true);
    assert!(value.get("sshRunbook").is_none());
    assert!(!serde_json::to_string(&value)
        .unwrap()
        .contains("RUNBOOK_BODY_NEVER_IN_RUN_METADATA"));
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM automation_event_claims WHERE event_key='ssh-run:owned-run'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn global_run_claim_survives_trim_and_blocks_reuse_by_another_runbook() {
    let mut conn = database();
    let one = save(&conn, &draft(), None).unwrap();
    claim_transaction(&mut conn, &status(&one, "global-run")).unwrap();
    recover_run(&conn, "global-run").unwrap();
    conn.execute("DELETE FROM automation_runs WHERE id='global-run'", [])
        .unwrap();
    let mut second = draft();
    second.id = "book-two".into();
    let second = save(&conn, &second, None).unwrap();
    assert!(claim_transaction(&mut conn, &status(&second, "global-run")).is_err());
}
#[test]
fn bounded_targets_scripts_and_collection_prevent_ambiguous_or_unbounded_saves() {
    let conn = database();
    let mut invalid = draft();
    invalid.target_ids.push(invalid.target_ids[0].clone());
    assert!(save(&conn, &invalid, None).is_err());
    invalid = draft();
    invalid.script = "-----BEGIN OPENSSH PRIVATE KEY-----".into();
    assert!(save(&conn, &invalid, None).is_err());
    invalid = draft();
    invalid.script = "x".repeat(65537);
    assert!(save(&conn, &invalid, None).is_err());
    invalid = draft();
    invalid.limits.concurrency = 5;
    assert!(save(&conn, &invalid, None).is_err());
    for index in 0..256 {
        let mut book = draft();
        book.id = format!("book-{index}");
        save(&conn, &book, None).unwrap();
    }
    assert!(save(&conn, &draft(), None).is_err());
}
#[test]
fn schedules_materialize_one_metadata_only_review_and_never_claim_execution() {
    let conn = database();
    let mut draft = draft();
    draft.triggers = Some(Triggers {
        startup_server_ids: vec!["server-one".into()],
        interval_minutes: Some(5),
        next_run_at: Some(1),
    });
    let book = save(&conn, &draft, None).unwrap();
    let due = book.triggers.as_ref().unwrap().next_run_at.unwrap();
    assert!(due > 1);
    assert!(pending_intents(&conn, due - 1).unwrap().is_empty());
    let first = pending_intents(&conn, due).unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].status, "pendingReview");
    assert_eq!(
        pending_intents(&conn, due + 600_000).unwrap()[0].id,
        first[0].id
    );
    let claims: i64 = conn
        .query_row("SELECT count(*) FROM automation_event_claims", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(claims, 0);
    let raw: String = conn
        .query_row("SELECT run_json FROM automation_runs", [], |r| r.get(0))
        .unwrap();
    assert!(!raw.contains("RUNBOOK_BODY"));
    assert!(!raw.contains("sshExecution"));
    let mut edited = get(&conn, &book.id).unwrap();
    edited.name = "Renamed".into();
    let saved = save(&conn, &edited, Some(book.revision)).unwrap();
    assert_eq!(
        saved.triggers.as_ref().unwrap().next_run_at,
        edited.triggers.as_ref().unwrap().next_run_at
    );
    assert!(validate_intent(&conn, &first[0].id, &saved).is_err());
}
#[test]
fn review_intent_and_durable_run_claim_commit_together_and_cannot_replay() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    let intent = create_intent(&conn, &book, "startup", Some("server-one".into()), 100).unwrap();
    assert_eq!(
        create_intent(&conn, &book, "startup", Some("server-one".into()), 101)
            .unwrap()
            .id,
        intent.id
    );
    let initial = status(&book, "intent-run");
    {
        let tx = conn.transaction().unwrap();
        assert!(matches!(
            claim_with_intent(&tx, &initial, Some(&intent.id)).unwrap(),
            ClaimResult::Claimed
        ));
        // Dropping the transaction must restore pending review and remove the run claim.
    }
    assert_eq!(
        read_intent(&conn, &intent.id).unwrap().status,
        "pendingReview"
    );
    assert!(read_run(&conn, "intent-run").unwrap().is_none());
    let tx = conn.transaction().unwrap();
    claim_with_intent(&tx, &initial, Some(&intent.id)).unwrap();
    tx.commit().unwrap();
    assert_eq!(read_intent(&conn, &intent.id).unwrap().status, "consumed");
    assert!(claim_with_intent(&conn, &status(&book, "second-run"), Some(&intent.id)).is_err());
    assert!(read_run(&conn, "second-run").unwrap().is_none());
}
#[test]
fn trigger_associations_are_explicit_unique_and_cannot_target_other_servers() {
    let conn = database();
    let mut draft = draft();
    draft.triggers = Some(Triggers {
        startup_server_ids: vec!["unrelated".into()],
        ..Default::default()
    });
    assert!(save(&conn, &draft, None).is_err());
    draft.triggers.as_mut().unwrap().startup_server_ids =
        vec!["server-one".into(), "server-one".into()];
    assert!(save(&conn, &draft, None).is_err());
    draft.triggers.as_mut().unwrap().startup_server_ids.clear();
    draft.triggers.as_mut().unwrap().interval_minutes = Some(0);
    assert!(save(&conn, &draft, None).is_err());
}
#[test]
fn explicit_abandon_after_preclaim_rejection_blocks_late_start_and_allows_fresh_review_identity() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    let old = status(&book, "rejected-start");
    let mut edited = book.clone();
    edited.name = "Changed concurrently".into();
    let current = save(&conn, &edited, Some(book.revision)).unwrap();
    assert!(claim_transaction(&mut conn, &old).is_err());
    {
        let tx = conn.transaction().unwrap();
        abandon_missing(&tx, "main", &old.run_id, &book.id, book.revision).unwrap();
        tx.commit().unwrap();
    }
    assert!(read_run(&conn, &old.run_id).unwrap().is_none());
    // The late native command cannot acquire the original run ID, even if it
    // has already resolved a now-current profile and a fresh review ticket.
    let late = status(&current, &old.run_id);
    assert!(claim_transaction(&mut conn, &late).is_err());
    assert!(matches!(
        claim_transaction(&mut conn, &status(&current, "explicit-fresh-start")).unwrap(),
        ClaimResult::Claimed
    ));
}
#[test]
fn abandonment_is_owner_and_origin_bound_and_rejects_claimed_or_trimmed_runs() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    {
        let tx = conn.transaction().unwrap();
        abandon_missing(&tx, "main", "missing-one", &book.id, book.revision).unwrap();
        tx.commit().unwrap();
    }
    assert!(abandon_missing(&conn, "main", "missing-one", &book.id, book.revision).is_ok());
    assert!(abandon_missing(&conn, "foreign", "missing-one", &book.id, book.revision).is_err());
    assert!(abandon_missing(&conn, "main", "missing-one", &book.id, book.revision + 1).is_err());
    let mut other = draft();
    other.id = "other-book".into();
    let other = save(&conn, &other, None).unwrap();
    assert!(abandon_missing(&conn, "main", "missing-one", &other.id, other.revision).is_err());
    let run = status(&book, "claimed-one");
    claim_transaction(&mut conn, &run).unwrap();
    assert!(abandon_missing(&conn, "main", &run.run_id, &book.id, book.revision).is_err());
    recover_run(&conn, &run.run_id).unwrap();
    conn.execute("DELETE FROM automation_runs WHERE id=?1", [&run.run_id])
        .unwrap();
    assert!(abandon_missing(&conn, "main", &run.run_id, &book.id, book.revision).is_err());
}
#[test]
fn abandonment_marker_and_no_replay_claim_roll_back_together() {
    let mut conn = database();
    let book = save(&conn, &draft(), None).unwrap();
    {
        let tx = conn.transaction().unwrap();
        abandon_missing(&tx, "main", "rolled-back", &book.id, book.revision).unwrap();
    }
    assert!(matches!(
        claim_transaction(&mut conn, &status(&book, "rolled-back")).unwrap(),
        ClaimResult::Claimed
    ));
}
