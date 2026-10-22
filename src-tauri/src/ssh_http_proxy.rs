//! Process-scoped outbound HTTP CONNECT for the canonical OpenSSH child.
//! The helper receives a loopback capability, never the proxy credential.
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

const ADDRESS: &str = "BYCODA_SSH_HTTP_PROXY_ADDRESS";
const CAPABILITY: &str = "BYCODA_SSH_HTTP_PROXY_CAPABILITY";
const MAGIC: &[u8] = b"BYCODA_HTTP_PROXY_V1 ";
const DEADLINE: Duration = Duration::from_secs(5);
const MAX_HEADER: usize = 16 * 1024;
static RESOLVERS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HttpProxyEndpoint {
    pub host: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "HttpProxyScheme::is_http")]
    pub scheme: HttpProxyScheme,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HttpProxyScheme {
    #[default]
    Http,
    Https,
}
impl HttpProxyScheme {
    fn is_http(&self) -> bool {
        *self == Self::Http
    }
}
impl HttpProxyEndpoint {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if host_valid(&self.host) && self.port != 0 {
            Ok(())
        } else {
            Err(HttpProxyFailure::Invalid.to_string())
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HttpProxyTarget {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum HttpProxyFailure {
    Invalid,
    Timeout,
    Transport,
    Rejected(u16),
    Cancelled,
}
impl std::fmt::Display for HttpProxyFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(code) => write!(f, "HTTP upstream proxy rejected CONNECT ({code})"),
            Self::Invalid => f.write_str("Invalid HTTP proxy configuration or response"),
            Self::Timeout => f.write_str("HTTP proxy connection timed out"),
            Self::Transport => f.write_str("HTTP proxy connection failed"),
            Self::Cancelled => f.write_str("HTTP proxy connection cancelled"),
        }
    }
}

pub(crate) struct BasicCredentials {
    username: Vec<u8>,
    password: Vec<u8>,
}
impl BasicCredentials {
    /// Only an already approved native operation may make a per-child copy.
    /// This intentionally does not implement Clone or expose credential bytes.
    pub(crate) fn duplicate_approved(&self) -> Self {
        Self {
            username: self.username.clone(),
            password: self.password.clone(),
        }
    }
    pub(crate) fn approved_plain_http(
        username: &str,
        password: &str,
        approved: bool,
    ) -> Result<Self, String> {
        if !approved
            || username.is_empty()
            || username.len() > 4096
            || password.len() > 4096
            || username.contains(':')
            || username
                .chars()
                .chain(password.chars())
                .any(char::is_control)
        {
            return Err("HTTP proxy Basic authentication requires explicit plaintext transport approval and valid credentials".into());
        }
        Ok(Self {
            username: username.as_bytes().to_vec(),
            password: password.as_bytes().to_vec(),
        })
    }
}
impl Drop for BasicCredentials {
    fn drop(&mut self) {
        self.username.fill(0);
        self.password.fill(0);
    }
}
struct SecretBytes(Vec<u8>);
impl Drop for SecretBytes {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

fn host_valid(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with('-')
        && (host.parse::<IpAddr>().is_ok()
            || host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            }))
}
fn authority(target: &HttpProxyTarget) -> Result<String, HttpProxyFailure> {
    if !host_valid(&target.host) || target.port == 0 {
        return Err(HttpProxyFailure::Invalid);
    }
    Ok(if target.host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", target.host, target.port)
    } else {
        format!("{}:{}", target.host, target.port)
    })
}

struct State {
    stopped: AtomicBool,
    streams: Mutex<Vec<TcpStream>>,
    failure: Mutex<Option<HttpProxyFailure>>,
    credentials: Mutex<Option<BasicCredentials>>,
}
impl State {
    fn track(&self, stream: &TcpStream) -> Result<(), HttpProxyFailure> {
        let mut streams = self
            .streams
            .lock()
            .map_err(|_| HttpProxyFailure::Transport)?;
        if self.stopped.load(Ordering::Acquire) {
            let _ = stream.shutdown(Shutdown::Both);
            return Err(HttpProxyFailure::Cancelled);
        }
        streams.push(
            stream
                .try_clone()
                .map_err(|_| HttpProxyFailure::Transport)?,
        );
        Ok(())
    }
    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(mut credentials) = self.credentials.lock() {
            drop(credentials.take());
        }
        if let Ok(mut streams) = self.streams.lock() {
            for stream in streams.drain(..) {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
    }
}

pub(crate) struct HttpProxyLease {
    proxy: HttpProxyEndpoint,
    target: HttpProxyTarget,
    address: SocketAddr,
    capability: String,
    auth_scope: Option<String>,
    state: Arc<State>,
}
impl std::fmt::Debug for HttpProxyLease {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpProxyLease")
            .field("proxy", &self.proxy)
            .field("target", &self.target)
            .field("authenticated", &self.auth_scope.is_some())
            .finish_non_exhaustive()
    }
}
impl PartialEq for HttpProxyLease {
    fn eq(&self, other: &Self) -> bool {
        self.proxy == other.proxy
            && self.target == other.target
            && self.auth_scope == other.auth_scope
    }
}
impl Eq for HttpProxyLease {}

