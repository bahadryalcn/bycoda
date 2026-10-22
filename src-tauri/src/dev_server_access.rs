//! Device-authenticated TCP relay for opening an owning host's dev app in this PC's browser.
//! Credentials never enter the renderer, browser URL, or forwarded HTTP request.
use super::{read, rpc, store_path, RemoteConnections, StoredMachine};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

const CHUNK: usize = 256 * 1024;
const IDLE: Duration = Duration::from_secs(15 * 60);
struct Gateway {
    port: u16,
    alive: AtomicBool,
    active: AtomicUsize,
    touched: Mutex<Instant>,
}
static GATEWAYS: OnceLock<Mutex<HashMap<String, Arc<Gateway>>>> = OnceLock::new();

#[derive(Clone)]
struct Access {
    machine: StoredMachine,
    endpoint: String,
    store: PathBuf,
    params: Value,
    target_origin: String,
}

impl Access {
    fn current(&self) -> bool {
        read(&self.store).is_ok_and(|machines| {
            machines.iter().any(|machine| {
                machine.id == self.machine.id
                    && machine.environment_id == self.machine.environment_id
                    && machine.token == self.machine.token
                    && machine.endpoint == self.machine.endpoint
                    && machine.ssh == self.machine.ssh
            })
        })
    }
    fn call(&self, method: &str, mut extra: Value) -> Result<Value, String> {
        if !self.current() {
            return Err(
                "The owning computer is disconnected. Reconnect it and open the link again.".into(),
            );
        }
        let params = extra
            .as_object_mut()
            .ok_or("Invalid development server request")?;
        params.insert("projectId".into(), self.params["projectId"].clone());
        rpc(
            &self.endpoint,
            &self.machine.token,
            Some(&self.machine.environment_id),
            method,
            extra,
        )
    }
}

fn timeout(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

/// A private loopback port must not become a browser-origin bypass into a paired computer.
fn allowed_headers(headers: &str, port: u16) -> bool {
    let mut lines = headers.split("\r\n");
    let Some(first) = lines.next() else {
        return false;
    };
    let mut request = first.split_whitespace();
    let method = request.next().unwrap_or_default();
    let path = request.next().unwrap_or_default();
    if method == "CONNECT" || !path.starts_with('/') || path.starts_with("//") {
        return false;
    }
    let authority = format!("127.0.0.1:{port}");
    let origin = format!("http://{authority}");
    let mut host_seen = false;
    for line in lines.filter(|line| !line.is_empty()) {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        let value = value.trim();
        if name.eq_ignore_ascii_case("host") {
            if host_seen || value != authority {
                return false;
            }
            host_seen = true;
        }
        if name.eq_ignore_ascii_case("origin") && value != origin {
            return false;
        }
        if name.eq_ignore_ascii_case("sec-fetch-site") && !matches!(value, "none" | "same-origin") {
            return false;
        }
        if name.eq_ignore_ascii_case("referer") && !value.starts_with(&format!("{origin}/")) {
            return false;
        }
    }
    host_seen
}

struct BrowserRequest {
    data: Vec<u8>,
    remaining: usize,
    websocket: bool,
}

fn browser_request(
    bytes: &[u8],
    end: usize,
    port: u16,
    target_origin: &str,
) -> Result<BrowserRequest, String> {
    let header = std::str::from_utf8(&bytes[..end]).map_err(|_| "Invalid browser headers")?;
    if !allowed_headers(header, port) {
        return Err(
            "Only this private browser address may use the development server connection".into(),
        );
    }
    let mut lines = header.split("\r\n");
    let first = lines.next().ok_or("Missing browser request")?;
    let fields: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name, value.trim()))
        .collect();
    let websocket = fields.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("upgrade") && value.eq_ignore_ascii_case("websocket")
    });
    let lengths: Vec<_> = fields
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .collect();
    if lengths.len() > 1
        || fields
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("transfer-encoding"))
    {
        return Err("Private browser requests require one explicit content length".into());
    }
    if lengths.first().is_some_and(|(_, value)| {
        value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return Err("Invalid browser content length".into());
    }
    let length = lengths
        .first()
        .map(|(_, value)| value.parse::<usize>())
        .transpose()
        .map_err(|_| "Invalid browser content length")?
        .unwrap_or(0);
    let body = &bytes[end + 4..];
    if body.len() > length || (websocket && length != 0) {
        return Err("Pipelined browser requests are not supported".into());
    }
    let local_origin = format!("http://127.0.0.1:{port}");
    let target_authority = target_origin
        .strip_prefix("http://")
        .ok_or("Invalid development server origin")?;
    let mut output = format!("{first}\r\n");
    for (name, value) in fields {
        if name.eq_ignore_ascii_case("connection") || name.eq_ignore_ascii_case("proxy-connection")
        {
            continue;
        }
        let value = if name.eq_ignore_ascii_case("host") {
            target_authority.to_owned()
        } else if name.eq_ignore_ascii_case("origin") {
            target_origin.to_owned()
        } else if name.eq_ignore_ascii_case("referer") {
            value.replacen(&local_origin, target_origin, 1)
        } else {
            value.to_owned()
        };
        output.push_str(&format!("{name}: {value}\r\n"));
    }
    output.push_str(if websocket {
        "Connection: Upgrade\r\n\r\n"
    } else {
        "Connection: close\r\n\r\n"
    });
    let mut data = output.into_bytes();
    data.extend_from_slice(body);
    Ok(BrowserRequest {
        data,
        remaining: length - body.len(),
        websocket,
    })
}

