use super::*;

#[test]
fn omitted_workspace_mode_inherits_policy_and_survives_storage() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    let value = workspace_definition();
    let input: AutomationUpsert = serde_json::from_value(value.clone()).unwrap();
    validate_upsert(&input, 1).unwrap();
    assert!(input.workspace_mode.is_none());

    let automation: Automation = serde_json::from_value(value).unwrap();
    write_automation(&conn, &automation).unwrap();
    let loaded = get(&conn, &automation.id).unwrap().unwrap();
    assert!(loaded.workspace_mode.is_none());
    assert!(serde_json::to_value(&loaded)
        .unwrap()
        .get("workspaceMode")
        .is_none());
    assert!(list(&conn).unwrap()[0].workspace_mode.is_none());
}

#[test]
fn explicit_workspace_modes_keep_their_values_and_validation() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    for mode in ["current", "worktree", "existing"] {
        let mut value = workspace_definition();
        value["workspaceMode"] = serde_json::json!(mode);
        value["worktreeCwd"] = serde_json::json!("/tmp/selected-worktree");
        let input: AutomationUpsert = serde_json::from_value(value.clone()).unwrap();
        validate_upsert(&input, 1).unwrap();
        let automation: Automation = serde_json::from_value(value).unwrap();
        write_automation(&conn, &automation).unwrap();
        let loaded = get(&conn, &automation.id).unwrap().unwrap();
        assert_eq!(loaded.workspace_mode.as_deref(), Some(mode));
        assert_eq!(
            serde_json::to_value(&loaded).unwrap()["workspaceMode"],
            mode
        );
        assert_eq!(loaded.worktree_cwd, "/tmp/selected-worktree");
    }
    let mut value = workspace_definition();
    value["workspaceMode"] = serde_json::json!("existing");
    let input: AutomationUpsert = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(
        validate_upsert(&input, 1).unwrap_err(),
        "Choose an existing worktree for this automation."
    );
    value["workspaceMode"] = serde_json::json!("unknown");
    let input: AutomationUpsert = serde_json::from_value(value).unwrap();
    assert_eq!(
        validate_upsert(&input, 1).unwrap_err(),
        "Invalid automation workspace mode."
    );
}

fn workspace_definition() -> serde_json::Value {
    serde_json::json!({
        "id":"automation-id","name":"Audit","prompt":"Review this project","harness":"codex","model":"model",
        "cwd":"/tmp","reuseSession":false,"runtimeMode":"supervised",
        "scheduleKind":"daily","minute":0,"time":"09:00","dayOfWeek":1,"missedRunGraceMinutes":0,
        "enabled":false,"nextRunAt":1000,"createdAt":1,"updatedAt":1
    })
}

#[test]
fn typed_ssh_automations_never_enter_the_legacy_agent_launcher() {
    let mut value = serde_json::json!({
        "id":"ssh-book","name":"SSH book","prompt":"agent-shaped input","harness":"codex","model":"model",
        "cwd":"/tmp","workspaceMode":"current","reuseSession":false,"runtimeMode":"supervised",
        "scheduleKind":"daily","minute":0,"time":"09:00","dayOfWeek":1,"missedRunGraceMinutes":0,
        "enabled":false,"nextRunAt":1000,"createdAt":1,"updatedAt":1,"executor":"ssh",
        "sshRunbook":{"revision":1,"script":"pwd","shell":"posix","targetIds":["server-one"],"limits":{"concurrency":1,"timeoutSeconds":10}}
    });
    let ssh: Automation = serde_json::from_value(value.clone()).unwrap();
    assert!(is_ssh(&ssh));
    assert!(require_agent(&ssh).is_err());
    let upsert: AutomationUpsert = serde_json::from_value(value.clone()).unwrap();
    assert!(validate_upsert(&upsert, 1).is_err());
    value.as_object_mut().unwrap().remove("executor");
    let metadata_only: Automation = serde_json::from_value(value.clone()).unwrap();
    assert!(require_agent(&metadata_only).is_err());
    value.as_object_mut().unwrap().remove("sshRunbook");
    let legacy: Automation = serde_json::from_value(value).unwrap();
    require_agent(&legacy).unwrap();
    assert!(validate_event_key("ssh-run:reserved-native-id").is_err());
}

