//! Explicitly invoked disposable multi-hop acceptance, never the owner's sshd.
use super::*;
use std::{
    net::{TcpListener, TcpStream},
    process::{Child, Command, Output, Stdio},
    time::{Duration, Instant},
};

#[path = "ssh_group_native_tests.rs"]
mod group_tests;
#[path = "ssh_http_proxy_acceptance_tests.rs"]
mod http_proxy_tests;

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn bounded(command: &mut Command) -> Output {
    bounded_input(command, None)
}

fn bounded_input(command: &mut Command, input: Option<&[u8]>) -> Output {
    let mut child = hidden(command)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(input) = input {
        child.stdin.take().unwrap().write_all(input).unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(25);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Disposable SSH operation timed out");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    child.wait_with_output().unwrap()
}

pub(crate) struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(crate) fn key(root: &Path, name: &str) -> PathBuf {
    let path = root.join(name);
    let output = bounded(
        Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-f"])
            .arg(&path),
    );
    assert!(output.status.success(), "Disposable key generation failed");
    path
}

fn port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
pub(crate) fn config_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub(crate) fn server(
    root: &Path,
    index: usize,
    client: &Path,
    host_key: &Path,
    user: &str,
) -> (Server, u16, PathBuf) {
    let port = port();
    let config = root.join(format!("server-{index}.conf"));
    let known = root.join(format!("known-{index}"));
    fs::write(&config, format!("Port {port}\nListenAddress 127.0.0.1\nPidFile {}\nHostKey {}\nAuthorizedKeysFile {}.pub\nStrictModes no\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitEmptyPasswords no\nAllowUsers {user}\nAllowTcpForwarding yes\nAcceptEnv BYCODA_PS_FIXTURE\nSubsystem sftp internal-sftp\nLogLevel ERROR\n", config_path(&root.join(format!("server-{index}.pid"))), config_path(host_key), config_path(client))).unwrap();
    let public = fs::read_to_string(host_key.with_extension("pub")).unwrap();
    fs::write(&known, format!("[127.0.0.1]:{port} {public}")).unwrap();
    let log = fs::File::create(root.join(format!("server-{index}.log"))).unwrap();
    #[cfg(windows)]
    let daemon =
        PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/OpenSSH/sshd.exe");
    #[cfg(not(windows))]
    let daemon = PathBuf::from("/usr/sbin/sshd");
    let mut command = Command::new(daemon);
    command
        .args(["-D", "-e", "-f"])
        .arg(&config)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log);
    let mut server = Server(hidden(&mut command).spawn().unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(
            server.0.try_wait().unwrap().is_none(),
            "Disposable sshd exited; inspect own fixture server log"
        );
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        assert!(Instant::now() < deadline, "Disposable sshd was not ready");
        std::thread::sleep(Duration::from_millis(30));
    }
    (server, port, known)
}