impl HttpProxyLease {
    pub(crate) fn start(
        proxy: HttpProxyEndpoint,
        target: HttpProxyTarget,
        credentials: Option<BasicCredentials>,
    ) -> Result<Self, String> {
        Self::start_with_tls_config(proxy, target, credentials, verified_tls_config())
    }
    #[cfg(test)]
    pub(crate) fn start_with_test_tls_config(
        proxy: HttpProxyEndpoint,
        target: HttpProxyTarget,
        credentials: Option<BasicCredentials>,
        config: Arc<ureq::rustls::ClientConfig>,
    ) -> Result<Self, String> {
        Self::start_with_tls_config(proxy, target, credentials, config)
    }
    fn start_with_tls_config(
        proxy: HttpProxyEndpoint,
        target: HttpProxyTarget,
        credentials: Option<BasicCredentials>,
        config: Arc<ureq::rustls::ClientConfig>,
    ) -> Result<Self, String> {
        if !host_valid(&proxy.host) || proxy.port == 0 {
            return Err(HttpProxyFailure::Invalid.to_string());
        }
        authority(&target).map_err(|e| e.to_string())?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| HttpProxyFailure::Transport.to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|_| HttpProxyFailure::Transport.to_string())?;
        let address = listener
            .local_addr()
            .map_err(|_| HttpProxyFailure::Transport.to_string())?;
        let capability = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let expected = capability.clone();
        let authenticated = credentials.is_some();
        let state = Arc::new(State {
            stopped: AtomicBool::new(false),
            streams: Mutex::new(Vec::new()),
            failure: Mutex::new(None),
            credentials: Mutex::new(credentials),
        });
        let worker = state.clone();
        let remote = proxy.clone();
        let destination = target.clone();
        std::thread::spawn(move || {
            let expiry = Instant::now() + Duration::from_secs(30);
            let mut attempts = 0;
            while !worker.stopped.load(Ordering::Acquire) && Instant::now() < expiry {
                match listener.accept() {
                    Ok((mut local, peer)) => {
                        attempts += 1;
                        // Explicitly restore blocking mode on accepted Windows sockets.
                        let valid = peer.ip().is_loopback()
                            && local.set_nonblocking(false).is_ok()
                            && worker.track(&local).is_ok()
                            && verify_capability(&mut local, &expected).is_ok();
                        if !valid {
                            let _ = local.shutdown(Shutdown::Both);
                            if attempts >= 8 {
                                break;
                            }
                            continue;
                        }
                        drop(listener);
                        let result =
                            connect_and_relay(local, &remote, &destination, &worker, config);
                        if let Err(error) = result {
                            if !worker.stopped.load(Ordering::Acquire) {
                                if let Ok(mut failure) = worker.failure.lock() {
                                    *failure = Some(error);
                                }
                            }
                        }
                        worker.stop();
                        return;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20))
                    }
                    Err(_) => break,
                }
            }
            worker.stop();
        });
        Ok(Self {
            proxy,
            target,
            address,
            capability,
            auth_scope: authenticated.then(|| uuid::Uuid::new_v4().to_string()),
            state,
        })
    }
    pub(crate) fn environment(&self) -> Vec<(&'static str, String)> {
        vec![
            (ADDRESS, self.address.to_string()),
            (CAPABILITY, self.capability.clone()),
        ]
    }
    #[cfg(test)]
    pub(crate) fn failure(&self) -> Option<HttpProxyFailure> {
        self.state
            .failure
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }
    #[cfg(test)]
    pub(crate) fn stop(&self) {
        self.state.stop();
    }
    #[cfg(test)]
    pub(crate) fn matches(&self, proxy: &HttpProxyEndpoint, target: &HttpProxyTarget) -> bool {
        self.proxy == *proxy
            && self.target == *target
            && self.auth_scope.is_none()
            && !self.state.stopped.load(Ordering::Acquire)
    }
    #[cfg(test)]
    pub(crate) fn proxy_command(&self, executable: &Path) -> Result<String, String> {
        proxy_command(executable)
    }
}
pub(crate) fn proxy_command(executable: &Path) -> Result<String, String> {
    let path = executable
        .to_str()
        .ok_or("HTTP proxy helper executable path is not UTF-8")?;
    if path.is_empty() || path.chars().any(|c| c.is_control() || c == '%') {
        return Err("Unsupported HTTP proxy helper executable path".into());
    }
    #[cfg(windows)]
    {
        if path.contains(['"', '&', '|', '<', '>', '^', '!']) {
            return Err("Unsupported HTTP proxy helper executable path".into());
        }
        Ok(format!("\"{path}\" ssh-http-proxy"))
    }
    #[cfg(not(windows))]
    {
        Ok(format!(
            "{} ssh-http-proxy",
            crate::remote_ssh::shell_quote(path)
        ))
    }
}
impl Drop for HttpProxyLease {
    fn drop(&mut self) {
        self.state.stop();
    }
}

