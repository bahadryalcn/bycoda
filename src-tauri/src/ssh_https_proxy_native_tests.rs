//! Owned local TLS only. No system trust, network services or owner keys are used.
use super::*;
use ureq::rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};

struct Certificates(std::path::PathBuf);
impl Drop for Certificates {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
impl Certificates {
    fn generate() -> Self {
        let directory =
            std::env::temp_dir().join(format!("bycoda-owned-https-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let fixture = Self(directory);
        #[cfg(windows)]
        let executable = "C:/Program Files/Git/usr/bin/openssl.exe";
        #[cfg(not(windows))]
        let executable = "openssl";
        for args in [
            vec![
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                "ca.key",
                "-out",
                "ca.pem",
                "-days",
                "1",
                "-subj",
                "/CN=bycoda-owned-fixture-CA",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
            ],
            vec![
                "req",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                "server.key",
                "-out",
                "server.csr",
                "-subj",
                "/CN=localhost",
            ],
            vec![
                "x509",
                "-req",
                "-in",
                "server.csr",
                "-CA",
                "ca.pem",
                "-CAkey",
                "ca.key",
                "-CAcreateserial",
                "-out",
                "server.pem",
                "-days",
                "1",
                "-extfile",
                "extensions",
            ],
            vec!["x509", "-in", "ca.pem", "-outform", "DER", "-out", "ca.der"],
            vec![
                "x509",
                "-in",
                "server.pem",
                "-outform",
                "DER",
                "-out",
                "server.der",
            ],
            vec![
                "pkcs8",
                "-topk8",
                "-nocrypt",
                "-in",
                "server.key",
                "-outform",
                "DER",
                "-out",
                "server.der.key",
            ],
        ] {
            std::fs::write(fixture.0.join("extensions"), "subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n").unwrap();
            let mut command = std::process::Command::new(executable);
            command
                .args(args)
                .current_dir(&fixture.0)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            assert!(command
                .status()
                .expect("existing OpenSSL fixture tool required")
                .success());
        }
        fixture
    }
    fn server(&self) -> Arc<ServerConfig> {
        Arc::new(
            ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(
                    vec![CertificateDer::from(
                        std::fs::read(self.0.join("server.der")).unwrap(),
                    )],
                    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
                        std::fs::read(self.0.join("server.der.key")).unwrap(),
                    )),
                )
                .unwrap(),
        )
    }
    fn client(&self) -> Arc<ureq::rustls::ClientConfig> {
        let mut roots = ureq::rustls::RootCertStore::empty();
        roots
            .add(CertificateDer::from(
                std::fs::read(self.0.join("ca.der")).unwrap(),
            ))
            .unwrap();
        Arc::new(
            ureq::rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        )
    }
}
fn new_state(credentials: bool) -> Arc<State> {
    Arc::new(State {
        stopped: AtomicBool::new(false),
        streams: Mutex::new(Vec::new()),
        failure: Mutex::new(None),
        credentials: Mutex::new(credentials.then(|| {
            BasicCredentials::approved_plain_http("fixture-user", "fixture-pass", true).unwrap()
        })),
    })
}
fn server(
    config: Arc<ServerConfig>,
    echo: bool,
) -> (
    u16,
    std::sync::mpsc::Receiver<Vec<u8>>,
    std::thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (send, receive) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(6)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(6)))
            .unwrap();
        let mut stream = StreamOwned::new(ServerConnection::new(config).unwrap(), socket);
        let mut request = Vec::new();
        let mut byte = [0];
        loop {
            if stream.read_exact(&mut byte).is_err() {
                let _ = send.send(request);
                return;
            }
            request.push(byte[0]);
            if request.ends_with(b"\r\n\r\n") {
                break;
            }
            assert!(request.len() <= MAX_HEADER);
        }
        send.send(request).unwrap();
        stream.write_all(b"HTTP/1.1 200 OK\r\n\r\n").unwrap();
        stream.flush().unwrap();
        if echo {
            stream.write_all(b"SSH-2.0-owned-tls\r\n").unwrap();
            stream.flush().unwrap();
            let mut ping = [0; 4];
            stream.read_exact(&mut ping).unwrap();
            assert_eq!(&ping, b"ping");
            stream.write_all(b"pong").unwrap();
            stream.flush().unwrap();
            let mut tail = Vec::new();
            stream.read_to_end(&mut tail).unwrap();
            assert!(tail.is_empty());
            stream.write_all(b"tail").unwrap();
            stream.conn.send_close_notify();
            stream.flush().unwrap();
        }
    });
    (port, receive, thread)
}