#[test]
fn accepts_task_and_social_triggers_without_accepting_unknown_sources() {
    for (kind, event) in [("tasks", "task_blocked"), ("social", "message_received")] {
        let mut trigger: AutomationTrigger = serde_json::from_value(serde_json::json!({
            "id": "event-trigger", "kind": kind, "event": event
        }))
        .unwrap();
        assert!(validate_trigger(&trigger).is_ok());
        trigger.kind = "unknown-source".into();
        assert!(validate_trigger(&trigger).is_err());
    }
}

#[test]
fn validates_time_fields() {
    assert!(valid_time("09:30"));
    assert!(valid_time("23:59"));
    assert!(!valid_time("24:00"));
    assert!(!valid_time("9:30"));
}

#[test]
fn existing_automations_default_to_time_triggers() {
    let automation = Automation {
        executor: None,
        ssh_runbook: None,
        id: "automation-id".into(),
        name: "Audit".into(),
        prompt: "Review the repository".into(),
        harness: "codex".into(),
        provider_account_id: None,
        model_choice: None,
        model: "model".into(),
        model_settings: HashMap::new(),
        cwd: "/tmp".into(),
        workspace_mode: Some("worktree".into()),
        worktree_cwd: String::new(),
        session_folder_id: String::new(),
        reuse_session: false,
        runtime_mode: "auto".into(),
        trigger_kind: "github".into(),
        trigger_event: "pull_request_opened".into(),
        schedule_kind: "weekdays".into(),
        minute: 0,
        time: "09:00".into(),
        day_of_week: 1,
        triggers: None,
        missed_run_grace_minutes: 720,
        max_run_minutes: 0,
        max_runs_per_day: 0,
        enabled: true,
        next_run_at: 1,
        last_run_at: None,
        last_run_status: None,
        last_run_error: None,
        last_session_id: None,
        created_at: 1,
        updated_at: 1,
    };
    let mut stored = serde_json::to_value(automation).unwrap();
    stored
        .as_object_mut()
        .unwrap()
        .remove("triggerKind")
        .unwrap();
    stored
        .as_object_mut()
        .unwrap()
        .remove("triggerEvent")
        .unwrap();

    let restored: Automation = serde_json::from_value(stored).unwrap();
    assert_eq!(restored.trigger_kind, "time");
    assert!(restored.trigger_event.is_empty());
}

#[test]
fn missing_triggers_hydrate_from_legacy_fields() {
    let automation = Automation {
        executor: None,
        ssh_runbook: None,
        id: "automation-id".into(),
        name: "Audit".into(),
        prompt: "Review the repository".into(),
        harness: "codex".into(),
        provider_account_id: None,
        model_choice: None,
        model: "model".into(),
        model_settings: HashMap::new(),
        cwd: "/tmp".into(),
        workspace_mode: Some("worktree".into()),
        worktree_cwd: String::new(),
        session_folder_id: String::new(),
        reuse_session: false,
        runtime_mode: "auto".into(),
        trigger_kind: "gitlab".into(),
        trigger_event: "merge_request_opened".into(),
        schedule_kind: "weekdays".into(),
        minute: 0,
        time: "09:00".into(),
        day_of_week: 1,
        triggers: None,
        missed_run_grace_minutes: 720,
        max_run_minutes: 0,
        max_runs_per_day: 0,
        enabled: true,
        next_run_at: 1,
        last_run_at: None,
        last_run_status: None,
        last_run_error: None,
        last_session_id: None,
        created_at: 1,
        updated_at: 1,
    };
    let mut stored = serde_json::to_value(&automation).unwrap();
    stored.as_object_mut().unwrap().remove("triggers");
    let mut restored: Automation = serde_json::from_value(stored).unwrap();
    assert!(restored.triggers.is_none());
    hydrate_triggers(&mut restored);
    let triggers = restored.triggers.as_ref().unwrap();
    assert_eq!(triggers.len(), 1);
    assert_eq!(triggers[0].kind, "gitlab");
    assert_eq!(triggers[0].event, "merge_request_opened");
}