fn remaining(deadline: Instant) -> Result<Duration, HttpProxyFailure> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|d| !d.is_zero())
        .ok_or(HttpProxyFailure::Timeout)
}
fn read_bounded(
    stream: &mut TcpStream,
    ending: &[u8],
    cap: usize,
    deadline: Instant,
) -> Result<Vec<u8>, HttpProxyFailure> {
    let mut bytes = Vec::new();
    while bytes.len() < cap {
        stream
            .set_read_timeout(Some(remaining(deadline)?))
            .map_err(|_| HttpProxyFailure::Transport)?;
        let mut byte = [0];
        stream.read_exact(&mut byte).map_err(|error| {
            if matches!(
                error.kind(),
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
            ) {
                HttpProxyFailure::Timeout
            } else {
                HttpProxyFailure::Transport
            }
        })?;
        bytes.push(byte[0]);
        if bytes.ends_with(ending) {
            return Ok(bytes);
        }
    }
    Err(HttpProxyFailure::Invalid)
}
fn verify_capability(stream: &mut TcpStream, expected: &str) -> Result<(), HttpProxyFailure> {
    let bytes = read_bounded(
        stream,
        b"\n",
        MAGIC.len() + 65,
        Instant::now() + Duration::from_secs(1),
    )?;
    let mut correct = MAGIC.to_vec();
    correct.extend_from_slice(expected.as_bytes());
    correct.push(b'\n');
    if bytes.len() != correct.len() {
        return Err(HttpProxyFailure::Invalid);
    }
    let difference = bytes
        .iter()
        .zip(correct.iter())
        .fold(0u8, |value, (a, b)| value | (a ^ b));
    if difference != 0 {
        return Err(HttpProxyFailure::Invalid);
    }
    Ok(())
}
fn resolve_and_connect(
    proxy: &HttpProxyEndpoint,
    deadline: Instant,
    state: &State,
) -> Result<TcpStream, HttpProxyFailure> {
    // DNS uses an isolated resolver worker with a bounded observation deadline.
    // A late result cannot initiate a connection after cancellation/expiry.
    if let Ok(ip) = proxy.host.parse::<IpAddr>() {
        if state.stopped.load(Ordering::Acquire) {
            return Err(HttpProxyFailure::Cancelled);
        }
        return TcpStream::connect_timeout(&SocketAddr::new(ip, proxy.port), remaining(deadline)?)
            .map_err(|_| HttpProxyFailure::Transport);
    }
    if RESOLVERS.fetch_add(1, Ordering::AcqRel) >= 16 {
        RESOLVERS.fetch_sub(1, Ordering::AcqRel);
        return Err(HttpProxyFailure::Transport);
    }
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let host = proxy.host.clone();
    let port = proxy.port;
    std::thread::spawn(move || {
        struct Slot;
        impl Drop for Slot {
            fn drop(&mut self) {
                RESOLVERS.fetch_sub(1, Ordering::AcqRel);
            }
        }
        let _slot = Slot;
        let result = (host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| addresses.take(8).collect::<Vec<_>>());
        let _ = send.send(result);
    });
    let addresses = loop {
        if state.stopped.load(Ordering::Acquire) {
            return Err(HttpProxyFailure::Cancelled);
        }
        match receive.recv_timeout(remaining(deadline)?.min(Duration::from_millis(50))) {
            Ok(result) => break result.map_err(|_| HttpProxyFailure::Transport)?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return Err(HttpProxyFailure::Transport),
        }
    };
    for address in addresses {
        if state.stopped.load(Ordering::Acquire) {
            return Err(HttpProxyFailure::Cancelled);
        }
        if let Ok(stream) = TcpStream::connect_timeout(&address, remaining(deadline)?) {
            return Ok(stream);
        }
    }
    Err(HttpProxyFailure::Transport)
}