#[test]
#[ignore = "owned TLS fixture uses existing OpenSSL binary; run explicitly"]
fn owned_https_verification_basic_duplex_halfclose_and_cancel() {
    let certificates = Certificates::generate();
    // Only this cfg(test) call injects a private root; production always uses Mozilla roots.
    let (port, receive, server_thread) = server(certificates.server(), true);
    let proxy = HttpProxyEndpoint {
        host: "localhost".into(),
        port,
        scheme: HttpProxyScheme::Https,
    };
    let state = new_state(true);
    let upstream = connect_tunnel_with_config(
        &proxy,
        &HttpProxyTarget {
            host: "fixed-target.example".into(),
            port: 22,
        },
        &state,
        certificates.client(),
    )
    .unwrap();
    let request = String::from_utf8(receive.recv_timeout(Duration::from_secs(2)).unwrap()).unwrap();
    assert!(request.starts_with("CONNECT fixed-target.example:22 HTTP/1.1\r\n"));
    assert!(request.contains("Proxy-Authorization: Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzcw=="));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut local = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    local
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let (relay, _) = listener.accept().unwrap();
    state.track(&relay).unwrap();
    let relay_state = state.clone();
    let relay_thread = std::thread::spawn(move || match upstream {
        Upstream::Tls(tls) => relay_tls(relay, *tls, &relay_state),
        _ => panic!(),
    });
    let mut banner = [0; 19];
    local.read_exact(&mut banner).unwrap();
    assert_eq!(&banner, b"SSH-2.0-owned-tls\r\n");
    local.write_all(b"ping").unwrap();
    let mut pong = [0; 4];
    local.read_exact(&mut pong).unwrap();
    assert_eq!(&pong, b"pong");
    local.shutdown(Shutdown::Write).unwrap();
    let mut tail = Vec::new();
    local.read_to_end(&mut tail).unwrap();
    assert_eq!(tail, b"tail");
    assert!(relay_thread.join().unwrap().is_ok());
    server_thread.join().unwrap();
    state.stop();

    for (host, config) in [
        ("localhost", verified_tls_config()),
        ("127.0.0.1", certificates.client()),
    ] {
        let (port, receive, server_thread) = server(certificates.server(), false);
        let state = new_state(true);
        let result = connect_tunnel_with_config(
            &HttpProxyEndpoint {
                host: host.into(),
                port,
                scheme: HttpProxyScheme::Https,
            },
            &HttpProxyTarget {
                host: "fixed-target.example".into(),
                port: 22,
            },
            &state,
            config,
        );
        assert!(result.is_err());
        assert!(
            state.credentials.lock().unwrap().is_some(),
            "no Basic consumed before TLS verification"
        );
        state.stop();
        assert!(receive
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .is_empty());
        server_thread.join().unwrap();
    }
    // A peer that never finishes TLS is bounded by the same overall setup deadline.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = new_state(false);
    let cancelled = state.clone();
    let worker = std::thread::spawn(move || {
        connect_tunnel_with_config(
            &HttpProxyEndpoint {
                host: "localhost".into(),
                port,
                scheme: HttpProxyScheme::Https,
            },
            &HttpProxyTarget {
                host: "fixed-target.example".into(),
                port: 22,
            },
            &cancelled,
            verified_tls_config(),
        )
        .err()
    });
    let (_socket, _) = listener.accept().unwrap();
    let start = Instant::now();
    state.stop();
    assert_eq!(worker.join().unwrap(), Some(HttpProxyFailure::Cancelled));
    assert!(start.elapsed() < Duration::from_secs(1));
}

