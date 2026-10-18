//! Owned native runbook Basic acceptance; no real app store or owner credentials.
use super::*;
use crate::{
    ssh_execution::*,
    ssh_group_defaults::RemoteShellKind,
    ssh_http_proxy_credentials::{HttpProxyCredentials, ProxyOperation},
};
#[derive(Default)]
struct Persistence(Mutex<std::collections::HashMap<String, RunStatus>>);
impl RunPersistence for Persistence {
    fn claim(&self, status: &RunStatus) -> Result<ClaimResult, String> {
        let mut rows = self.0.lock().unwrap();
        if let Some(old) = rows.get(&status.run_id) {
            return Ok(ClaimResult::Existing(old.clone()));
        }
        rows.insert(status.run_id.clone(), status.clone());
        Ok(ClaimResult::Claimed)
    }
    fn update(&self, status: &RunStatus) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .insert(status.run_id.clone(), status.clone());
        Ok(())
    }
    fn load(&self, owner: &str, id: &str) -> Result<Option<RunStatus>, String> {
        let found = self.0.lock().unwrap().get(id).cloned();
        if found.as_ref().is_some_and(|s| s.owner != owner) {
            return Err("foreign owner".into());
        }
        Ok(found)
    }
}
#[test]
#[ignore = "Starts an owned disposable sshd, Basic proxy and built headless helper"]
fn actual_runbook_basic_batch_binding_and_duplicate_no_replay() {
    let base = PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("runbook-basic-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let client = key(&root, "client");
    let host = key(&root, "host");
    let user = std::env::var("USERNAME").unwrap();
    let (_daemon, port, trust) = server(&root, 0, &client, &host, &user);
    let proxy = ProxyFixture::start(port, true);
    let endpoint = crate::ssh_security::SshEndpoint {
        host: "127.0.0.1".into(),
        user: Some(user),
        port,
        identity_file: Some(config_path(&client)),
        http_proxy: Some(proxy.endpoint()),
        ..Default::default()
    };
    let helper = helper_path();
    let output = root.join("count.txt");
    let owner = format!("runbook-basic-{}", uuid::Uuid::new_v4());
    crate::ssh_window_lifecycle::register(&owner).unwrap();
    let broker = HttpProxyCredentials::default();
    let reviews = SshExecutionReviews::default();
    let engine = Arc::new(SshExecutions::default());
    let persistence = Arc::new(Persistence::default());
    let book = RunbookSnapshot {
        automation_id: "owned-book".into(),
        revision: 1,
        shell: RemoteShellKind::Powershell,
        script: format!(
            "[IO.File]::AppendAllText('{}','1')\nexit 0",
            config_path(&output).replace('\'', "''")
        ),
    };
    let mut targets = vec![ResolvedTarget {
        server_id: "target-one".into(),
        endpoint: endpoint.clone(),
        proxy_grant: None,
    }];
    let limits = ExecutionLimits {
        concurrency: 1,
        timeout_seconds: 15,
    };
    let review = reviews.preview(&owner, &book, &targets, limits).unwrap();
    let operation = ProxyOperation::Runbook {
        run_id: "actual-basic-run".into(),
        automation_id: book.automation_id.clone(),
        revision: book.revision,
        review_digest: review.digest.clone(),
        server_id: "target-one".into(),
    };
    let approval = broker
        .approve(
            &owner,
            Some("target-one"),
            &endpoint,
            &endpoint,
            &operation,
            BasicCredentials::approved_plain_http("fixture-user", "fixture-password", true)
                .unwrap(),
        )
        .unwrap();
    let grant = broker
        .consume(
            &owner,
            &approval.ticket_id,
            Some("target-one"),
            &endpoint,
            &operation,
        )
        .unwrap();
    assert!(broker
        .consume(
            &owner,
            &approval.ticket_id,
            Some("target-one"),
            &endpoint,
            &operation
        )
        .is_err());
    targets[0].proxy_grant = Some(Arc::new(grant));
    let options = vec![
        "-o".into(),
        format!("UserKnownHostsFile={}", config_path(&trust)),
        "-o".into(),
        format!(
            "ProxyCommand={}",
            crate::ssh_http_proxy::proxy_command(&helper).unwrap()
        ),
    ];
    engine
        .start_fixture(
            &reviews,
            &owner,
            &review.review_id,
            "actual-basic-run".into(),
            book.clone(),
            targets.clone(),
            limits,
            persistence.clone(),
            options.clone(),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let status = engine
            .status(&owner, "actual-basic-run", persistence.as_ref())
            .unwrap();
        if status.finished() {
            assert_eq!(status.targets[0].state, TargetState::Exited);
            assert_eq!(status.targets[0].exit_code, Some(0));
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(25));
    }
    engine
        .start_fixture(
            &reviews,
            &owner,
            &review.review_id,
            "actual-basic-run".into(),
            book,
            targets,
            limits,
            persistence.clone(),
            options,
        )
        .unwrap();
    assert_eq!(fs::read_to_string(output).unwrap(), "1");
    assert_eq!(proxy.requests.lock().unwrap().len(), 1);
    assert!(proxy.requests.lock().unwrap()[0].1);
    let metadata = serde_json::to_string(
        &engine
            .status(&owner, "actual-basic-run", persistence.as_ref())
            .unwrap(),
    )
    .unwrap();
    assert!(!metadata.contains("fixture-password") && !metadata.contains("AppendAllText"));
    engine.close_window(&owner);
    broker.close_window(&owner);
    crate::ssh_window_lifecycle::close(&owner);
}