#[test]
fn empty_triggers_stay_empty() {
    let mut restored: Automation = serde_json::from_value(serde_json::json!({
        "id": "automation-id",
        "name": "Audit",
        "prompt": "Review the repository",
        "harness": "codex",
        "model": "model",
        "cwd": "/tmp",
        "workspaceMode": "worktree",
        "reuseSession": false,
        "runtimeMode": "auto",
        "triggerKind": "time",
        "triggerEvent": "",
        "scheduleKind": "weekdays",
        "minute": 0,
        "time": "09:00",
        "dayOfWeek": 1,
        "triggers": [],
        "missedRunGraceMinutes": 720,
        "enabled": true,
        "nextRunAt": 1,
        "createdAt": 1,
        "updatedAt": 1
    }))
    .unwrap();
    hydrate_triggers(&mut restored);
    assert!(restored.triggers.as_ref().unwrap().is_empty());
}

#[test]
fn trims_run_history_to_the_configured_limit() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    conn.execute(
        "INSERT INTO automations (id, definition_json, enabled, next_run_at, updated_at)
             VALUES ('automation-id', '{}', 1, 1, 1)",
        [],
    )
    .unwrap();
    for index in 0..=MAX_RUNS_PER_AUTOMATION {
        let run = AutomationRun {
            execution: None,
            max_run_minutes: None,
            executor: None,
            ssh_execution: None,
            id: format!("run-{index}"),
            automation_id: "automation-id".into(),
            trigger: "manual".into(),
            scheduled_for: index,
            created_at: index,
            started_at: None,
            completed_at: Some(index),
            status: "succeeded".into(),
            session_id: None,
            error: None,
            event_key: None,
            event_kind: None,
            event: None,
            prompt: Some("Run the automation".into()),
        };
        write_run(&conn, &run).unwrap();
    }

    trim_history(&conn, "automation-id").unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM automation_runs WHERE automation_id = 'automation-id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, MAX_RUNS_PER_AUTOMATION);
}

#[test]
fn trim_history_preserves_nonterminal_runs() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    conn.execute(
        "INSERT INTO automations (id, definition_json, enabled, next_run_at, updated_at)
             VALUES ('automation-id', '{}', 1, 1, 1)",
        [],
    )
    .unwrap();
    for index in 0..=MAX_RUNS_PER_AUTOMATION {
        let run = AutomationRun {
            execution: None,
            max_run_minutes: None,
            executor: None,
            ssh_execution: None,
            id: format!("run-{index}"),
            automation_id: "automation-id".into(),
            trigger: "manual".into(),
            scheduled_for: index,
            created_at: index,
            started_at: None,
            completed_at: None,
            status: "pending".into(),
            session_id: None,
            error: None,
            event_key: None,
            event_kind: None,
            event: None,
            prompt: Some("Run the automation".into()),
        };
        write_run(&conn, &run).unwrap();
    }

    trim_history(&conn, "automation-id").unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM automation_runs WHERE automation_id = 'automation-id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, MAX_RUNS_PER_AUTOMATION + 1);
}

#[test]
fn accepts_inbox_event_keys() {
    assert!(validate_event_key("github:pr:acme/web:12").is_ok());
    assert!(validate_event_key("linear:issue:eng-12").is_ok());
    assert!(validate_event_key("jira:issue:10042").is_ok());
    assert!(validate_event_key("azuredevops:pr:acme/web:12").is_ok());
    assert!(validate_event_key("").is_err());
    assert!(validate_event_key("github:pr:acme web:12").is_err());
}

