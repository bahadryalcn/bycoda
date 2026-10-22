//! Disposable HTTP upstream acceptance through the canonical OpenSSH builder.
#[path = "ssh_http_proxy_credentials_acceptance_tests.rs"]
mod credentials_acceptance;
#[path = "ssh_https_proxy_acceptance_tests.rs"]
mod https_acceptance;
#[path = "ssh_runbook_proxy_native_tests.rs"]
mod runbook_acceptance;
use super::*;
use crate::ssh_http_proxy::{
    BasicCredentials, HttpProxyEndpoint, HttpProxyFailure, HttpProxyLease, HttpProxyTarget,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

struct ProxyFixture {
    port: u16,
    requests: Arc<Mutex<Vec<(String, bool)>>>,
    stopped: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl ProxyFixture {
    fn start(target_port: u16, require_auth: bool) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let thread = std::thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                let (mut local, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(error) => panic!("Owned proxy listener failed: {error}"),
                };
                local.set_nonblocking(false).unwrap();
                local
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut header = Vec::new();
                while !header.ends_with(b"\r\n\r\n") && header.len() < 16 * 1024 {
                    let mut byte = [0];
                    if local.read_exact(&mut byte).is_err() {
                        break;
                    }
                    header.push(byte[0]);
                }
                let text = String::from_utf8_lossy(&header);
                let authority = text
                    .lines()
                    .next()
                    .and_then(|line| line.strip_prefix("CONNECT "))
                    .and_then(|line| line.strip_suffix(" HTTP/1.1"))
                    .unwrap_or_default()
                    .to_owned();
                let authenticated = text.lines().any(|line| {
                    line.to_ascii_lowercase()
                        .starts_with("proxy-authorization: basic ")
                });
                recorded
                    .lock()
                    .unwrap()
                    .push((authority.clone(), authenticated));
                // Store only authority/auth-presence, never authorization bytes.
                drop(text);
                header.fill(0);
                if authority != format!("127.0.0.1:{target_port}") {
                    local
                        .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                        .unwrap();
                    continue;
                }
                if require_auth && !authenticated {
                    local.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=fixture\r\nContent-Length: 0\r\n\r\n").unwrap();
                    continue;
                }
                let mut remote = TcpStream::connect(("127.0.0.1", target_port)).unwrap();
                local
                    .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    .unwrap();
                local.set_read_timeout(None).unwrap();
                let mut local_read = local.try_clone().unwrap();
                let mut remote_write = remote.try_clone().unwrap();
                let upload = std::thread::spawn(move || {
                    let _ = std::io::copy(&mut local_read, &mut remote_write);
                    let _ = remote_write.shutdown(std::net::Shutdown::Write);
                });
                let _ = std::io::copy(&mut remote, &mut local);
                let _ = local.shutdown(std::net::Shutdown::Write);
                let _ = upload.join();
            }
        });
        Self {
            port,
            requests,
            stopped,
            thread: Some(thread),
        }
    }
    fn endpoint(&self) -> HttpProxyEndpoint {
        HttpProxyEndpoint {
            scheme: Default::default(),
            host: "127.0.0.1".into(),
            port: self.port,
        }
    }
}
impl Drop for ProxyFixture {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

fn helper_path() -> PathBuf {
    let name = if cfg!(windows) {
        "bycoda.exe"
    } else {
        "bycoda"
    };
    let path = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(name);
    assert!(
        path.is_file(),
        "Build the existing debug application executable for its headless HTTP helper entry point"
    );
    let base = PathBuf::from(
        std::env::var("BYCODA_JUMP_FIXTURE_ROOT")
            .expect("Set the ignored fixture output directory"),
    );
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let directory = base.join(format!("helper-artifact-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&directory).unwrap();
    let artifact = directory.join(if cfg!(windows) {
        "helper with spaces.exe"
    } else {
        "helper with spaces"
    });
    fs::hard_link(&path, &artifact).expect("Create an owned same-volume helper artifact hardlink");
    artifact
}

fn configure(command: &mut Command, lease: &HttpProxyLease, mut args: Vec<String>, helper: &Path) {
    // The libtest executable lacks main's headless dispatch. Override only the
    // fixed helper artifact path; every other production option stays unchanged.
    let option = args
        .iter_mut()
        .find(|arg| arg.starts_with("ProxyCommand="))
        .unwrap();
    *option = format!("ProxyCommand={}", lease.proxy_command(helper).unwrap());
    command.args(args).envs(lease.environment());
}

#[test]
#[ignore = "Uses built debug application's headless HTTP helper and an owned loopback HTTP mock"]
fn actual_headless_http_helper_flushes_binary_without_newline() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let proxy_port = listener.local_addr().unwrap().port();
    let peer = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") && headers.len() < 16 * 1024 {
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            headers.push(byte[0]);
        }
        assert!(headers.starts_with(b"CONNECT 127.0.0.1:2200 HTTP/1.1\r\n"));
        stream
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n\x00\x01\xff\x08")
            .unwrap();
        // The helper must flush before this peer sends EOF or a newline.
        let mut reply = [0];
        stream.read_exact(&mut reply).unwrap();
        assert_eq!(reply, [0x42]);
    });
    let lease = HttpProxyLease::start(
        HttpProxyEndpoint {
            scheme: Default::default(),
            host: "127.0.0.1".into(),
            port: proxy_port,
        },
        HttpProxyTarget {
            host: "127.0.0.1".into(),
            port: 2200,
        },
        None,
    )
    .unwrap();
    let mut command = Command::new(helper_path());
    command
        .arg("ssh-http-proxy")
        .envs(lease.environment())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = Server(hidden(&mut command).spawn().unwrap());
    let mut output = child.0.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut bytes = [0; 4];
        let result = output.read_exact(&mut bytes).map(|_| bytes);
        let _ = tx.send(result);
    });
    let bytes = rx
        .recv_timeout(Duration::from_secs(2))
        .expect("Headless helper did not flush non-newline binary bytes within two seconds")
        .unwrap();
    assert_eq!(bytes, [0, 1, 255, 8]);
    child.0.stdin.take().unwrap().write_all(&[0x42]).unwrap();
    reader.join().unwrap();
    peer.join().unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while child.0.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(child.0.wait().unwrap().success());
}