#[test]
#[ignore = "Starts three isolated loopback sshd children with generated fixture keys; requires existing sshd"]
fn real_two_hop_independent_identity_and_changed_host_rejection() {
    let base = PathBuf::from(
        std::env::var("BYCODA_JUMP_FIXTURE_ROOT").expect("Set ignored fixture output directory"),
    );
    assert!(
        base.is_absolute()
            && base
                .to_string_lossy()
                .replace('\\', "/")
                .contains("/temp/verification/")
    );
    let root = base.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap();
    let clients: Vec<_> = (0..3).map(|i| key(&root, &format!("client-{i}"))).collect();
    let hosts: Vec<_> = (0..3).map(|i| key(&root, &format!("host-{i}"))).collect();
    let mut servers = Vec::new();
    let mut ports = Vec::new();
    let mut known = Vec::new();
    for i in 0..3 {
        let (server, port, trust) = server(&root, i, &clients[i], &hosts[i], &user);
        servers.push(server);
        ports.push(port);
        known.push(trust);
    }
    let hops: Vec<_> = (0..2)
        .map(|i| SshJumpPolicy {
            host: "127.0.0.1".into(),
            user: Some(user.clone()),
            port: ports[i],
            identity_file: Some(config_path(&clients[i])),
            certificate_file: None,
            known_hosts_file: Some(config_path(&known[i])),
        })
        .collect();
    let run = |hops: &[SshJumpPolicy]| {
        let endpoint = crate::ssh_security::prepare_endpoint(crate::ssh_security::SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(user.clone()),
            port: ports[2],
            identity_file: Some(config_path(&clients[2])),
            jump_policies: hops.to_vec(),
            ..Default::default()
        })
        .unwrap();
        let production_args = crate::ssh_security::connection_args(&endpoint).unwrap();
        let mut command = Command::new("ssh");
        command
            .args([
                "-o",
                "BatchMode=yes",
                "-o",
                "IdentitiesOnly=yes",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
            ])
            .arg(format!("UserKnownHostsFile={}", config_path(&known[2])))
            .args(production_args)
            .args(["--", "127.0.0.1", "echo BYCODA_TWO_HOP_ACCEPTED"]);
        bounded(&mut command)
    };
    let success = run(&hops);
    assert!(
        success.status.success(),
        "{}",
        String::from_utf8_lossy(&success.stderr)
    );
    assert!(String::from_utf8_lossy(&success.stdout).contains("BYCODA_TWO_HOP_ACCEPTED"));
    let mut wrong = hops.clone();
    wrong[1].identity_file = Some(config_path(&clients[2]));
    let denied = run(&wrong);
    assert!(!denied.status.success());
    assert!(!String::from_utf8_lossy(&denied.stdout).contains("BYCODA_TWO_HOP_ACCEPTED"));
    let wrong_trust = root.join("changed-hop-known");
    fs::write(
        &wrong_trust,
        format!(
            "[127.0.0.1]:{} {}",
            ports[0],
            fs::read_to_string(hosts[2].with_extension("pub")).unwrap()
        ),
    )
    .unwrap();
    let mut changed = hops.clone();
    changed[0].known_hosts_file = Some(config_path(&wrong_trust));
    let denied = run(&changed);
    assert!(!denied.status.success());
    assert!(String::from_utf8_lossy(&denied.stderr).contains("HOST IDENTIFICATION HAS CHANGED"));

    let endpoint = crate::ssh_security::prepare_endpoint(crate::ssh_security::SshEndpoint {
        host: "127.0.0.1".into(),
        user: Some(user.clone()),
        port: ports[2],
        identity_file: Some(config_path(&clients[2])),
        jump_policies: hops,
        ..Default::default()
    })
    .unwrap();
    let payload = root.join("upload.txt");
    let remote = root.join("remote.txt");
    let downloaded = root.join("downloaded.txt");
    fs::write(&payload, "actual two-hop SFTP transfer — Unicode payload\n").unwrap();
    let batch = format!(
        "put \"{}\" \"{}\"\nget \"{}\" \"{}\"\nbye\n",
        config_path(&payload),
        config_path(&remote),
        config_path(&remote),
        config_path(&downloaded)
    );
    let mut sftp = Command::new("sftp");
    sftp.arg("-o")
        .arg(format!("UserKnownHostsFile={}", config_path(&known[2])))
        .args(crate::ssh_sftp::sftp_args(&endpoint).unwrap());
    let result = bounded_input(&mut sftp, Some(batch.as_bytes()));
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(fs::read(&payload).unwrap(), fs::read(&remote).unwrap());
    assert_eq!(fs::read(&payload).unwrap(), fs::read(&downloaded).unwrap());

    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let echo_port = listener.local_addr().unwrap().port();
    let local_port = port();
    let echo = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut bytes = [0; 15];
                    if let Err(error) = stream.read_exact(&mut bytes) {
                        if error.kind() == std::io::ErrorKind::UnexpectedEof {
                            continue;
                        }
                        panic!("Echo fixture read failed: {error}");
                    }
                    stream.write_all(&bytes).unwrap();
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        Instant::now() < deadline,
                        "Forward never reached echo service"
                    );
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(error) => panic!("Echo fixture failed: {error}"),
            }
        }
    });
    let mut args = vec![
        "-o".into(),
        format!("UserKnownHostsFile={}", config_path(&known[2])),
    ];
    args.extend(
        crate::ssh_forward::forward_args_kind(
            &endpoint,
            local_port,
            "127.0.0.1",
            echo_port,
            "local",
        )
        .unwrap(),
    );
    let identity = crate::ssh_security::stable_args(&endpoint, &args);
    let forwards = crate::ssh_forward::SshForwards::default();
    forwards.register_window("jump-fixture-owner").unwrap();
    let lease_path = endpoint
        .prepared_jump_config
        .as_ref()
        .unwrap()
        .path()
        .to_owned();
    let started = crate::ssh_forward::start_prepared(
        &forwards,
        "jump-fixture-owner",
        "two-hop-forward".into(),
        "two-hop-server".into(),
        local_port,
        "127.0.0.1".into(),
        echo_port,
        args,
        Some(identity),
        endpoint.prepared_jump_config.clone(),
        None,
    )
    .unwrap();
    assert_eq!(started.state, "running");
    drop(endpoint);
    assert!(lease_path.exists(), "Process lease must retain jump config");
    assert!(
        crate::ssh_forward::stop_owned(&forwards, "foreign-window", "two-hop-forward").is_err()
    );
    assert!(
        lease_path.exists(),
        "Foreign owner must not release running lease"
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut stream = loop {
        if let Ok(stream) = TcpStream::connect(("127.0.0.1", local_port)) {
            break stream;
        }
        assert!(Instant::now() < deadline, "Forward listener did not start");
        std::thread::sleep(Duration::from_millis(25));
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(b"BYCODA_TWO_HOPS").unwrap();
    let mut reply = [0; 15];
    stream.read_exact(&mut reply).unwrap();
    assert_eq!(&reply, b"BYCODA_TWO_HOPS");
    drop(stream);
    echo.join().unwrap();
    crate::ssh_forward::stop_owned(&forwards, "jump-fixture-owner", "two-hop-forward").unwrap();
    crate::ssh_window_lifecycle::close("jump-fixture-owner");
    assert!(
        !lease_path.exists(),
        "Final exited process lease must release jump config"
    );
    fs::write(root.join("result.txt"), "Production prepare_endpoint/connection_args accepted two distinct hop identities/trust stores and distinct target identity. Wrong second-hop identity: denied. Changed first-hop host key: denied. Production SFTP builder uploaded/downloaded matching Unicode payload over both hops. Production local-forward builder echoed bytes over both hops; config lease survived endpoint drop and was removed after process exit. All three owned sshd children stopped by RAII. No owner configuration or trust store was changed.\n").unwrap();
    drop(servers);
}
