//! Stable, session-scoped loopback transport for provider tools. Host bearer
//! grants may expire or disappear on restart; neither they nor owner credentials
//! are delivered to the renderer. Only an explicit pre-dispatch auth rejection
//! permits renewal and one retry. Ambiguous outcomes are never replayed.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc, Mutex, OnceLock,
};
use std::time::Duration;
use tauri::AppHandle;

const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_RESPONSE: u64 = 16 * 1024 * 1024;
const AUTH_STAGE: &str = "X-Bycoda-Auth-Stage";
// Three stdio groups each admit four normal calls. Preserve room in the Host's
//16active MCP slots for cancellation and unrelated callers.
const NORMAL_LIMIT: usize = 12;

#[derive(Default)]
struct Capacity {
    normal: AtomicUsize,
    cancellations: AtomicUsize,
}
struct Admission {
    capacity: Arc<Capacity>,
    cancellation: bool,
}
impl Drop for Admission {
    fn drop(&mut self) {
        self.capacity
            .counter(self.cancellation)
            .fetch_sub(1, Ordering::Release);
    }
}
impl Capacity {
    fn counter(&self, cancellation: bool) -> &AtomicUsize {
        if cancellation {
            &self.cancellations
        } else {
            &self.normal
        }
    }
    fn admit(self: &Arc<Self>, cancellation: bool) -> Option<Admission> {
        let limit = if cancellation { 2 } else { NORMAL_LIMIT };
        let counter = self.counter(cancellation);
        let mut used = counter.load(Ordering::Acquire);
        loop {
            if used >= limit {
                return None;
            }
            match counter.compare_exchange_weak(used, used + 1, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => {
                    return Some(Admission {
                        capacity: self.clone(),
                        cancellation,
                    })
                }
                Err(current) => used = current,
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Group {
    Conversation,
    RuntimeLogs,
    Social,
}
impl Group {
    fn path(self) -> &'static str {
        match self {
            Self::Conversation => "conversation",
            Self::RuntimeLogs => "runtime-logs",
            Self::Social => "social",
        }
    }
    fn method(self) -> &'static str {
        match self {
            Self::Conversation => "conversation.tools.call",
            Self::RuntimeLogs => "runtimeLogs.tools.call",
            Self::Social => "social.tools.call",
        }
    }
    fn issue(self, app: &AppHandle, params: Value) -> Result<Value, String> {
        match self {
            Self::Conversation => {
                crate::remote::local_conversation_rpc(app, "conversation.access.issue", params)
            }
            Self::RuntimeLogs => {
                crate::remote::local_runtime_logs_rpc(app, "runtimeLogs.access.issue", params)
            }
            Self::Social => crate::remote::local_social_rpc(app, "social.access.issue", params),
        }
    }
}
type Renew = dyn Fn(Value) -> Result<Value, String> + Send + Sync;
struct Route {
    session: String,
    group: Group,
    endpoint: String,
    environment: String,
    scope: Value,
    current: Mutex<Value>,
    renew: Box<Renew>,
    alive: AtomicBool,
}
impl Route {
    fn token(&self) -> Result<String, String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Session tool connection closed".into());
        }
        self.current
            .lock()
            .map_err(|_| "Tool credential unavailable")?["token"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Tool credential unavailable".into())
    }
    fn renew_after(&self, rejected: &str) -> Result<String, String> {
        // The mutex deduplicates concurrent rejection recovery, never normal calls.
        let mut current = self
            .current
            .lock()
            .map_err(|_| "Tool credential unavailable")?;
        if !self.alive.load(Ordering::Acquire) {
            return Err("Session tool connection closed".into());
        }
        if current["token"].as_str() != Some(rejected) {
            return current["token"]
                .as_str()
                .map(str::to_owned)
                .ok_or("Tool credential unavailable".into());
        }
        if !valid_scope(&self.scope) {
            return Err("Reconnect tools with an updated Host".into());
        }
        let renewed = (self.renew)(
            json!({"sessionId": self.scope["sessionId"], "expectedScope": self.scope}),
        )?;
        if !self.alive.load(Ordering::Acquire)
            || renewed["scope"] != self.scope
            || renewed["environmentId"].as_str() != Some(&self.environment)
            || renewed["endpoint"].as_str() != Some(&self.endpoint)
            || renewed["token"].as_str().is_none()
        {
            return Err("Session tool authority changed; reconnect the conversation".into());
        }
        let token = renewed["token"].as_str().unwrap().to_owned();
        *current = renewed;
        Ok(token)
    }
}
#[derive(Default)]
struct Registry {
    routes: HashMap<String, Arc<Route>>,
    sessions: HashMap<String, (u64, u64)>,
    capacity: Arc<Capacity>,
}
impl Registry {
    fn current(&self, session: &str, stamp: (u64, u64)) -> bool {
        self.sessions.get(session) == Some(&stamp)
    }
    fn begin(&mut self, session: &str, stamp: (u64, u64)) {
        if self.current(session, stamp) {
            return;
        }
        remove_session(self, session);
        if self.sessions.len() < 1024 {
            self.sessions.insert(session.into(), stamp);
        }
    }
    fn revoke_spawn(&mut self, session: &str, stamp: (u64, u64)) {
        if self.current(session, stamp) {
            remove_session(self, session);
        }
    }
    fn cache(
        &self,
        session: &str,
        stamp: (u64, u64),
        cache: &Mutex<HashMap<String, Value>>,
        grant: Value,
    ) {
        if self.current(session, stamp) {
            if let Ok(mut map) = cache.lock() {
                map.insert(session.into(), grant);
            }
        }
    }
}
struct Broker {
    port: u16,
    registry: Arc<Mutex<Registry>>,
}
static BROKER: OnceLock<Result<Broker, String>> = OnceLock::new();

fn broker() -> Result<&'static Broker, String> {
    BROKER
        .get_or_init(|| {
            let listener = TcpListener::bind("127.0.0.1:0")
                .map_err(|_| "Session tool listener unavailable")?;
            let port = listener
                .local_addr()
                .map_err(|_| "Session tool address unavailable")?
                .port();
            let registry = Arc::new(Mutex::new(Registry::default()));
            let state = registry.clone();
            std::thread::spawn(move || {
                let (tx, rx) = mpsc::sync_channel::<TcpStream>(16);
                let rx = Arc::new(Mutex::new(rx));
                //12normal upstream calls and2reserved cancellations leave
                // readers available to reject overload and admit cancellation.
                for _ in 0..24 {
                    let rx = rx.clone();
                    let state = state.clone();
                    std::thread::spawn(move || loop {
                        let socket = match rx.lock() {
                            Ok(rx) => rx.recv(),
                            Err(_) => return,
                        };
                        let Ok(socket) = socket else { return };
                        serve(socket, port, &state);
                    });
                }
                for socket in listener.incoming().flatten() {
                    let _ = tx.try_send(socket);
                }
            });
            Ok(Broker { port, registry })
        })
        .as_ref()
        .map_err(Clone::clone)
}
fn valid_scope(scope: &Value) -> bool {
    scope.as_object().is_some_and(|object| {
        object.len() == 4
            && ["sessionId", "projectId", "provider", "environmentId"]
                .iter()
                .all(|key| {
                    object
                        .get(*key)
                        .and_then(Value::as_str)
                        .is_some_and(|v| !v.is_empty())
                })
    })
}
fn upstream(endpoint: &str) -> bool {
    url::Url::parse(endpoint).is_ok_and(|url| {
        (url.scheme() == "https"
            || (url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port().is_some()))
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
    })
}
pub(crate) fn metadata(mut value: Value, group: Group) -> Value {
    // Public executable metadata can be obtained before configure_child. The
    // capability is installed only in native configure_child, never here.
    if !value["mcpUrl"].is_string() {
        return value;
    }
    if let Ok(broker) = broker() {
        value["mcpUrl"] = json!(format!(
            "http://127.0.0.1:{}/mcp/{}",
            broker.port,
            group.path()
        ));
    } else if let Some(object) = value.as_object_mut() {
        object.remove("mcpUrl");
    }
    value
}
pub(crate) fn redaction_tokens(command: &std::process::Command) -> Vec<String> {
    command
        .get_envs()
        .filter_map(|(key, value)| {
            if matches!(
                key.to_str(),
                Some(
                    "BYCODA_CONVERSATION_TOKEN"
                        | "BYCODA_RUNTIME_LOGS_TOKEN"
                        | "BYCODA_SOCIAL_TOKEN"
                        | "BYCODA_APP_TOKEN"
                        | "BYCODA_CONTROL_TOKEN"
                )
            ) {
                value
                    .map(|value| value.to_string_lossy().into_owned())
                    .filter(|value| !value.is_empty())
            } else {
                None
            }
        })
        .collect()
}
pub(crate) fn redact_lines(tokens: &[String], lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| {
            tokens.iter().fold(line, |line, token| {
                line.replace(token, "[session tool credential redacted]")
            })
        })
        .collect()
}
pub(crate) fn register(
    app: &AppHandle,
    session: &str,
    stamp: (u64, u64),
    group: Group,
    mut grant: Value,
) -> Result<Value, String> {
    let endpoint = grant["endpoint"]
        .as_str()
        .filter(|value| upstream(value))
        .ok_or("Local Host endpoint required")?
        .to_owned();
    let environment = grant["environmentId"]
        .as_str()
        .ok_or("Host environment required")?
        .to_owned();
    if grant["token"].as_str().is_none() {
        return Err("Scoped tool credential required".into());
    }
    let broker = broker()?;
    let app = app.clone();
    let route = Arc::new(Route {
        session: session.into(),
        group,
        endpoint,
        environment,
        scope: grant["scope"].clone(),
        current: Mutex::new(grant.clone()),
        renew: Box::new(move |params| group.issue(&app, params)),
        alive: AtomicBool::new(true),
    });
    let capability = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let mut registry = broker
        .registry
        .lock()
        .map_err(|_| "Session tool listener unavailable")?;
    if !registry.current(session, stamp) {
        return Err("Session spawn cancelled".into());
    }
    registry.routes.retain(|_, old| {
        let keep = old.session != session || old.group != group;
        if !keep {
            old.alive.store(false, Ordering::Release);
        }
        keep
    });
    if registry.routes.len() >= 1024 {
        return Err("Too many session tool connections".into());
    }
    registry.routes.insert(capability.clone(), route);
    grant["token"] = json!(capability);
    grant["endpoint"] = json!(format!("http://127.0.0.1:{}", broker.port));
    Ok(grant)
}
pub(crate) fn begin_session(session: &str, stamp: (u64, u64)) {
    if let Ok(broker) = broker() {
        if let Ok(mut registry) = broker.registry.lock() {
            registry.begin(session, stamp);
        }
    }
}
pub(crate) struct SpawnGuard {
    session: String,
    stamp: (u64, u64),
    armed: bool,
}
impl SpawnGuard {
    pub(crate) fn new(session: &str, stamp: (u64, u64)) -> Self {
        Self {
            session: session.into(),
            stamp,
            armed: true,
        }
    }
    pub(crate) fn disarm(&mut self) {
        self.armed = false;
    }
}
impl Drop for SpawnGuard {
    fn drop(&mut self) {
        if self.armed {
            revoke_spawn(&self.session, self.stamp);
        }
    }
}
pub(crate) fn revoke_spawn(session: &str, stamp: (u64, u64)) {
    if let Some(Ok(broker)) = BROKER.get() {
        if let Ok(mut registry) = broker.registry.lock() {
            registry.revoke_spawn(session, stamp);
        }
    }
}
fn clear_caches(session: Option<&str>) {
    crate::conversation_tools_bridge::clear_grants(session);
    crate::runtime_logs_bridge::clear_grants(session);
    crate::social_bridge::clear_grants(session);
}
fn remove_session(registry: &mut Registry, session: &str) {
    registry.sessions.remove(session);
    registry.routes.retain(|_, route| {
        let keep = route.session != session;
        if !keep {
            route.alive.store(false, Ordering::Release);
        }
        keep
    });
    clear_caches(Some(session));
}
pub(crate) fn cache_grant(
    session: &str,
    stamp: (u64, u64),
    cache: &Mutex<HashMap<String, Value>>,
    grant: Value,
) {
    if let Some(Ok(broker)) = BROKER.get() {
        if let Ok(registry) = broker.registry.lock() {
            registry.cache(session, stamp, cache, grant);
        }
    }
}
pub(crate) fn revoke_session(session: &str) {
    if let Some(Ok(broker)) = BROKER.get() {
        if let Ok(mut registry) = broker.registry.lock() {
            remove_session(&mut registry, session);
        }
    }
}
pub(crate) fn revoke_all() {
    if let Some(Ok(broker)) = BROKER.get() {
        if let Ok(mut registry) = broker.registry.lock() {
            for route in registry.routes.values() {
                route.alive.store(false, Ordering::Release);
            }
            registry.routes.clear();
            registry.sessions.clear();
            clear_caches(None);
        }
    }
}