pub(crate) struct OwnedTlsProxy {
    pub(crate) port: u16,
    pub(crate) requests: Arc<Mutex<Vec<bool>>>,
    stopped: Arc<AtomicBool>,
    states: Arc<Mutex<Vec<Arc<State>>>>,
    thread: Option<std::thread::JoinHandle<()>>,
    certificates: Certificates,
}
impl OwnedTlsProxy {
    pub(crate) fn start(target_port: u16, require_auth: bool) -> Self {
        let certificates = Certificates::generate();
        let config = certificates.server();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let stopped = Arc::new(AtomicBool::new(false));
        let states = Arc::new(Mutex::new(Vec::<Arc<State>>::new()));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = stopped.clone();
        let worker_states = states.clone();
        let observed = requests.clone();
        let thread = std::thread::spawn(move || {
            let mut workers = Vec::new();
            while !stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((socket, _)) => {
                        let state = new_state(false);
                        state.track(&socket).unwrap();
                        worker_states.lock().unwrap().push(state.clone());
                        let config = config.clone();
                        let observed = observed.clone();
                        workers.push(std::thread::spawn(move || {
                            socket.set_nonblocking(false).unwrap();socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();socket.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
                            let mut tls=StreamOwned::new(ServerConnection::new(config).unwrap(),socket);
                            let mut request=Vec::new();let mut byte=[0];
                            while !request.ends_with(b"\r\n\r\n") && request.len()<MAX_HEADER {
                                if tls.read_exact(&mut byte).is_err() { return; }request.push(byte[0]);
                            }
                            assert!(request.starts_with(format!("CONNECT 127.0.0.1:{target_port} HTTP/1.1\r\n").as_bytes()));
                            let basic=request.windows(b"Proxy-Authorization: Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzcw==".len()).any(|w|w==b"Proxy-Authorization: Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzcw==");
                            observed.lock().unwrap().push(basic);
                            if require_auth && !basic {let _=tls.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");let _=tls.flush();return;}
                            let backend=TcpStream::connect(("127.0.0.1",target_port)).unwrap();state.track(&backend).unwrap();
                            if tls.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").and_then(|_|tls.flush()).is_err(){return;}
                            let _=relay_tls_connection(backend,tls.sock,ureq::rustls::Connection::Server(tls.conn),&state);
                        }));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(e) => panic!("owned TLS accept: {e}"),
                }
            }
            for state in worker_states.lock().unwrap().iter() {
                state.stop();
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        Self {
            port,
            requests,
            stopped,
            states,
            thread: Some(thread),
            certificates,
        }
    }
    pub(crate) fn endpoint(&self) -> HttpProxyEndpoint {
        HttpProxyEndpoint {
            host: "localhost".into(),
            port: self.port,
            scheme: HttpProxyScheme::Https,
        }
    }
    pub(crate) fn client_config(&self) -> Arc<ureq::rustls::ClientConfig> {
        self.certificates.client()
    }
}
impl Drop for OwnedTlsProxy {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        for state in self.states.lock().unwrap().iter() {
            state.stop();
        }
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

#[test]
fn unfinished_tls_handshake_has_one_absolute_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let socket = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (_silent_peer, _) = listener.accept().unwrap();
    let state = new_state(false);
    state.track(&socket).unwrap();
    let started = Instant::now();
    let result = tls_upstream(
        socket,
        "localhost",
        verified_tls_config(),
        started + Duration::from_millis(200),
        &state,
    );
    assert!(matches!(result, Err(HttpProxyFailure::Timeout)));
    assert!(started.elapsed() < Duration::from_secs(1));
    state.stop();
}