fn first_request(
    socket: &mut TcpStream,
    port: u16,
    target_origin: &str,
) -> Result<BrowserRequest, String> {
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut part = [0_u8; 4096];
    loop {
        let count = socket
            .read(&mut part)
            .map_err(|_| "The browser request timed out")?;
        if count == 0 {
            return Err("The browser closed the request".into());
        }
        bytes.extend_from_slice(&part[..count]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            return browser_request(&bytes, end, port, target_origin);
        }
        if bytes.len() > 64 * 1024 {
            return Err("Browser headers are too large".into());
        }
    }
}

fn connection(mut socket: TcpStream, access: Access, gateway: Arc<Gateway>) {
    let result = relay(&mut socket, &access, &gateway);
    if result.is_err() {
        let _ = socket.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nThe private development server connection is unavailable. Reopen the link from bycoda.\n");
    }
    let _ = socket.shutdown(Shutdown::Both);
    gateway.active.fetch_sub(1, Ordering::SeqCst);
}

fn relay(socket: &mut TcpStream, access: &Access, gateway: &Arc<Gateway>) -> Result<(), String> {
    let first = first_request(socket, gateway.port, &access.target_origin)?;
    let opened = access.call("devServers.bridgeOpen", access.params.clone())?;
    let stream = opened["streamId"]
        .as_str()
        .ok_or("Host returned no development server connection")?
        .to_owned();
    let result = (|| {
        access.call(
            "devServers.bridgeWrite",
            json!({ "streamId": stream, "data": STANDARD.encode(first.data) }),
        )?;
        socket
            .set_read_timeout(Some(Duration::from_secs(1)))
            .map_err(|e| e.to_string())?;
        socket
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|e| e.to_string())?;
        let mut upload = socket.try_clone().map_err(|e| e.to_string())?;
        let finished = Arc::new(AtomicBool::new(false));
        let upgraded = Arc::new(AtomicBool::new(false));
        let writer_upgraded = upgraded.clone();
        let (writer_done, writer_access, writer_stream, writer_gateway) = (
            finished.clone(),
            access.clone(),
            stream.clone(),
            gateway.clone(),
        );
        let writer = std::thread::spawn(move || {
            let mut buffer = vec![0; CHUNK];
            let mut remaining = first.remaining;
            while !writer_done.load(Ordering::SeqCst) && writer_gateway.alive.load(Ordering::SeqCst)
            {
                if first.websocket && !writer_upgraded.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }
                if !first.websocket && remaining == 0 {
                    return;
                }
                let limit = if first.websocket {
                    CHUNK
                } else {
                    remaining.min(CHUNK)
                };
                match upload.read(&mut buffer[..limit]) {
                    Ok(0) => break,
                    Ok(count) => {
                        if writer_access.call("devServers.bridgeWrite", json!({ "streamId": writer_stream, "data": STANDARD.encode(&buffer[..count]) })).is_err() { break; }
                        if !first.websocket {
                            remaining -= count;
                        }
                        if let Ok(mut touched) = writer_gateway.touched.lock() {
                            *touched = Instant::now();
                        }
                    }
                    Err(error) if timeout(&error) => continue,
                    Err(_) => break,
                }
            }
            writer_done.store(true, Ordering::SeqCst);
            let _ = upload.shutdown(Shutdown::Both);
        });
        let mut failure = None;
        let mut response_headers = Vec::new();
        let mut headers_sent = false;
        while !finished.load(Ordering::SeqCst) && gateway.alive.load(Ordering::SeqCst) {
            match access.call("devServers.bridgeRead", json!({ "streamId": stream })) {
                Ok(value) => {
                    let data = value["data"].as_str().unwrap_or_default();
                    if data.len() > CHUNK.div_ceil(3) * 4 {
                        failure = Some("Host returned too much development server data".into());
                        break;
                    }
                    let bytes = match STANDARD.decode(data) {
                        Ok(bytes) => bytes,
                        Err(_) => {
                            failure = Some("Host returned invalid development server data".into());
                            break;
                        }
                    };
                    if !bytes.is_empty() {
                        if !headers_sent {
                            response_headers.extend_from_slice(&bytes);
                            if let Some(end) = response_headers
                                .windows(4)
                                .position(|value| value == b"\r\n\r\n")
                            {
                                let header = String::from_utf8_lossy(&response_headers[..end]);
                                let switching = header.lines().next().is_some_and(|line| {
                                    line.split_whitespace().nth(1) == Some("101")
                                });
                                if first.websocket && switching {
                                    upgraded.store(true, Ordering::SeqCst);
                                }
                                if first.websocket && !switching {
                                    finished.store(true, Ordering::SeqCst);
                                }
                                let local_origin = format!("http://127.0.0.1:{}", gateway.port);
                                let header = header
                                    .split("\r\n")
                                    .map(|line| {
                                        if let Some((name, value)) = line.split_once(':') {
                                            if name.eq_ignore_ascii_case("location") {
                                                let value = value.trim();
                                                if value == access.target_origin
                                                    || value.starts_with(&format!(
                                                        "{}/",
                                                        access.target_origin
                                                    ))
                                                {
                                                    return format!(
                                                        "{name}: {}",
                                                        value.replacen(
                                                            &access.target_origin,
                                                            &local_origin,
                                                            1
                                                        )
                                                    );
                                                }
                                            }
                                        }
                                        line.to_owned()
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\r\n");
                                if socket
                                    .write_all(header.as_bytes())
                                    .and_then(|_| socket.write_all(b"\r\n\r\n"))
                                    .and_then(|_| socket.write_all(&response_headers[end + 4..]))
                                    .is_err()
                                {
                                    break;
                                }
                                response_headers.clear();
                                headers_sent = true;
                            } else if response_headers.len() > 64 * 1024 {
                                failure = Some(
                                    "Development server response headers are too large".into(),
                                );
                                break;
                            }
                        } else if socket.write_all(&bytes).is_err() {
                            break;
                        }
                        if let Ok(mut touched) = gateway.touched.lock() {
                            *touched = Instant::now();
                        }
                    }
                    if value["ended"].as_bool() == Some(true) {
                        break;
                    }
                }
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        finished.store(true, Ordering::SeqCst);
        let _ = socket.shutdown(Shutdown::Both);
        let _ = writer.join();
        failure.map_or(Ok(()), Err)
    })();
    let _ = access.call("devServers.bridgeClose", json!({ "streamId": stream }));
    result
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn remote_dev_server_url(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    machine_id: String,
    environment_id: String,
    project_id: String,
    server_id: String,
    identity: Value,
    port: u16,
    address: String,
    url: String,
) -> Result<String, String> {
    let mut url = url::Url::parse(&url).map_err(|_| "Invalid development server URL")?;
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(port)
    {
        return Err("Private browser access requires a discovered HTTP development server. Use the host preview for HTTPS.".into());
    }
    let store = store_path(&app)?;
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store)?
            .into_iter()
            .find(|m| m.id == machine_id)
            .ok_or("The owning computer is not connected")?
    };
    if machine.environment_id != environment_id {
        return Err(
            "The owning computer changed. Reconnect this project's original computer.".into(),
        );
    }
    let endpoint = match &machine.ssh {
        Some(target) => {
            state
                .tunnels
                .endpoint(&machine.id, &machine.environment_id, target, true)?
                .endpoint
        }
        None => machine.endpoint.clone(),
    };
    let params = json!({ "projectId": project_id, "id": server_id, "identity": identity, "port": port, "address": address });
    let mut access = Access {
        machine,
        endpoint,
        store,
        params,
        target_origin: String::new(),
    };
    // Repeat discovery on the owner before reusing even an existing local listener.
    let checked = access.call("devServers.bridgeCheck", access.params.clone())?;
    access.target_origin = url::Url::parse(
        checked["url"]
            .as_str()
            .ok_or("The development server has no URL")?,
    )
    .map_err(|_| "The development server URL is invalid")?
    .origin()
    .ascii_serialization();
    // Authentication replacement must never reuse a listener carrying the previous credential.
    let key = json!([
        access.machine.id,
        access.machine.environment_id,
        access.machine.token,
        access.machine.ssh,
        access.endpoint,
        access.params
    ])
    .to_string();
    let mut gateways = GATEWAYS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| "Development server access is unavailable")?;
    gateways.retain(|_, gate| gate.alive.load(Ordering::SeqCst));
    let gateway = if let Some(gateway) = gateways.get(&key) {
        gateway.clone()
    } else {
        if gateways.len() >= 16 {
            return Err("Too many private development server addresses are open. Close unused browser tabs and retry later.".into());
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let gateway = Arc::new(Gateway {
            port: listener.local_addr().map_err(|e| e.to_string())?.port(),
            alive: AtomicBool::new(true),
            active: AtomicUsize::new(0),
            touched: Mutex::new(Instant::now()),
        });
        let running = gateway.clone();
        std::thread::spawn(move || {
            let mut checked = Instant::now();
            loop {
                if checked.elapsed() >= Duration::from_secs(1) {
                    let expired = running
                        .touched
                        .lock()
                        .map(|time| time.elapsed() > IDLE)
                        .unwrap_or(true);
                    if expired || !access.current() {
                        break;
                    }
                    checked = Instant::now();
                }
                match listener.accept() {
                    Ok((socket, _)) => {
                        if running.active.load(Ordering::SeqCst) >= 32 {
                            drop(socket);
                            continue;
                        }
                        running.active.fetch_add(1, Ordering::SeqCst);
                        if let Ok(mut touched) = running.touched.lock() {
                            *touched = Instant::now();
                        }
                        let (access, running) = (access.clone(), running.clone());
                        std::thread::spawn(move || connection(socket, access, running));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(25))
                    }
                    Err(_) => break,
                }
            }
            running.alive.store(false, Ordering::SeqCst);
        });
        gateways.insert(key, gateway.clone());
        gateway
    };
    if let Ok(mut touched) = gateway.touched.lock() {
        *touched = Instant::now();
    }
    url.set_host(Some("127.0.0.1"))
        .map_err(|_| "Invalid local browser address")?;
    url.set_port(Some(gateway.port))
        .map_err(|_| "Invalid local browser port")?;
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::{allowed_headers, browser_request};

    #[test]
    fn admits_navigation_and_same_origin_websockets() {
        assert!(allowed_headers(
            "GET /nested?x=1 HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nSec-Fetch-Site: none",
            4200
        ));
        assert!(allowed_headers("GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nOrigin: http://127.0.0.1:4200\r\nUpgrade: websocket", 4200));
    }

    #[test]
    fn rejects_foreign_origins_dns_rebinding_and_connect() {
        for request in [
            "GET / HTTP/1.1\r\nHost: evil.example:4200",
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nOrigin: https://evil.example",
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nSec-Fetch-Site: cross-site",
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nSec-Fetch-Site: same-site",
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nHost: localhost:4200",
            "CONNECT localhost:3776 HTTP/1.1\r\nHost: 127.0.0.1:4200",
        ] {
            assert!(!allowed_headers(request, 4200), "{request}");
        }
    }

    #[test]
    fn forces_one_http_request_and_rewrites_the_owner_origin() {
        let request = b"POST /api HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nOrigin: http://127.0.0.1:4200\r\nConnection: keep-alive\r\nContent-Length: 5\r\n\r\nhel";
        let end = request
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
            .unwrap();
        let parsed = browser_request(request, end, 4200, "http://127.0.0.1:5173").unwrap();
        let headers = String::from_utf8(parsed.data).unwrap();
        assert!(headers.contains("Host: 127.0.0.1:5173\r\n"));
        assert!(headers.contains("Origin: http://127.0.0.1:5173\r\n"));
        assert!(headers.contains("Connection: close\r\n"));
        assert!(!headers.contains("keep-alive"));
        assert_eq!(parsed.remaining, 2);
        assert!(!parsed.websocket);
    }

    #[test]
    fn rejects_pipelining_and_ambiguous_body_framing() {
        for body in [
            "GET / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\n\r\nGET /second HTTP/1.1\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nContent-Length: 0\r\nContent-Length: 5\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nTransfer-Encoding: chunked\r\n\r\n",
            "POST / HTTP/1.1\r\nHost: 127.0.0.1:4200\r\nContent-Length: +5\r\n\r\n",
        ] {
            let end = body.as_bytes().windows(4).position(|part| part == b"\r\n\r\n").unwrap();
            assert!(browser_request(body.as_bytes(), end, 4200, "http://127.0.0.1:5173").is_err());
        }
    }
}
