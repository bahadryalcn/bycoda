//! Canonical OpenSSH consumers over an owned verified HTTPS CONNECT fixture.
use super::*;
use crate::ssh_http_proxy::https_native_tests::OwnedTlsProxy;

#[test]
#[ignore = "Owned sshd, TLS CA/proxy, existing Git OpenSSL and debug headless helper"]
fn actual_https_canonical_ssh_sftp_forward_and_auth_rejection() {
    let base = PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("https-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap();
    let client = key(&root, "client");
    let host = key(&root, "host");
    let (_daemon, target_port, trust) = server(&root, 0, &client, &host, &user);
    let proxy = OwnedTlsProxy::start(target_port, true);
    let helper = helper_path();
    let target = crate::ssh_security::prepare_endpoint(crate::ssh_security::SshEndpoint {
        host: "127.0.0.1".into(),
        user: Some(user),
        port: target_port,
        identity_file: Some(config_path(&client)),
        http_proxy: Some(proxy.endpoint()),
        ..Default::default()
    })
    .unwrap();
    let lease = |basic: bool| {
        HttpProxyLease::start_with_test_tls_config(
            proxy.endpoint(),
            HttpProxyTarget {
                host: target.host.clone(),
                port: target.port,
            },
            basic.then(|| {
                BasicCredentials::approved_plain_http("fixture-user", "fixture-pass", true).unwrap()
            }),
            proxy.client_config(),
        )
        .unwrap()
    };
    let run_ssh = |lease: &HttpProxyLease| {
        let mut command = Command::new("ssh");
        command
            .args(["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o"])
            .arg(format!("UserKnownHostsFile={}", config_path(&trust)));
        configure(
            &mut command,
            lease,
            crate::ssh_security::connection_args(&target).unwrap(),
            &helper,
        );
        command.args(["--", "127.0.0.1", "echo BYCODA_HTTPS_ACCEPTED"]);
        bounded(&mut command)
    };
    let rejected = lease(false);
    let output = run_ssh(&rejected);
    assert!(!output.status.success());
    assert_eq!(proxy.requests.lock().unwrap().as_slice(), &[false]);
    drop(rejected);
    let approved = lease(true);
    let output = run_ssh(&approved);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("BYCODA_HTTPS_ACCEPTED"));
    drop(approved);
    let input = root.join("upload.txt");
    let remote = root.join("remote.txt");
    let output = root.join("download.txt");
    fs::write(&input, "HTTPS SFTP — Unicode\n").unwrap();
    for batch in [
        format!(
            "put \"{}\" \"{}\"\nbye\n",
            config_path(&input),
            config_path(&remote)
        ),
        format!(
            "get \"{}\" \"{}\"\nbye\n",
            config_path(&remote),
            config_path(&output)
        ),
    ] {
        let approved = lease(true);
        let mut command = Command::new("sftp");
        command
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", config_path(&trust)));
        configure(
            &mut command,
            &approved,
            crate::ssh_sftp::sftp_args(&target).unwrap(),
            &helper,
        );
        let result = bounded_input(&mut command, Some(batch.as_bytes()));
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    assert_eq!(fs::read(input).unwrap(), fs::read(output).unwrap());
    let echo_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let echo_port = echo_listener.local_addr().unwrap().port();
    echo_listener.set_nonblocking(true).unwrap();
    let echo = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match echo_listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut bytes = [0; 4];
                    if stream.read_exact(&mut bytes).is_err() {
                        continue;
                    }
                    stream.write_all(&bytes).unwrap();
                    return;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(e) => panic!("{e}"),
            }
        }
    });
    let local_port = port();
    let approved = Arc::new(lease(true));
    let mut args = vec![
        "-o".into(),
        format!("UserKnownHostsFile={}", config_path(&trust)),
    ];
    args.extend(
        crate::ssh_forward::forward_args_kind(&target, local_port, "127.0.0.1", echo_port, "local")
            .unwrap(),
    );
    *args
        .iter_mut()
        .find(|arg| arg.starts_with("ProxyCommand="))
        .unwrap() = format!("ProxyCommand={}", approved.proxy_command(&helper).unwrap());
    let identity = crate::ssh_security::stable_args(&target, &args);
    let forwards = crate::ssh_forward::SshForwards::default();
    forwards.register_window("https-owner").unwrap();
    let status = crate::ssh_forward::start_prepared(
        &forwards,
        "https-owner",
        "https-forward".into(),
        "https-target".into(),
        local_port,
        "127.0.0.1".into(),
        echo_port,
        args,
        Some(identity),
        None,
        Some(approved.clone()),
    )
    .unwrap();
    assert_eq!(status.state, "running");
    drop(approved);
    assert!(crate::ssh_forward::stop_owned(&forwards, "foreign", "https-forward").is_err());
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(b"ping").unwrap();
    let mut pong = [0; 4];
    stream.read_exact(&mut pong).unwrap();
    assert_eq!(&pong, b"ping");
    drop(stream);
    echo.join().unwrap();
    crate::ssh_forward::stop_owned(&forwards, "https-owner", "https-forward").unwrap();
    assert_eq!(
        proxy.requests.lock().unwrap().as_slice(),
        &[false, true, true, true, true],
        "one TLS CONNECT per operation/child; no 407 fallback or credential replay"
    );
    drop(proxy);
    drop(_daemon);
}