/// TLS owns one connection state; it must never be cloned into two blocking readers.
enum Upstream {
    Plain(TcpStream),
    Tls(Box<ureq::rustls::StreamOwned<ureq::rustls::ClientConnection, TcpStream>>),
}
impl Upstream {
    fn socket(&self) -> &TcpStream {
        match self {
            Self::Plain(socket) => socket,
            Self::Tls(tls) => &tls.sock,
        }
    }
}
impl Read for Upstream {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(s) => s.read(bytes),
            Self::Tls(s) => s.read(bytes),
        }
    }
}
impl Write for Upstream {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(s) => s.write(bytes),
            Self::Tls(s) => s.write(bytes),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Plain(s) => s.flush(),
            Self::Tls(s) => s.flush(),
        }
    }
}
fn verified_tls_config() -> Arc<ureq::rustls::ClientConfig> {
    let roots = ureq::rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    Arc::new(
        ureq::rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}
fn tls_upstream(
    socket: TcpStream,
    host: &str,
    config: Arc<ureq::rustls::ClientConfig>,
    deadline: Instant,
    state: &State,
) -> Result<Upstream, HttpProxyFailure> {
    let name = ureq::rustls::pki_types::ServerName::try_from(host.to_owned())
        .map_err(|_| HttpProxyFailure::Invalid)?;
    let connection = ureq::rustls::ClientConnection::new(config, name)
        .map_err(|_| HttpProxyFailure::Transport)?;
    let mut tls = ureq::rustls::StreamOwned::new(connection, socket);
    tls.sock
        .set_nonblocking(true)
        .map_err(|_| HttpProxyFailure::Transport)?;
    while tls.conn.is_handshaking() {
        if state.stopped.load(Ordering::Acquire) {
            return Err(HttpProxyFailure::Cancelled);
        }
        remaining(deadline)?;
        if tls.conn.wants_write() {
            match tls.conn.write_tls(&mut tls.sock) {
                Ok(0) => {
                    return Err(if state.stopped.load(Ordering::Acquire) {
                        HttpProxyFailure::Cancelled
                    } else {
                        HttpProxyFailure::Transport
                    })
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => {
                    return Err(if state.stopped.load(Ordering::Acquire) {
                        HttpProxyFailure::Cancelled
                    } else {
                        HttpProxyFailure::Transport
                    })
                }
            }
        }
        match tls.conn.read_tls(&mut tls.sock) {
            Ok(0) => {
                return Err(if state.stopped.load(Ordering::Acquire) {
                    HttpProxyFailure::Cancelled
                } else {
                    HttpProxyFailure::Transport
                })
            }
            Ok(_) => {
                tls.conn
                    .process_new_packets()
                    .map_err(|_| HttpProxyFailure::Transport)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                return Err(if state.stopped.load(Ordering::Acquire) {
                    HttpProxyFailure::Cancelled
                } else {
                    HttpProxyFailure::Transport
                })
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    tls.sock
        .set_nonblocking(false)
        .map_err(|_| HttpProxyFailure::Transport)?;
    tls.sock
        .set_read_timeout(Some(remaining(deadline)?))
        .map_err(|_| HttpProxyFailure::Transport)?;
    tls.sock
        .set_write_timeout(Some(remaining(deadline)?))
        .map_err(|_| HttpProxyFailure::Transport)?;
    Ok(Upstream::Tls(Box::new(tls)))
}
fn io_failure(error: &std::io::Error) -> HttpProxyFailure {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        HttpProxyFailure::Timeout
    } else {
        HttpProxyFailure::Transport
    }
}

fn connect_tunnel_with_config(
    proxy: &HttpProxyEndpoint,
    target: &HttpProxyTarget,
    state: &State,
    config: Arc<ureq::rustls::ClientConfig>,
) -> Result<Upstream, HttpProxyFailure> {
    let deadline = Instant::now() + DEADLINE;
    let socket = resolve_and_connect(proxy, deadline, state)?;
    state.track(&socket)?;
    let mut upstream = match proxy.scheme {
        HttpProxyScheme::Http => Upstream::Plain(socket),
        HttpProxyScheme::Https => tls_upstream(socket, &proxy.host, config, deadline, state)?,
    };
    upstream
        .socket()
        .set_write_timeout(Some(remaining(deadline)?))
        .map_err(|_| HttpProxyFailure::Transport)?;
    let target = authority(target)?;
    let mut header =
        SecretBytes(format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n").into_bytes());
    let credentials = state
        .credentials
        .lock()
        .map_err(|_| HttpProxyFailure::Transport)?
        .take();
    if let Some(credentials) = credentials {
        use base64::Engine as _;
        let mut plain = SecretBytes(credentials.username.clone());
        plain.0.push(b':');
        plain.0.extend_from_slice(&credentials.password);
        let encoded = SecretBytes(
            base64::engine::general_purpose::STANDARD
                .encode(&plain.0)
                .into_bytes(),
        );
        header.0.extend_from_slice(b"Proxy-Authorization: Basic ");
        header.0.extend_from_slice(&encoded.0);
        header.0.extend_from_slice(b"\r\n");
    }
    header.0.extend_from_slice(b"\r\n");
    upstream
        .write_all(&header.0)
        .map_err(|_| HttpProxyFailure::Transport)?;
    upstream.flush().map_err(|e| io_failure(&e))?;
    drop(header);
    let mut response = Vec::new();
    while response.len() < MAX_HEADER && !response.ends_with(b"\r\n\r\n") {
        if state.stopped.load(Ordering::Acquire) {
            return Err(HttpProxyFailure::Cancelled);
        }
        // On Windows, shutdown through a duplicated socket handle does not
        // reliably interrupt a concurrent read on the original handle. Poll
        // cancellation independently while keeping the overall CONNECT deadline.
        upstream
            .socket()
            .set_read_timeout(Some(remaining(deadline)?.min(Duration::from_millis(50))))
            .map_err(|_| HttpProxyFailure::Transport)?;
        let mut byte = [0];
        match upstream.read(&mut byte) {
            Ok(0) => {
                return Err(if state.stopped.load(Ordering::Acquire) {
                    HttpProxyFailure::Cancelled
                } else {
                    HttpProxyFailure::Transport
                });
            }
            Ok(_) => response.push(byte[0]),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::Interrupted
                ) => {}
            Err(error) => {
                return Err(if state.stopped.load(Ordering::Acquire) {
                    HttpProxyFailure::Cancelled
                } else {
                    io_failure(&error)
                });
            }
        }
    }
    if !response.ends_with(b"\r\n\r\n") {
        return Err(HttpProxyFailure::Invalid);
    }
    let response = std::str::from_utf8(&response).map_err(|_| HttpProxyFailure::Invalid)?;
    for (index, byte) in response.bytes().enumerate() {
        if (byte == b'\r' && response.as_bytes().get(index + 1) != Some(&b'\n'))
            || (byte == b'\n'
                && index
                    .checked_sub(1)
                    .and_then(|prior| response.as_bytes().get(prior))
                    != Some(&b'\r'))
        {
            return Err(HttpProxyFailure::Invalid);
        }
    }
    if response
        .bytes()
        .any(|b| b == 0 || (b.is_ascii_control() && !matches!(b, b'\r' | b'\n' | b'\t')))
    {
        return Err(HttpProxyFailure::Invalid);
    }
    let first = response
        .split("\r\n")
        .next()
        .ok_or(HttpProxyFailure::Invalid)?;
    let mut parts = first.splitn(3, ' ');
    if !matches!(parts.next(), Some("HTTP/1.1" | "HTTP/1.0")) {
        return Err(HttpProxyFailure::Invalid);
    }
    let code = parts
        .next()
        .filter(|code| code.len() == 3 && code.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or(HttpProxyFailure::Invalid)?;
    if !(200..300).contains(&code) {
        return Err(HttpProxyFailure::Rejected(code));
    }
    upstream
        .socket()
        .set_read_timeout(None)
        .map_err(|_| HttpProxyFailure::Transport)?;
    upstream
        .socket()
        .set_write_timeout(None)
        .map_err(|_| HttpProxyFailure::Transport)?;
    Ok(upstream)
}
/// One bounded pump owns both TLS directions. Socket shutdown by the lease cancels
/// handshake, CONNECT and idle transfer without leaving a blocked TLS mutex owner.
fn relay_tls(
    local: TcpStream,
    tls: ureq::rustls::StreamOwned<ureq::rustls::ClientConnection, TcpStream>,
    state: &State,
) -> Result<(), HttpProxyFailure> {
    relay_tls_connection(
        local,
        tls.sock,
        ureq::rustls::Connection::Client(tls.conn),
        state,
    )
}
fn relay_tls_connection(
    mut local: TcpStream,
    mut socket: TcpStream,
    mut connection: ureq::rustls::Connection,
    state: &State,
) -> Result<(), HttpProxyFailure> {
    local
        .set_nonblocking(true)
        .map_err(|_| HttpProxyFailure::Transport)?;
    socket
        .set_nonblocking(true)
        .map_err(|_| HttpProxyFailure::Transport)?;
    connection.set_buffer_limit(Some(64 * 1024));
    let mut local_eof = false;
    let mut remote_eof = false;
    let mut closed_local_write = false;
    let mut pending = Vec::<u8>::new();
    let mut offset = 0;
    let mut bytes = [0; 16 * 1024];
    loop {
        if state.stopped.load(Ordering::Acquire) {
            return Err(HttpProxyFailure::Cancelled);
        }
        if !local_eof && !connection.wants_write() {
            match local.read(&mut bytes) {
                Ok(0) => {
                    local_eof = true;
                    connection.send_close_notify();
                }
                Ok(count) => connection
                    .writer()
                    .write_all(&bytes[..count])
                    .map_err(|_| HttpProxyFailure::Transport)?,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err(HttpProxyFailure::Transport),
            }
        }
        while connection.wants_write() {
            match connection.write_tls(&mut socket) {
                Ok(0) => return Err(HttpProxyFailure::Transport),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => return Err(HttpProxyFailure::Transport),
            }
        }
        if pending.is_empty() && !remote_eof {
            match connection.reader().read(&mut bytes) {
                Ok(0) => remote_eof = true,
                Ok(count) => pending.extend_from_slice(&bytes[..count]),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    match connection.read_tls(&mut socket) {
                        Ok(0) => return Err(HttpProxyFailure::Transport),
                        Ok(_) => {
                            connection
                                .process_new_packets()
                                .map_err(|_| HttpProxyFailure::Transport)?;
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => return Err(HttpProxyFailure::Transport),
                    }
                }
                Err(_) => return Err(HttpProxyFailure::Transport),
            }
        }
        if !pending.is_empty() {
            match local.write(&pending[offset..]) {
                Ok(0) => return Err(HttpProxyFailure::Transport),
                Ok(count) => {
                    offset += count;
                    if offset == pending.len() {
                        pending.clear();
                        offset = 0;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err(HttpProxyFailure::Transport),
            }
        }
        if remote_eof && pending.is_empty() && !closed_local_write {
            local
                .shutdown(Shutdown::Write)
                .map_err(|_| HttpProxyFailure::Transport)?;
            closed_local_write = true;
        }
        if local_eof && remote_eof && pending.is_empty() && !connection.wants_write() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn connect_and_relay(
    mut local: TcpStream,
    proxy: &HttpProxyEndpoint,
    target: &HttpProxyTarget,
    state: &State,
    config: Arc<ureq::rustls::ClientConfig>,
) -> Result<(), HttpProxyFailure> {
    state.track(&local)?;
    let upstream = match connect_tunnel_with_config(proxy, target, state, config) {
        Ok(stream) => stream,
        Err(error) => {
            let _ = local.write_all(
                format!(
                    "ERR {}\n",
                    match error {
                        HttpProxyFailure::Rejected(code) => code,
                        _ => 0,
                    }
                )
                .as_bytes(),
            );
            return Err(error);
        }
    };
    local
        .write_all(b"OK\n")
        .map_err(|_| HttpProxyFailure::Transport)?;
    local
        .set_read_timeout(None)
        .map_err(|_| HttpProxyFailure::Transport)?;
    local
        .set_write_timeout(None)
        .map_err(|_| HttpProxyFailure::Transport)?;
    let mut upstream = match upstream {
        Upstream::Tls(tls) => return relay_tls(local, *tls, state),
        Upstream::Plain(socket) => socket,
    };
    let mut local_write = local.try_clone().map_err(|_| HttpProxyFailure::Transport)?;
    let mut upstream_read = upstream
        .try_clone()
        .map_err(|_| HttpProxyFailure::Transport)?;
    let incoming = std::thread::spawn(move || {
        let result = std::io::copy(&mut upstream_read, &mut local_write);
        let _ = local_write.shutdown(Shutdown::Write);
        result
    });
    let outgoing = std::io::copy(&mut local, &mut upstream);
    let _ = upstream.shutdown(Shutdown::Write);
    let incoming = incoming.join().map_err(|_| HttpProxyFailure::Transport)?;
    outgoing
        .and(incoming)
        .map(|_| ())
        .map_err(|_| HttpProxyFailure::Transport)
}

/// Dispatched before askpass/Tauri startup. The only argv value is a fixed mode.
pub fn maybe_run() -> Option<i32> {
    if std::env::args().nth(1).as_deref() != Some("ssh-http-proxy") {
        return None;
    }
    Some(match run_helper() {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    })
}
fn run_helper() -> Result<(), HttpProxyFailure> {
    let address: SocketAddr = std::env::var(ADDRESS)
        .map_err(|_| HttpProxyFailure::Invalid)?
        .parse()
        .map_err(|_| HttpProxyFailure::Invalid)?;
    let capability = std::env::var(CAPABILITY).map_err(|_| HttpProxyFailure::Invalid)?;
    if !address.ip().is_loopback()
        || capability.len() != 64
        || !capability.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(HttpProxyFailure::Invalid);
    }
    let mut stream =
        TcpStream::connect_timeout(&address, DEADLINE).map_err(|_| HttpProxyFailure::Transport)?;
    stream
        .set_write_timeout(Some(DEADLINE))
        .map_err(|_| HttpProxyFailure::Transport)?;
    stream
        .write_all(MAGIC)
        .and_then(|_| stream.write_all(capability.as_bytes()))
        .and_then(|_| stream.write_all(b"\n"))
        .map_err(|_| HttpProxyFailure::Transport)?;
    let ack = read_bounded(
        &mut stream,
        b"\n",
        16,
        Instant::now() + DEADLINE + Duration::from_secs(1),
    )?;
    if ack != b"OK\n" {
        let code = std::str::from_utf8(&ack)
            .ok()
            .and_then(|value| value.strip_prefix("ERR "))
            .and_then(|value| value.trim().parse::<u16>().ok())
            .filter(|code| *code != 0);
        return Err(code
            .map(HttpProxyFailure::Rejected)
            .unwrap_or(HttpProxyFailure::Transport));
    }
    stream
        .set_read_timeout(None)
        .map_err(|_| HttpProxyFailure::Transport)?;
    stream
        .set_write_timeout(None)
        .map_err(|_| HttpProxyFailure::Transport)?;
    let mut output_stream = stream
        .try_clone()
        .map_err(|_| HttpProxyFailure::Transport)?;
    let input = std::thread::spawn(move || {
        let result = std::io::copy(&mut std::io::stdin().lock(), &mut stream);
        let _ = stream.shutdown(Shutdown::Write);
        result
    });
    // Stdout is line-buffered even when this headless helper carries binary
    // SSH fragments. Flush every received chunk; a packet need not contain a
    // newline and the peer may wait for its response before sending more.
    let mut output = std::io::stdout().lock();
    let mut buffer = [0u8; 8192];
    loop {
        let count = match output_stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(HttpProxyFailure::Transport),
        };
        output
            .write_all(&buffer[..count])
            .and_then(|_| output.flush())
            .map_err(|_| HttpProxyFailure::Transport)?;
    }
    // Do not block helper exit on an inherited stdin handle after peer EOF.
    let _ = output_stream.shutdown(Shutdown::Both);
    drop(input);
    Ok(())
}

#[cfg(test)]
#[path = "ssh_http_proxy_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "ssh_https_proxy_native_tests.rs"]
pub(crate) mod https_native_tests;