#[test]
#[ignore = "Requires existing sshd plus a freshly built bycoda debug binary; uses only owned loopback fixtures"]
fn actual_http_connect_ssh_sftp_auth_rejection_and_target_binding() {
    let base = PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("http-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap();
    let client = key(&root, "client");
    let host = key(&root, "host");
    let (_daemon, target_port, trust) = server(&root, 0, &client, &host, &user);
    let helper = helper_path();
    let endpoint = |proxy: &ProxyFixture| {
        crate::ssh_security::prepare_endpoint(crate::ssh_security::SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(user.clone()),
            port: target_port,
            identity_file: Some(config_path(&client)),
            http_proxy: Some(proxy.endpoint()),
            ..Default::default()
        })
        .unwrap()
    };
    let ssh = |target: &crate::ssh_security::SshEndpoint, lease: &HttpProxyLease| {
        let mut command = Command::new("ssh");
        command
            .args(["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o"])
            .arg(format!("UserKnownHostsFile={}", config_path(&trust)));
        configure(
            &mut command,
            lease,
            crate::ssh_security::connection_args(target).unwrap(),
            &helper,
        );
        command.args(["--", "127.0.0.1", "echo BYCODA_HTTP_ACCEPTED"]);
        bounded(&mut command)
    };

    let proxy = ProxyFixture::start(target_port, false);
    let target = endpoint(&proxy);
    let lease = crate::ssh_security::start_http_proxy(&target)
        .unwrap()
        .unwrap();
    let result = ssh(&target, &lease);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(String::from_utf8_lossy(&result.stdout).contains("BYCODA_HTTP_ACCEPTED"));
    assert_eq!(
        proxy.requests.lock().unwrap().as_slice(),
        &[(format!("127.0.0.1:{target_port}"), false)]
    );
    drop(lease);
    drop(target);
    drop(proxy);

    let proxy = ProxyFixture::start(target_port, true);
    let target = endpoint(&proxy);
    let lease = crate::ssh_security::start_http_proxy(&target)
        .unwrap()
        .unwrap();
    let result = ssh(&target, &lease);
    assert!(!result.status.success());
    assert_eq!(
        proxy.requests.lock().unwrap().len(),
        1,
        "407 must not trigger credential replay or authentication retry"
    );
    assert_eq!(lease.failure(), Some(HttpProxyFailure::Rejected(407)));
    drop(lease);
    drop(target);
    drop(proxy);

    let proxy = ProxyFixture::start(target_port, true);
    let target = endpoint(&proxy);
    let lease = HttpProxyLease::start(
        proxy.endpoint(),
        HttpProxyTarget {
            host: "127.0.0.1".into(),
            port: target_port,
        },
        Some(
            BasicCredentials::approved_plain_http("fixture-user", "fixture-password", true)
                .unwrap(),
        ),
    )
    .unwrap();
    let result = ssh(&target, &lease);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(
        proxy.requests.lock().unwrap().as_slice(),
        &[(format!("127.0.0.1:{target_port}"), true)]
    );
    drop(lease);
    drop(target);
    drop(proxy);

    let proxy = ProxyFixture::start(target_port, false);
    let target = endpoint(&proxy);
    let lease = crate::ssh_security::start_http_proxy(&target)
        .unwrap()
        .unwrap();
    assert!(!lease.matches(
        &proxy.endpoint(),
        &HttpProxyTarget {
            host: "attacker.example".into(),
            port: 1
        }
    ));
    let mut helper_probe = Command::new(&helper);
    helper_probe
        .args(["ssh-http-proxy", "attacker.example:1"])
        .envs(lease.environment());
    let _ = bounded(&mut helper_probe);
    assert_eq!(
        proxy.requests.lock().unwrap().as_slice(),
        &[(format!("127.0.0.1:{target_port}"), false)],
        "Helper arguments must not change its lease-bound CONNECT authority"
    );
    drop(lease);
    drop(target);
    drop(proxy);

    let proxy = ProxyFixture::start(target_port, false);
    let target = endpoint(&proxy);
    let input = root.join("upload.txt");
    let remote = root.join("remote.txt");
    let output = root.join("download.txt");
    fs::write(&input, "HTTP upstream SFTP — Unicode\n").unwrap();
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
        let lease = crate::ssh_security::start_http_proxy(&target)
            .unwrap()
            .unwrap();
        let mut command = Command::new("sftp");
        command
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", config_path(&trust)));
        configure(
            &mut command,
            &lease,
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
    assert_eq!(
        proxy.requests.lock().unwrap().len(),
        2,
        "Each SFTP child must use a fresh process lease"
    );
    drop(target);
    drop(proxy);
    let proxy = ProxyFixture::start(target_port, false);
    let target = endpoint(&proxy);
    let echo_listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    echo_listener.set_nonblocking(true).unwrap();
    let echo_port = echo_listener.local_addr().unwrap().port();
    let echo = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match echo_listener.accept() {
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
                        panic!("HTTP forward echo read failed: {error}");
                    }
                    stream.write_all(&bytes).unwrap();
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(error) => panic!("HTTP forward echo accept failed: {error}"),
            }
        }
    });
    let local_port = port();
    let lease = crate::ssh_security::start_http_proxy(&target)
        .unwrap()
        .unwrap();
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
        .unwrap() = format!("ProxyCommand={}", lease.proxy_command(&helper).unwrap());
    let identity = crate::ssh_security::stable_args(&target, &args);
    let forwards = crate::ssh_forward::SshForwards::default();
    forwards.register_window("http-owner").unwrap();
    let status = crate::ssh_forward::start_prepared(
        &forwards,
        "http-owner",
        "http-forward".into(),
        "http-target".into(),
        local_port,
        "127.0.0.1".into(),
        echo_port,
        args,
        Some(identity),
        None,
        Some(lease.clone()),
    )
    .unwrap();
    assert_eq!(status.state, "running");
    drop(lease);
    drop(target);
    assert!(crate::ssh_forward::stop_owned(&forwards, "foreign-window", "http-forward").is_err());
    let mut stream = TcpStream::connect(("127.0.0.1", local_port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(b"BYCODA_VIA_HTTP").unwrap();
    let mut reply = [0; 15];
    stream.read_exact(&mut reply).unwrap();
    assert_eq!(&reply, b"BYCODA_VIA_HTTP");
    drop(stream);
    echo.join().unwrap();
    crate::ssh_forward::stop_owned(&forwards, "http-owner", "http-forward").unwrap();
    crate::ssh_window_lifecycle::close("http-owner");
    assert_eq!(proxy.requests.lock().unwrap().len(), 1);
    drop(forwards);
    drop(proxy);
    fs::write(root.join("result.txt"), "Canonical SSH via HTTP CONNECT accepted. 407 rejected with one upstream attempt and no credential replay. Explicit ephemeral Basic credential lease accepted. Arbitrary helper target arguments cannot change lease-bound CONNECT authority. Canonical SFTP transferred matching Unicode payload across two fresh process leases. Test overrides only helper artifact path to the existing debug application's headless dispatch. No owner service/config/permission/key was changed.\n").unwrap();
}
