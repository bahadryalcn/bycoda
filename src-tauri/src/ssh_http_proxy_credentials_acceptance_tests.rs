//! Broker acceptance through the existing canonical relay and disposable SSH fixture.
use super::*;
use crate::ssh_http_proxy_credentials::{HttpProxyCredentials, ProxyOperation};

#[test]
#[ignore = "Uses built headless helper and disposable generated-key sshd; no app store"]
fn actual_basic_broker_binds_operation_and_fresh_sftp_children() {
    let base = PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("broker-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME").unwrap();
    let client = key(&root, "client");
    let host = key(&root, "host");
    let (_daemon, target_port, trust) = server(&root, 0, &client, &host, &user);
    let proxy = ProxyFixture::start(target_port, true);
    let endpoint = crate::ssh_security::prepare_endpoint(crate::ssh_security::SshEndpoint {
        host: "127.0.0.1".into(),
        user: Some(user),
        port: target_port,
        identity_file: Some(config_path(&client)),
        http_proxy: Some(proxy.endpoint()),
        ..Default::default()
    })
    .unwrap();
    let helper = helper_path();
    let broker = HttpProxyCredentials::default();
    let owner_id = format!("broker-fixture-{}", uuid::Uuid::new_v4());
    let owner = owner_id.as_str();
    crate::ssh_window_lifecycle::register(owner).unwrap();
    let input = root.join("upload.txt");
    let remote = root.join("remote.txt");
    fs::write(&input, "Broker SFTP — Unicode İ🙂\n").unwrap();
    let operation = ProxyOperation::SftpUpload {
        operation_id: "upload-one".into(),
        local_path: config_path(&input),
        remote_path: config_path(&remote),
        overwrite_confirmed: false,
    };
    let approve = |operation: &ProxyOperation| {
        broker
            .approve(
                owner,
                Some("canonical-target"),
                &endpoint,
                &endpoint,
                operation,
                BasicCredentials::approved_plain_http("fixture-user", "fixture-password", true)
                    .unwrap(),
            )
            .unwrap()
    };
    let approval = approve(&operation);
    assert!(broker
        .consume(
            "foreign-window",
            &approval.ticket_id,
            Some("canonical-target"),
            &endpoint,
            &operation
        )
        .is_err());
    let grant = broker
        .consume(
            owner,
            &approval.ticket_id,
            Some("canonical-target"),
            &endpoint,
            &operation,
        )
        .unwrap();
    assert!(broker
        .consume(
            owner,
            &approval.ticket_id,
            Some("canonical-target"),
            &endpoint,
            &operation
        )
        .is_err());
    // One upload operation owns a metadata child and a transfer child. Each gets
    // a fresh relay, rather than replaying the child's single-use capability.
    for batch in [
        "pwd\nbye\n".to_owned(),
        format!(
            "put \"{}\" \"{}\"\nbye\n",
            config_path(&input),
            config_path(&remote)
        ),
    ] {
        let lease = crate::ssh_security::start_http_proxy_authorized(&endpoint, Some(&grant))
            .unwrap()
            .unwrap();
        let mut command = Command::new("sftp");
        command
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", config_path(&trust)));
        configure(
            &mut command,
            &lease,
            crate::ssh_sftp::sftp_args(&endpoint).unwrap(),
            &helper,
        );
        let output = bounded_input(&mut command, Some(batch.as_bytes()));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert_eq!(fs::read(&input).unwrap(), fs::read(&remote).unwrap());
    assert_eq!(proxy.requests.lock().unwrap().len(), 2);

    let terminal = ProxyOperation::Terminal {
        id: "terminal-one".into(),
        shell_integration: None,
    };
    let approval = approve(&terminal);
    let terminal_grant = broker
        .consume(
            owner,
            &approval.ticket_id,
            Some("canonical-target"),
            &endpoint,
            &terminal,
        )
        .unwrap();
    let lease = crate::ssh_security::start_http_proxy_authorized(&endpoint, Some(&terminal_grant))
        .unwrap()
        .unwrap();
    let mut command = Command::new("ssh");
    command
        .args(["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o"])
        .arg(format!("UserKnownHostsFile={}", config_path(&trust)));
    configure(
        &mut command,
        &lease,
        crate::ssh_security::connection_args(&endpoint).unwrap(),
        &helper,
    );
    command.args(["--", "127.0.0.1", "echo BYCODA_BROKER_ACCEPTED"]);
    let output = bounded(&mut command);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("BYCODA_BROKER_ACCEPTED"));
    drop(lease);
    assert_eq!(proxy.requests.lock().unwrap().len(), 3);

    let approval = approve(&operation);
    assert!(broker
        .consume(
            owner,
            &approval.ticket_id,
            Some("canonical-target"),
            &endpoint,
            &terminal
        )
        .is_err());
    let approval = approve(&operation);
    let wrong_path = ProxyOperation::SftpUpload {
        operation_id: "upload-one".into(),
        local_path: config_path(&input),
        remote_path: config_path(&root.join("different.txt")),
        overwrite_confirmed: false,
    };
    assert!(broker
        .consume(
            owner,
            &approval.ticket_id,
            Some("canonical-target"),
            &endpoint,
            &wrong_path
        )
        .is_err());
    let mut changed = endpoint.clone();
    changed.port = if target_port == 65535 {
        65534
    } else {
        target_port + 1
    };
    let mut changed_proxy = endpoint.clone();
    changed_proxy.http_proxy.as_mut().unwrap().port = if proxy.port == 65535 {
        65534
    } else {
        proxy.port + 1
    };
    assert!(broker
        .approve(
            owner,
            Some("canonical-target"),
            &changed_proxy,
            &endpoint,
            &operation,
            BasicCredentials::approved_plain_http("fixture-user", "fixture-password", true)
                .unwrap()
        )
        .is_err());
    let approval = approve(&operation);
    assert!(broker
        .consume(
            owner,
            &approval.ticket_id,
            Some("canonical-target"),
            &changed,
            &operation
        )
        .is_err());
    assert!(crate::ssh_security::start_http_proxy_authorized(&changed, Some(&grant)).is_err());
    crate::ssh_window_lifecycle::close(owner);
    broker.close_window(owner);
    assert!(crate::ssh_security::start_http_proxy_authorized(&endpoint, Some(&grant)).is_err());
    assert!(
        crate::ssh_security::start_http_proxy_authorized(&endpoint, Some(&terminal_grant)).is_err()
    );
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(
        proxy.requests.lock().unwrap().len(),
        3,
        "Rejected bindings must create zero additional upstream contacts"
    );
    assert!(proxy
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, authenticated)| *authenticated));
}