#[test]
fn accepts_jira_triggers() {
    let trigger = trigger_from_fields(
        "jira-trigger",
        "jira",
        "issue_created",
        "weekdays",
        0,
        "09:00",
        1,
    );
    assert!(validate_trigger(&trigger).is_ok());
}

#[test]
fn accepts_azure_devops_triggers() {
    let trigger = trigger_from_fields(
        "trigger-id",
        "azuredevops",
        "pull_request_appeared",
        "weekdays",
        0,
        "09:00",
        1,
    );
    assert!(validate_trigger(&trigger).is_ok());
}

#[test]
fn claims_each_event_key_once() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    conn.execute(
        "INSERT INTO automations (id, definition_json, enabled, next_run_at, updated_at)
             VALUES ('automation-id', '{}', 1, 1, 1)",
        [],
    )
    .unwrap();
    let claim = || {
        conn.execute(
            "INSERT OR IGNORE INTO automation_event_claims
                 (automation_id, event_key, created_at) VALUES (?1, ?2, ?3)",
            params!["automation-id", "github:pr:acme/web:12", 1],
        )
        .unwrap()
    };

    assert_eq!(claim(), 1);
    assert_eq!(claim(), 0);
}

#[test]
fn pending_event_claim_retry_recovers_only_unstarted_committed_run() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    conn.execute(
        "INSERT INTO automations VALUES ('automation-id', '{}', 1, 1, 1)",
        [],
    )
    .unwrap();
    let mut run = new_event_run(
        "automation-id",
        "tasks:event-a",
        "tasks",
        "task_blocked",
        1,
        2,
        "original prompt",
    );
    let owner = "window-a:original-mounted-poller";
    assert!(claim_event_key(&conn, "automation-id", "tasks:event-a", 2, Some(owner)).unwrap());
    write_run(&conn, &run).unwrap();
    // B receives neither a new claim nor A's pending run, even if A's reply
    // was lost. Only the original native window can resume that claim.
    for stranger in [
        "window-b:original-mounted-poller",
        "window-a:different-mounted-poller",
    ] {
        assert!(
            !claim_event_key(&conn, "automation-id", "tasks:event-a", 3, Some(stranger)).unwrap()
        );
        assert!(
            pending_event_run(&conn, "automation-id", "tasks:event-a", stranger)
                .unwrap()
                .is_none()
        );
    }
    assert!(!claim_event_key(&conn, "automation-id", "tasks:event-a", 3, Some(owner)).unwrap());
    let retry = pending_event_run(&conn, "automation-id", "tasks:event-a", owner)
        .unwrap()
        .unwrap();
    assert_eq!(retry.id, run.id);
    assert_eq!(retry.prompt.as_deref(), Some("original prompt"));
    assert!(pending_event_run(&conn, "other", "tasks:event-a", owner)
        .unwrap()
        .is_none());
    for status in ["running", "succeeded", "failed", "cancelled"] {
        run.status = status.into();
        write_run(&conn, &run).unwrap();
        assert!(
            pending_event_run(&conn, "automation-id", "tasks:event-a", owner)
                .unwrap()
                .is_none()
        );
    }
}

#[test]
fn pending_event_claim_retry_keeps_unknown_legacy_ownership_closed() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE automation_event_claims (automation_id TEXT NOT NULL, event_key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (automation_id, event_key));").unwrap();
    ensure_tables(&conn).unwrap();
    conn.execute(
        "INSERT INTO automations VALUES ('automation-id', '{}', 1, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute("INSERT INTO automation_event_claims (automation_id, event_key, created_at) VALUES ('automation-id', 'tasks:legacy', 1)", []).unwrap();
    let run = new_event_run(
        "automation-id",
        "tasks:legacy",
        "tasks",
        "task_blocked",
        1,
        2,
        "legacy prompt",
    );
    write_run(&conn, &run).unwrap();
    for owner in ["window-a", "window-b"] {
        assert!(!claim_event_key(&conn, "automation-id", "tasks:legacy", 3, Some(owner)).unwrap());
        assert!(
            pending_event_run(&conn, "automation-id", "tasks:legacy", owner)
                .unwrap()
                .is_none()
        );
    }
}

