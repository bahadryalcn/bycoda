//! Blocking TCP/TLS connection with per-operation timeouts and an overall deadline.
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};
use ureq::rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};

pub(super) const IO_TIMEOUT: Duration = Duration::from_secs(20);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);
const READ_CHUNK: usize = 16 * 1024;

enum Stream {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Stream {
    fn socket(&self) -> &TcpStream {
        match self {
            Stream::Plain(socket) => socket,
            Stream::Tls(tls) => &tls.sock,
        }
    }
}

pub(super) struct Conn {
    stream: Option<Stream>,
    buf: Vec<u8>,
    start: usize,
    deadline: Instant,
    host: String,
}

fn tls_config() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let roots = RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            };
            Arc::new(
                ClientConfig::builder()
                    .with_root_certificates(roots)
                    .with_no_client_auth(),
            )
        })
        .clone()
}

fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let (sender, receiver) = mpsc::channel();
    let target = format!("{host}:{port}");
    std::thread::spawn(move || {
        let _ = sender.send(
            target
                .to_socket_addrs()
                .map(|addrs| addrs.collect::<Vec<_>>()),
        );
    });
    match receiver.recv_timeout(RESOLVE_TIMEOUT) {
        Ok(Ok(addrs)) if !addrs.is_empty() => Ok(addrs),
        Ok(_) => Err(format!(
            "Could not find the mail server {host}. Check the server name."
        )),
        Err(_) => Err(format!("Looking up the mail server {host} timed out.")),
    }
}

impl Conn {
    pub(super) fn connect(
        host: &str,
        port: u16,
        tls: bool,
        deadline: Instant,
    ) -> Result<Self, String> {
        let addrs = resolve(host, port)?;
        let mut last_error = None;
        let mut socket = None;
        for addr in addrs {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match TcpStream::connect_timeout(&addr, remaining.min(IO_TIMEOUT)) {
                Ok(connected) => {
                    socket = Some(connected);
                    break;
                }
                Err(error) => last_error = Some(error),
            }
        }
        let socket = socket.ok_or_else(|| match last_error.map(|error| error.kind()) {
            Some(ErrorKind::TimedOut | ErrorKind::WouldBlock) | None => {
                format!("Connecting to {host}:{port} timed out.")
            }
            Some(_) => format!("Could not connect to {host}:{port}. Check the server and port."),
        })?;
        socket
            .set_read_timeout(Some(IO_TIMEOUT))
            .and_then(|_| socket.set_write_timeout(Some(IO_TIMEOUT)))
            .map_err(|error| format!("Could not configure the connection to {host}: {error}"))?;
        let _ = socket.set_nodelay(true);
        let mut conn = Conn {
            stream: Some(Stream::Plain(socket)),
            buf: Vec::new(),
            start: 0,
            deadline,
            host: host.to_string(),
        };
        if tls {
            conn.start_tls()?;
        }
        Ok(conn)
    }

    /// Wraps the socket in TLS. Buffered plaintext would be an injection, so it is refused.
    pub(super) fn start_tls(&mut self) -> Result<(), String> {
        if self.start < self.buf.len() {
            return Err(format!(
                "{} sent unexpected data before the secure connection.",
                self.host
            ));
        }
        let socket = match self.stream.take() {
            Some(Stream::Plain(socket)) => socket,
            other => {
                self.stream = other;
                return Err("The connection is already secure.".into());
            }
        };
        let name = ureq::rustls::pki_types::ServerName::try_from(self.host.clone())
            .map_err(|_| format!("{} is not a valid TLS server name.", self.host))?;
        let connection = ClientConnection::new(tls_config(), name)
            .map_err(|error| format!("Could not start a secure connection: {error}"))?;
        let mut tls = StreamOwned::new(connection, socket);
        while tls.conn.is_handshaking() {
            self.check_deadline()?;
            if let Err(error) = tls.conn.complete_io(&mut tls.sock) {
                return Err(self.io_error(error));
            }
        }
        self.stream = Some(Stream::Tls(Box::new(tls)));
        Ok(())
    }

    fn check_deadline(&self) -> Result<(), String> {
        if Instant::now() >= self.deadline {
            return Err(format!("{} did not finish in time.", self.host));
        }
        Ok(())
    }

    fn io_error(&self, error: std::io::Error) -> String {
        let host = &self.host;
        if let Some(tls) = error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<ureq::rustls::Error>())
        {
            return format!("The secure connection to {host} failed: {tls}.");
        }
        match error.kind() {
            ErrorKind::TimedOut | ErrorKind::WouldBlock => {
                format!("{host} did not respond in time.")
            }
            ErrorKind::UnexpectedEof
            | ErrorKind::ConnectionReset
            | ErrorKind::ConnectionAborted => {
                format!("{host} closed the connection.")
            }
            ErrorKind::InvalidData => format!("The secure connection to {host} failed: {error}."),
            _ => format!("The connection to {host} failed: {error}."),
        }
    }

    fn fill(&mut self) -> Result<(), String> {
        self.check_deadline()?;
        // Drop consumed bytes so a long FETCH response does not accumulate in the buffer.
        if self.start > 0 {
            self.buf.drain(..self.start);
            self.start = 0;
        }
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        let stream = self.stream.as_mut().ok_or("The connection is closed.")?;
        let _ = stream
            .socket()
            .set_read_timeout(Some(remaining.clamp(Duration::from_millis(1), IO_TIMEOUT)));
        let len = self.buf.len();
        self.buf.resize(len + READ_CHUNK, 0);
        let read = match stream {
            Stream::Plain(socket) => socket.read(&mut self.buf[len..]),
            Stream::Tls(tls) => tls.read(&mut self.buf[len..]),
        };
        self.buf.truncate(len + *read.as_ref().unwrap_or(&0));
        match read {
            Ok(0) => Err(format!("{} closed the connection.", self.host)),
            Ok(_) => Ok(()),
            Err(error) => Err(self.io_error(error)),
        }
    }

    /// Reads one line without its line break; bytes are returned raw for lossy decoding.
    pub(super) fn read_line(&mut self, max: usize) -> Result<Vec<u8>, String> {
        // Offset from `start`, which `fill` may move when it compacts the buffer.
        let mut scanned = 0;
        loop {
            let from = self.start + scanned;
            if let Some(offset) = self.buf[from..].iter().position(|byte| *byte == b'\n') {
                let end = from + offset;
                let mut line = self.buf[self.start..end].to_vec();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                self.start = end + 1;
                return Ok(line);
            }
            scanned = self.buf.len() - self.start;
            if scanned > max {
                return Err(format!("{} sent a response that is too long.", self.host));
            }
            self.fill()?;
        }
    }

    pub(super) fn read_exact(&mut self, len: usize) -> Result<Vec<u8>, String> {
        while self.buf.len() - self.start < len {
            self.fill()?;
        }
        let bytes = self.buf[self.start..self.start + len].to_vec();
        self.start += len;
        Ok(bytes)
    }

    pub(super) fn write_all(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.check_deadline()?;
        let stream = self.stream.as_mut().ok_or("The connection is closed.")?;
        let result = match stream {
            Stream::Plain(socket) => socket.write_all(bytes).and_then(|_| socket.flush()),
            Stream::Tls(tls) => tls.write_all(bytes).and_then(|_| tls.flush()),
        };
        result.map_err(|error| self.io_error(error))
    }
}