struct Request {
    path: String,
    token: String,
    length: usize,
    protocol: Option<String>,
}
fn request(header: &str, port: u16) -> Result<Request, String> {
    let mut lines = header.split("\r\n");
    let parts: Vec<_> = lines.next().ok_or("Invalid request")?.split(' ').collect();
    if parts.len() != 3
        || parts[0] != "POST"
        || !matches!(parts[2], "HTTP/1.0" | "HTTP/1.1")
        || !matches!(
            parts[1],
            "/rpc" | "/mcp/conversation" | "/mcp/runtime-logs" | "/mcp/social"
        )
    {
        return Err("Unsupported tool request".into());
    }
    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').ok_or("Invalid headers")?;
        if key.is_empty()
            || key.bytes().any(|b| !b.is_ascii_alphanumeric() && b != b'-')
            || value.chars().any(|c| c.is_control() && c != '\t')
            || headers
                .insert(key.to_ascii_lowercase(), value.trim().to_owned())
                .is_some()
        {
            return Err("Invalid headers".into());
        }
    }
    let origin = format!("http://127.0.0.1:{port}");
    if headers.get("host") != Some(&format!("127.0.0.1:{port}"))
        || headers.contains_key("transfer-encoding")
        || headers.contains_key("expect")
        || headers.get("origin").is_some_and(|v| v != &origin)
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| !matches!(v.as_str(), "none" | "same-origin"))
        || !headers
            .get("content-type")
            .is_some_and(|v| v.split(';').next() == Some("application/json"))
    {
        return Err("Unsupported tool origin or framing".into());
    }
    let length = headers
        .get("content-length")
        .filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v <= MAX_BODY)
        .ok_or("Invalid body length")?;
    let token = headers
        .get("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Tool credential required")?
        .to_owned();
    Ok(Request {
        path: parts[1].into(),
        token,
        length,
        protocol: headers.remove("mcp-protocol-version"),
    })
}
fn validate_body(route: &Route, request: &Request, body: &[u8]) -> Result<(), String> {
    let value: Value = serde_json::from_slice(body).map_err(|_| "Invalid tool request")?;
    if !value.is_object() {
        return Err("Invalid tool request".into());
    }
    if request.path == "/rpc" {
        if value["version"] != 1
            || value["environmentId"].as_str() != Some(&route.environment)
            || value["method"].as_str() != Some(route.group.method())
            || !value["params"].is_object()
        {
            return Err("Tool scope mismatch".into());
        }
    } else if request.path != format!("/mcp/{}", route.group.path())
        || value["jsonrpc"] != "2.0"
        || value["method"].as_str().is_none()
    {
        return Err("Tool scope mismatch".into());
    }
    Ok(())
}
struct Reply {
    status: u16,
    body: Vec<u8>,
    before_dispatch: bool,
}
fn forward(route: &Route, request: &Request, body: &[u8], token: &str) -> Result<Reply, String> {
    if !route.alive.load(Ordering::Acquire) {
        return Err("Session tool connection closed".into());
    }
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(Duration::from_secs(250))
        .build();
    let mut call = agent
        .post(&format!(
            "{}{}",
            route.endpoint.trim_end_matches('/'),
            request.path
        ))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream");
    if let Some(protocol) = &request.protocol {
        call = call.set("MCP-Protocol-Version", protocol);
    }
    let response = match call.send_bytes(body) {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(_) => return Err("Tool response unavailable; delivery may be uncertain".into()),
    };
    let status = response.status();
    let before_dispatch = status == 401 && response.header(AUTH_STAGE) == Some("before-dispatch");
    let mut result = Vec::new();
    response
        .into_reader()
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut result)
        .map_err(|_| "Tool response interrupted; delivery may be uncertain")?;
    if result.len() as u64 > MAX_RESPONSE {
        return Err("Tool response too large; delivery may be uncertain".into());
    }
    if !route.alive.load(Ordering::Acquire) {
        return Err("Session tool connection closed".into());
    }
    // Never forward Host bearer material in diagnostic error text.
    let result = String::from_utf8(result)
        .map_err(|_| "Invalid tool response")?
        .replace(token, "[tool credential redacted]")
        .into_bytes();
    Ok(Reply {
        status,
        body: result,
        before_dispatch,
    })
}
fn dispatch(route: &Route, request: &Request, body: &[u8]) -> Result<Reply, String> {
    validate_body(route, request, body)?;
    let token = route.token()?;
    let first = forward(route, request, body, &token)?;
    if !first.before_dispatch {
        return Ok(first);
    }
    let renewed = route.renew_after(&token)?;
    // Exactly one retry, and only after a server assertion that no dispatch ran.
    forward(route, request, body, &renewed)
}
fn serve(mut socket: TcpStream, port: u16, registry: &Mutex<Registry>) {
    let _ = socket.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = socket.set_write_timeout(Some(Duration::from_secs(5)));
    let mut authority: Option<Arc<Route>> = None;
    let mut _admission = None;
    let result = (|| -> Result<Reply, String> {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 8192];
        let end = loop {
            if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                break end;
            }
            if bytes.len() > 16 * 1024 {
                return Err("Tool headers too large".into());
            }
            let read = socket
                .read(&mut chunk)
                .map_err(|_| "Invalid tool request")?;
            if read == 0 {
                return Err("Incomplete tool request".into());
            }
            bytes.extend_from_slice(&chunk[..read]);
        };
        if end > 16 * 1024 {
            return Err("Tool headers too large".into());
        }
        let request = request(
            std::str::from_utf8(&bytes[..end]).map_err(|_| "Invalid tool headers")?,
            port,
        )?;
        let (route, capacity) = {
            let registry = registry.lock().map_err(|_| "Tool service unavailable")?;
            (
                registry
                    .routes
                    .get(&request.token)
                    .cloned()
                    .ok_or("Session tool credential revoked")?,
                registry.capacity.clone(),
            )
        };
        authority = Some(route.clone());
        if route.group != Group::Conversation && request.length > 1024 * 1024 {
            return Err("Tool body too large".into());
        }
        let mut body = bytes.split_off(end + 4);
        if body.len() > request.length {
            return Err("Pipelined tool requests are unsupported".into());
        }
        while body.len() < request.length {
            let remaining = (request.length - body.len()).min(chunk.len());
            let read = socket
                .read(&mut chunk[..remaining])
                .map_err(|_| "Incomplete tool body")?;
            if read == 0 {
                return Err("Incomplete tool body".into());
            }
            body.extend_from_slice(&chunk[..read]);
        }
        validate_body(&route, &request, &body)?;
        let cancellation = request.path != "/rpc"
            && serde_json::from_slice::<Value>(&body)
                .is_ok_and(|value| value["method"] == "notifications/cancelled");
        let Some(admission) = capacity.admit(cancellation) else {
            return Ok(Reply {
                status: 429,
                body: br#"{"error":"Session tool request limit exceeded"}"#.to_vec(),
                before_dispatch: false,
            });
        };
        _admission = Some(admission);
        dispatch(&route, &request, &body)
    })();
    let result = result.and_then(|reply| {
        if authority
            .as_ref()
            .is_some_and(|route| route.alive.load(Ordering::Acquire))
        {
            Ok(reply)
        } else {
            Err("Session tool connection closed".into())
        }
    });
    let reply = result.unwrap_or_else(|_| Reply { status: 502, body: br#"{"error":"Session tools unavailable. Reconnect the conversation; do not repeat an uncertain write."}"#.to_vec(), before_dispatch: false });
    let _ = write!(socket, "HTTP/1.1 {} Tool Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", reply.status, reply.body.len());
    let _ = socket.write_all(&reply.body);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::thread;

    fn scope() -> Value {
        json!({"sessionId":"session", "projectId":"project", "provider":"codex", "environmentId":"environment"})
    }
    fn grant(endpoint: &str, token: &str) -> Value {
        json!({"token":token,"endpoint":endpoint,"environmentId":"environment","scope":scope()})
    }
    fn route(
        endpoint: &str,
        group: Group,
        renew: impl Fn(Value) -> Result<Value, String> + Send + Sync + 'static,
    ) -> Arc<Route> {
        Arc::new(Route {
            session: "session".into(),
            group,
            endpoint: endpoint.into(),
            environment: "environment".into(),
            scope: scope(),
            current: Mutex::new(grant(endpoint, "old")),
            renew: Box::new(renew),
            alive: AtomicBool::new(true),
        })
    }
    fn query(group: Group, mcp: bool) -> (Request, Vec<u8>) {
        let request = Request {
            path: if mcp {
                format!("/mcp/{}", group.path())
            } else {
                "/rpc".into()
            },
            token: "a".repeat(64),
            length: 0,
            protocol: None,
        };
        let body = if mcp {
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fixture_mutation","arguments":{}}})
        } else {
            json!({"version":1,"environmentId":"environment","method":group.method(),"params":{"action":"fixture.mutation","input":{}}})
        };
        (request, serde_json::to_vec(&body).unwrap())
    }
    fn via_listener(route: Arc<Route>, request: &Request, body: &[u8]) -> u16 {
        let (status, result) =
            via_listener_response(route, request, body, Arc::new(Capacity::default()));
        assert_eq!(result, r#"{"result":{"ok":true}}"#);
        status
    }
    fn via_listener_response(
        route: Arc<Route>,
        request: &Request,
        body: &[u8],
        capacity: Arc<Capacity>,
    ) -> (u16, String) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let capability = "a".repeat(64);
        let registry = Mutex::new(Registry {
            routes: HashMap::from([(capability.clone(), route)]),
            sessions: HashMap::new(),
            capacity,
        });
        let server = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            serve(socket, port, &registry);
        });
        let result = ureq::post(&format!("http://127.0.0.1:{port}{}", request.path))
            .timeout(Duration::from_secs(5))
            .set("Authorization", &format!("Bearer {capability}"))
            .set("Content-Type", "application/json")
            .send_bytes(body);
        let result = match result {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(error) => panic!("fixture request failed: {error}"),
        };
        let status = result.status();
        let body = result.into_string().unwrap();
        server.join().unwrap();
        (status, body)
    }
    // A real TCP upstream, with a bounded accept loop so a missing retry fails
    // instead of leaving a hanging fixture. The body is fully consumed.
    type SeenRequests = Vec<(String, Vec<u8>)>;
    fn host(replies: Vec<(u16, bool)>) -> (String, thread::JoinHandle<SeenRequests>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let join = thread::spawn(move || {
            let mut seen = Vec::new();
            for (status, marker) in replies {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((s, _)) => break s,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(2))
                        }
                        Err(error) => panic!("fixture accept failed: {error}"),
                    }
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0u8; 8192];
                let end = loop {
                    if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                        break end;
                    }
                    let n = socket.read(&mut chunk).unwrap();
                    assert_ne!(n, 0);
                    bytes.extend_from_slice(&chunk[..n]);
                };
                let header = String::from_utf8(bytes[..end].to_vec()).unwrap();
                let length = header
                    .split("\r\n")
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                let mut body = bytes.split_off(end + 4);
                while body.len() < length {
                    let n = socket.read(&mut chunk).unwrap();
                    assert_ne!(n, 0);
                    body.extend_from_slice(&chunk[..n]);
                }
                seen.push((header, body));
                let response = if status == 200 {
                    r#"{"result":{"ok":true}}"#
                } else {
                    r#"{"error":"fixture"}"#
                };
                write!(socket,"HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n{}\r\n{response}",response.len(),if marker {"X-Bycoda-Auth-Stage: before-dispatch\r\n"} else {""}).unwrap();
            }
            seen
        });
        (endpoint, join)
    }
    #[test]
    fn recovers_all_groups_and_transports_after_explicit_pre_dispatch_auth_rejection() {
        for group in [Group::Conversation, Group::RuntimeLogs, Group::Social] {
            for mcp in [false, true] {
                let (endpoint, host) = host(vec![(401, true), (200, false)]);
                let renewals = Arc::new(AtomicUsize::new(0));
                let count = renewals.clone();
                let address = endpoint.clone();
                let route = route(&endpoint, group, move |params| {
                    assert_eq!(
                        params,
                        json!({"sessionId":"session","expectedScope":scope()})
                    );
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok(grant(&address, "new"))
                });
                let (request, body) = query(group, mcp);
                assert_eq!(via_listener(route, &request, &body), 200);
                let seen = host.join().unwrap();
                assert_eq!(seen.len(), 2);
                assert_eq!(seen[0].1, seen[1].1);
                assert!(seen[0].0.contains("Bearer old"));
                assert!(seen[1].0.contains("Bearer new"));
                assert_eq!(renewals.load(Ordering::SeqCst), 1);
            }
        }
    }
    #[test]
    fn never_replays_a_committed_mutation_with_bare_401_or_server_error() {
        for status in [401, 500] {
            let (endpoint, host) = host(vec![(status, false)]);
            let route = route(&endpoint, Group::Conversation, |_| {
                panic!("ambiguous mutation must not renew")
            });
            let (request, body) = query(Group::Conversation, true);
            assert_eq!(dispatch(&route, &request, &body).unwrap().status, status);
            // The fixture regards receipt of tools/call as its committed effect.
            assert_eq!(host.join().unwrap().len(), 1);
        }
    }
    #[test]
    fn never_replays_a_network_failure_or_a_second_auth_rejection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let route = route(&endpoint, Group::Conversation, |_| {
            panic!("transport ambiguity must not renew")
        });
        let (request, body) = query(Group::Conversation, false);
        assert!(dispatch(&route, &request, &body).is_err());
        let (endpoint, host) = host(vec![(401, true), (401, true)]);
        let address = endpoint.clone();
        let route = super::tests::route(&endpoint, Group::Conversation, move |_| {
            Ok(grant(&address, "new"))
        });
        assert_eq!(dispatch(&route, &request, &body).unwrap().status, 401);
        assert_eq!(host.join().unwrap().len(), 2);
    }
    #[test]
    fn deduplicates_concurrent_renewal_and_rejects_revocation_and_scope_changes() {
        let count = Arc::new(AtomicUsize::new(0));
        let used = count.clone();
        let route = route("http://127.0.0.1:1", Group::Conversation, move |_| {
            used.fetch_add(1, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(15));
            Ok(grant("http://127.0.0.1:1", "new"))
        });
        let jobs: Vec<_> = (0..8)
            .map(|_| {
                let route = route.clone();
                thread::spawn(move || route.renew_after("old").unwrap())
            })
            .collect();
        for job in jobs {
            assert_eq!(job.join().unwrap(), "new");
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
        route.alive.store(false, Ordering::Release);
        assert!(route.token().is_err());
        assert!(route.renew_after("new").is_err());
        for field in ["sessionId", "projectId", "provider", "environmentId"] {
            let route = super::tests::route("http://127.0.0.1:1", Group::Conversation, move |_| {
                let mut next = grant("http://127.0.0.1:1", "new");
                next["scope"][field] = json!("changed");
                Ok(next)
            });
            assert!(route.renew_after("old").is_err());
            assert_eq!(route.token().unwrap(), "old");
        }
        let route = super::tests::route("http://127.0.0.1:1", Group::Conversation, |_| {
            Err("Owner revoked".into())
        });
        assert!(route.renew_after("old").is_err());
    }
    #[test]
    fn rejects_cross_group_rpc_body_origin_and_http_framing_attacks() {
        let header=format!("POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nContent-Type: application/json\r\nContent-Length: 0\r\nAuthorization: Bearer {}", "a".repeat(64));
        assert!(request(&header, 1234).is_ok());
        for extra in [
            "\r\nHost: 127.0.0.1:1234",
            "\r\nTransfer-Encoding: chunked",
            "\r\nContent-Length: 1",
            "\r\nOrigin: https://evil.example",
            "\r\nSec-Fetch-Site: cross-site",
        ] {
            assert!(request(&format!("{header}{extra}"), 1234).is_err());
        }
        assert!(request(&header.replace("/rpc", "/rpc?target=remote"), 1234).is_err());
        assert!(request(
            &header.replace("Content-Length: 0", "Content-Length: +0"),
            1234
        )
        .is_err());
        let route = route("http://127.0.0.1:1", Group::Conversation, |_| panic!());
        let (request, body) = query(Group::Social, false);
        assert!(validate_body(&route, &request, &body).is_err());
        let (request, body) = query(Group::Social, true);
        assert!(validate_body(&route, &request, &body).is_err());
        let (request, body) = query(Group::Conversation, false);
        let mut value: Value = serde_json::from_slice(&body).unwrap();
        value["method"] = json!("conversation.access.issue");
        assert!(validate_body(&route, &request, &serde_json::to_vec(&value).unwrap()).is_err());
        value["method"] = json!(Group::Conversation.method());
        value["environmentId"] = json!("foreign");
        assert!(validate_body(&route, &request, &serde_json::to_vec(&value).unwrap()).is_err());
        assert!(!upstream("http://evil.example:3776"));
        assert!(!upstream("http://127.0.0.1:3776/override"));
    }
    #[test]
    fn stale_spawn_cannot_repopulate_replacement_cache_or_revoke_replacement() {
        let session = format!("fixture-{}", uuid::Uuid::new_v4());
        let cache = Mutex::new(HashMap::new());
        let mut registry = Registry::default();
        registry.begin(&session, (1, 0));
        let previous = route("http://127.0.0.1:1", Group::Conversation, |_| panic!());
        let previous = Arc::new(Route {
            session: session.clone(),
            ..Arc::try_unwrap(previous).ok().unwrap()
        });
        registry
            .routes
            .insert("stale-capability".into(), previous.clone());
        registry.begin(&session, (2, 0));
        assert!(!previous.alive.load(Ordering::Acquire));
        assert!(!registry.routes.contains_key("stale-capability"));
        registry.cache(&session, (1, 0), &cache, json!({"token":"old"}));
        assert!(cache.lock().unwrap().is_empty());
        registry.revoke_spawn(&session, (1, 0));
        registry.cache(&session, (2, 0), &cache, json!({"token":"new"}));
        assert_eq!(cache.lock().unwrap()[&session]["token"], "new");
        registry.revoke_spawn(&session, (2, 0));
        assert!(!registry.sessions.contains_key(&session));
        // A configure/spawn error is handled by the same guarded revocation.
        registry.begin(&session, (3, 0));
        registry.revoke_spawn(&session, (3, 0));
        assert!(!registry.current(&session, (3, 0)));
    }
    #[test]
    fn keeps_delegated_stdio_metadata_and_captures_redaction_for_final_output_drain() {
        let delegated = json!({"command":"node","args":["social-mcp"]});
        assert_eq!(metadata(delegated.clone(), Group::Social), delegated);
        let mut command = std::process::Command::new("fixture");
        for key in [
            "BYCODA_SOCIAL_TOKEN",
            "BYCODA_RUNTIME_LOGS_TOKEN",
            "BYCODA_CONVERSATION_TOKEN",
            "BYCODA_APP_TOKEN",
            "BYCODA_CONTROL_TOKEN",
        ] {
            command.env(key, format!("secret-{key}"));
        }
        command.env("KEEP", "ordinary-value");
        let snapshot = redaction_tokens(&command);
        drop(command);
        let redacted = redact_lines(
            &snapshot,
            vec![format!("{} ordinary-value", snapshot.join(" "))],
        );
        assert!(!redacted[0].contains("secret-"));
        assert!(redacted[0].contains("ordinary-value"));
    }
    #[test]
    fn revocation_during_upstream_response_suppresses_result_without_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let upstream = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = [0u8; 8192];
            assert_ne!(socket.read(&mut bytes).unwrap(), 0);
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            let response = r#"{"result":{"private":"must not be delivered"}}"#;
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
        });
        let route = route(&endpoint, Group::Conversation, |_| {
            panic!("revoked result must not renew")
        });
        let client_route = route.clone();
        let client = thread::spawn(move || {
            let (request, body) = query(Group::Conversation, true);
            via_listener_response(client_route, &request, &body, Arc::new(Capacity::default()))
        });
        entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        route.alive.store(false, Ordering::Release);
        release_tx.send(()).unwrap();
        let (status, body) = client.join().unwrap();
        upstream.join().unwrap();
        assert_eq!(status, 502);
        assert!(!body.contains("private"));
        assert!(!body.contains("must not be delivered"));
    }
    #[test]
    fn saturated_normal_calls_leave_reserved_cancellation_capacity() {
        let capacity = Arc::new(Capacity::default());
        let held: Vec<_> = (0..NORMAL_LIMIT)
            .map(|_| capacity.admit(false).unwrap())
            .collect();
        assert!(capacity.admit(false).is_none());
        assert_eq!(capacity.normal.load(Ordering::Acquire), NORMAL_LIMIT);
        let (endpoint, upstream) = host(vec![(200, false)]);
        let route = route(&endpoint, Group::Conversation, |_| panic!());
        let (request, body) = query(Group::Conversation, true);
        assert_eq!(
            via_listener_response(route.clone(), &request, &body, capacity.clone()).0,
            429
        );
        let cancellation = serde_json::to_vec(
            &json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}),
        )
        .unwrap();
        assert_eq!(
            via_listener_response(route, &request, &cancellation, capacity.clone()).0,
            200
        );
        assert_eq!(upstream.join().unwrap().len(), 1);
        let cancellations: Vec<_> = (0..2).map(|_| capacity.admit(true).unwrap()).collect();
        assert!(capacity.admit(true).is_none());
        assert_eq!(capacity.cancellations.load(Ordering::Acquire), 2);
        drop(cancellations);
        drop(held);
        assert_eq!(capacity.cancellations.load(Ordering::Acquire), 0);
        assert_eq!(capacity.normal.load(Ordering::Acquire), 0);
    }
}