#[test]
fn accepts_event_keys_for_changes_after_opening() {
    assert!(validate_event_key("github:issue:acme/web:12:reopened:1790000000000").is_ok());
    assert!(
        validate_event_key("github:issue:acme/web:12:labeled:good_first_issue:1790000000000")
            .is_ok()
    );
}

#[test]
fn stored_triggers_without_a_label_wait_for_any_label() {
    let trigger: AutomationTrigger =
        serde_json::from_str(r#"{"id":"t","kind":"github","event":"issue_labeled"}"#).unwrap();
    assert_eq!(trigger.label, "");
    assert!(validate_trigger(&trigger).is_ok());
}

#[test]
fn saving_keeps_the_trigger_label_and_trims_it() {
    let upsert: AutomationUpsert = serde_json::from_value(serde_json::json!({
        "id": "automation-id",
        "name": "Fix labeled issues",
        "prompt": "Fix it",
        "harness": "claude",
        "model": "model",
        "cwd": "/tmp",
        "workspaceMode": "worktree",
        "runtimeMode": "auto",
        "scheduleKind": "weekdays",
        "minute": 0,
        "time": "09:00",
        "dayOfWeek": 1,
        "missedRunGraceMinutes": 60,
        "nextRunAt": 1,
        "triggers": [
            {"id": "t", "kind": "github", "event": "issue_labeled", "label": "  auto-fix "}
        ]
    }))
    .unwrap();
    let triggers = normalize_triggers(&upsert);
    assert_eq!(triggers[0].label, "auto-fix");
    assert_eq!(
        serde_json::to_value(&triggers[0]).unwrap()["label"],
        "auto-fix"
    );
}

#[test]
fn rejects_an_overlong_trigger_label() {
    let mut trigger = trigger_from_fields(
        "trigger-id",
        "github",
        "issue_labeled",
        "weekdays",
        0,
        "09:00",
        1,
    );
    trigger.label = "x".repeat(200);
    assert!(validate_trigger(&trigger).is_ok());
    trigger.label = "x".repeat(201);
    assert!(validate_trigger(&trigger).is_err());
}

#[test]
fn routing_fields_round_trip_old_and_new_automation_rows() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_tables(&conn).unwrap();
    for choice in [
        None,
        Some(serde_json::json!({"kind":"default"})),
        Some(serde_json::json!({"kind":"pool","poolId":"pool"})),
    ] {
        let mut value = workspace_definition();
        if let Some(choice) = choice {
            value["modelChoice"] = choice;
            value["providerAccountId"] = serde_json::json!("account");
        }
        let input: AutomationUpsert = serde_json::from_value(value.clone()).unwrap();
        let automation: Automation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(input.model_choice, automation.model_choice);
        assert_eq!(input.provider_account_id, automation.provider_account_id);
        write_automation(&conn, &automation).unwrap();
        let stored = serde_json::to_value(get(&conn, &automation.id).unwrap().unwrap()).unwrap();
        assert_eq!(stored.get("modelChoice"), value.get("modelChoice"));
        assert_eq!(
            stored.get("providerAccountId"),
            value.get("providerAccountId")
        );
    }
}

#[test]
fn routing_fields_round_trip_old_and_new_run_rows() {
    let original = new_run("automation-id", "manual", 1, 1, "Audit");
    let old = serde_json::to_value(&original).unwrap();
    assert!(old.get("execution").is_none());
    let restored: AutomationRun = serde_json::from_value(old.clone()).unwrap();
    assert!(restored.execution.is_none());
    assert!(restored.max_run_minutes.is_none());
    let mut new = old;
    new["execution"] = serde_json::json!({"harness":"codex","providerAccountId":"account","model":"codex:model","modelSettings":{"effort":"high"}});
    new["maxRunMinutes"] = serde_json::json!(23);
    let restored: AutomationRun = serde_json::from_value(new.clone()).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(), new);
}
