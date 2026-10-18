//! Real reviewed execution against owned Windows OpenSSH/PowerShell fixtures.
use super::*;
use crate::ssh_jump_config::native_tests::{config_path, key, server};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn effective_target(base: &SshEndpoint, id: &str, output: &Path, code: u16) -> ResolvedTarget {
    use crate::ssh_group_defaults as groups;
    let group = groups::GroupDefaults {
        id: "execution-fixture".into(),
        revision: 1,
        name: "Owned execution fixture".into(),
        defaults: Default::default(),
        environment: vec![
            groups::LiteralEnvironment {
                name: "APP_EXEC_ID".into(),
                value: id.into(),
            },
            groups::LiteralEnvironment {
                name: "APP_EXEC_ROOT".into(),
                value: config_path(output),
            },
            groups::LiteralEnvironment {
                name: "APP_EXEC_CODE".into(),
                value: code.to_string(),
            },
        ],
        shell_kind: Some(RemoteShellKind::Powershell),
    };
    let selection = groups::Inheritance {
        group_id: group.id.clone(),
        fields: vec![],
        environment: true,
    };
    let effective = groups::resolve(base, Some(&selection), Some(&group)).unwrap();
    ResolvedTarget {
        server_id: id.into(),
        proxy_grant: None,
        endpoint: crate::ssh_configuration::runtime_endpoint(effective),
    }
}
fn await_status(engine: &SshExecutions, store: &dyn RunPersistence, run: &str) -> RunStatus {
    let deadline = Instant::now() + Duration::from_secs(25);
    loop {
        let status = engine.status("main", run, store).unwrap();
        if status.finished() {
            return status;
        }
        assert!(Instant::now() < deadline, "Owned execution did not settle");
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn await_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.is_file() {
        assert!(
            Instant::now() < deadline,
            "Owned remote script did not start"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
#[ignore = "Starts three owned disposable sshd children and reviewed PowerShell scripts; requires existing PS7"]
fn actual_reviewed_multi_target_outcomes_concurrency_cancel_and_no_replay() {
    let base = PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("execution-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME").unwrap();
    let mut daemons = Vec::new();
    let mut routes = Vec::new();
    let mut known = Vec::new();
    for i in 0..3 {
        let client = key(&root, &format!("client-{i}"));
        let host = key(&root, &format!("host-{i}"));
        let (daemon, port, trust) = server(&root, i, &client, &host, &user);
        daemons.push(daemon);
        known.push(trust);
        routes.push(SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(user.clone()),
            port,
            identity_file: Some(config_path(&client)),
            ..Default::default()
        });
    }
    let trusts = known.clone();
    let runner: TargetRunner = Arc::new(move |batch, index, book, target, limits| {
        let options = vec![
            "-o".into(),
            format!("UserKnownHostsFile={}", config_path(&trusts[index])),
        ];
        execute_prepared(
            batch,
            index,
            prepare_process_with_options(book, target, &options),
            limits,
        );
    });
    let store = Arc::new(MemoryPersistence::default());
    let reviews = SshExecutionReviews::default();
    let engine = Arc::new(SshExecutions::default());
    let mixed = root.join("mixed");
    fs::create_dir(&mixed).unwrap();
    let targets: Vec<_> = routes
        .iter()
        .enumerate()
        .map(|(i, route)| effective_target(route, &format!("server-{i}"), &mixed, [0, 7, 255][i]))
        .collect();
    let book = RunbookSnapshot { automation_id: "owned-runbook".into(), revision: 1, shell: RemoteShellKind::Powershell, script: r#"$ErrorActionPreference='Stop'
$p=$env:APP_EXEC_ROOT;$n=$env:APP_EXEC_ID
[IO.File]::WriteAllText((Join-Path $p ('start-'+$n)),[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString())
$d=[DateTime]::UtcNow.AddSeconds(8)
while([IO.Directory]::GetFiles($p,'start-*').Count -lt 2){if([DateTime]::UtcNow -gt $d){exit 88};Start-Sleep -Milliseconds 20}
Start-Sleep -Milliseconds 200
[IO.File]::AppendAllText((Join-Path $p ('count-'+$n)),'1')
[IO.File]::WriteAllText((Join-Path $p ('end-'+$n)),[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString())
exit ([int]$env:APP_EXEC_CODE)"#.into() };
    let limits = ExecutionLimits {
        concurrency: 2,
        timeout_seconds: 20,
    };
    assert!(
        fs::read_dir(&mixed).unwrap().next().is_none(),
        "Creating engine/restore state must not execute anything"
    );
    let review = reviews.preview("main", &book, &targets, limits).unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "actual-mixed".into(),
            book.clone(),
            targets.clone(),
            limits,
            store.clone(),
            runner.clone(),
        )
        .unwrap();
    let status = await_status(&engine, store.as_ref(), "actual-mixed");
    assert_eq!(
        (status.targets[0].state.clone(), status.targets[0].exit_code),
        (TargetState::Exited, Some(0))
    );
    assert_eq!(
        (status.targets[1].state.clone(), status.targets[1].exit_code),
        (TargetState::Failed, Some(7))
    );
    assert_eq!(
        (status.targets[2].state.clone(), status.targets[2].exit_code),
        (TargetState::Unknown, Some(255))
    );
    let mut events = Vec::new();
    for i in 0..3 {
        let id = format!("server-{i}");
        assert_eq!(
            fs::read_to_string(mixed.join(format!("count-{id}"))).unwrap(),
            "1"
        );
        events.push((
            fs::read_to_string(mixed.join(format!("start-{id}")))
                .unwrap()
                .parse::<i64>()
                .unwrap(),
            1,
        ));
        events.push((
            fs::read_to_string(mixed.join(format!("end-{id}")))
                .unwrap()
                .parse::<i64>()
                .unwrap(),
            -1,
        ));
    }
    events.sort();
    let (mut active, mut peak) = (0, 0);
    for (_, delta) in events {
        active += delta;
        peak = peak.max(active);
    }
    assert_eq!(
        peak, 2,
        "Actual remote intervals must overlap within configured concurrency"
    );
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "actual-mixed".into(),
            book.clone(),
            targets.clone(),
            limits,
            store.clone(),
            runner.clone(),
        )
        .unwrap();
    let recovered = Arc::new(SshExecutions::default());
    recovered
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "actual-mixed".into(),
            book,
            targets,
            limits,
            store.clone(),
            runner.clone(),
        )
        .unwrap();
    for i in 0..3 {
        assert_eq!(
            fs::read_to_string(mixed.join(format!("count-server-{i}"))).unwrap(),
            "1",
            "Duplicate or restarted engine must not replay"
        );
    }
    let metadata = serde_json::to_string(&status).unwrap();
    assert!(
        !metadata.contains("WriteAllText") && !metadata.contains(&config_path(&root)),
        "Durable status must not capture script, env or output"
    );

    let cancel_root = root.join("cancel");
    fs::create_dir(&cancel_root).unwrap();
    let targets: Vec<_> = routes
        .iter()
        .enumerate()
        .map(|(i, route)| effective_target(route, &format!("server-{i}"), &cancel_root, 0))
        .collect();
    let book = RunbookSnapshot { automation_id: "owned-runbook".into(), revision: 2, shell: RemoteShellKind::Powershell, script: "[IO.File]::WriteAllText((Join-Path $env:APP_EXEC_ROOT $env:APP_EXEC_ID),'begun')\nStart-Sleep -Seconds 3\nexit 0".into() };
    let limits = ExecutionLimits {
        concurrency: 1,
        timeout_seconds: 15,
    };
    let review = reviews.preview("main", &book, &targets, limits).unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "actual-cancel".into(),
            book.clone(),
            targets.clone(),
            limits,
            store.clone(),
            runner.clone(),
        )
        .unwrap();
    await_file(&cancel_root.join("server-0"));
    assert!(engine
        .cancel("foreign-window", "actual-cancel", None)
        .is_err());
    engine
        .cancel("main", "actual-cancel", Some("server-1"))
        .unwrap();
    engine.cancel("main", "actual-cancel", None).unwrap();
    let status = await_status(&engine, store.as_ref(), "actual-cancel");
    assert!(status
        .targets
        .iter()
        .all(|target| target.state == TargetState::Cancelled));
    assert!(
        !cancel_root.join("server-1").exists() && !cancel_root.join("server-2").exists(),
        "Queued cancellation must prevent remote execution"
    );

    let timeout_root = root.join("timeout");
    fs::create_dir(&timeout_root).unwrap();
    let targets = vec![effective_target(&routes[0], "server-0", &timeout_root, 0)];
    let timeout_book = RunbookSnapshot {
        script: "[IO.File]::WriteAllText((Join-Path $env:APP_EXEC_ROOT $env:APP_EXEC_ID),'begun')\nStart-Sleep -Seconds 8\nexit 0".into(),
        ..book.clone()
    };
    let timeout_limits = ExecutionLimits {
        concurrency: 1,
        timeout_seconds: 3,
    };
    let review = reviews
        .preview("main", &timeout_book, &targets, timeout_limits)
        .unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "actual-timeout".into(),
            timeout_book,
            targets,
            timeout_limits,
            store.clone(),
            runner.clone(),
        )
        .unwrap();
    await_file(&timeout_root.join("server-0"));
    let timed_out = await_status(&engine, store.as_ref(), "actual-timeout");
    assert_eq!(timed_out.targets[0].state, TargetState::Unknown);
    assert_eq!(
        timed_out.targets[0].reason.as_deref(),
        Some("timeout_remote_outcome_unknown")
    );
    assert_eq!(timed_out.targets[0].exit_code, None);

    let close_root = root.join("close");
    fs::create_dir(&close_root).unwrap();
    let targets = vec![effective_target(&routes[0], "server-0", &close_root, 0)];
    let review = reviews.preview("main", &book, &targets, limits).unwrap();
    engine
        .start_with_runner(
            &reviews,
            "main",
            &review.review_id,
            "actual-close".into(),
            book,
            targets,
            limits,
            store.clone(),
            runner,
        )
        .unwrap();
    await_file(&close_root.join("server-0"));
    reviews.close_window("main");
    engine.close_window("main");
    assert_eq!(
        await_status(&engine, store.as_ref(), "actual-close").targets[0].state,
        TargetState::Cancelled
    );
    fs::write(root.join("result.txt"), "Reviewed canonical SSH execution: actual concurrent remote intervals bounded at two; exit0/exited, exit7/failed and exit255/unknown; same review/run duplicate and restarted engine do not replay; metadata contains no script/env/output; foreign cancellation denied; queued targets never execute after cancel; running cancellation and native-window close settle cancelled with remote-outcome caveat. Fixture-only target known-host prefixes; all other process lifecycle and route policy are production engine code.\n").unwrap();
    drop(daemons);
}
