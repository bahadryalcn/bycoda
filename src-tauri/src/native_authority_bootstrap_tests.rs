use super::*;
use std::io::Write;
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

const SECRET: &str = "nativeBootstrapFixtureSecret0123456789";
const NONCE: &str = "11111111-1111-4111-8111-111111111111";
const PROFILE: &str = "22222222-2222-4222-8222-222222222222";
const EPOCH: &str = "33333333-3333-4333-8333-333333333333";
const ASSOCIATION: &str = "44444444-4444-4444-8444-444444444444";

type Reply = (u16, Vec<u8>, Option<String>);

struct Fixture {
    directory: PathBuf,
    stop: Arc<AtomicBool>,
    requests: Arc<Mutex<Vec<String>>>,
    replies: Arc<Mutex<std::collections::VecDeque<Reply>>>,
    thread: Option<std::thread::JoinHandle<()>>,
    port: u16,
}
impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("bycoda-native-bootstrap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let replies = Arc::new(Mutex::new(std::collections::VecDeque::<(
            u16,
            Vec<u8>,
            Option<String>,
        )>::new()));
        let thread = {
            let stop = stop.clone();
            let requests = requests.clone();
            let replies = replies.clone();
            std::thread::spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    let (mut socket, _) = match listener.accept() {
                        Ok(value) => value,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(1));
                            continue;
                        }
                        Err(_) => break,
                    };
                    // Windows accept inherits the listener's nonblocking mode.
                    // Polling accept must not turn a fragmented body into EOF.
                    socket.set_nonblocking(false).unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut bytes = Vec::new();
                    let mut chunk = [0u8; 2048];
                    loop {
                        let size = socket
                            .read(&mut chunk)
                            .expect("fixture request read failed");
                        if size == 0 {
                            break;
                        }
                        bytes.extend_from_slice(&chunk[..size]);
                        assert!(bytes.len() <= 16 * 1024);
                        let Some(boundary) = bytes.windows(4).position(|part| part == b"\r\n\r\n")
                        else {
                            continue;
                        };
                        let headers = String::from_utf8_lossy(&bytes[..boundary]);
                        let content_length: usize = headers
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= boundary + 4 + content_length {
                            break;
                        }
                    }
                    requests
                        .lock()
                        .unwrap()
                        .push(String::from_utf8(bytes).unwrap());
                    let (status, body, location) =
                        replies
                            .lock()
                            .unwrap()
                            .pop_front()
                            .unwrap_or((500, Vec::new(), None));
                    let location = location
                        .map(|value| format!("Location: {value}\r\n"))
                        .unwrap_or_default();
                    let header = format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n{location}\r\n", body.len());
                    let _ = socket.write_all(header.as_bytes());
                    let _ = socket.write_all(&body);
                }
            })
        };
        let value = Self {
            directory,
            stop,
            requests,
            replies,
            thread: Some(thread),
            port,
        };
        value.record(SECRET);
        value
    }
    fn record(&self, secret: &str) {
        std::fs::write(
            self.directory.join("running.json"),
            serde_json::to_vec(&json!({"pid":std::process::id(),"port":self.port,"secret":secret}))
                .unwrap(),
        )
        .unwrap();
    }
    fn reply(&self, value: Value) {
        self.replies
            .lock()
            .unwrap()
            .push_back((200, serde_json::to_vec(&value).unwrap(), None));
    }
    fn describe(&self) {
        self.reply(json!({"version":1,"environmentId":"actual-environment","qualified":false,"sourceRegistrationAvailable":true}));
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let joined = self.thread.take().unwrap().join();
        assert_eq!(
            self.directory.parent(),
            Some(std::env::temp_dir().canonicalize().unwrap().as_path())
        );
        assert!(self
            .directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("bycoda-native-bootstrap-"));
        std::fs::remove_dir_all(&self.directory).unwrap();
        // Preserve the original failed-test evidence without aborting every
        // test through a second panic in Drop. A standalone thread failure
        // still fails its test after owned cleanup completes.
        if !std::thread::panicking() {
            joined.unwrap();
        }
    }
}
fn association() -> Value {
    json!({"version":1,"associationId":ASSOCIATION,"sourceEpoch":EPOCH,"environmentId":"actual-environment",
        "sourceStoreId":"native-store","sourceProfileId":PROFILE,"writerProtocol":crate::session_store::authority::WRITER_PROTOCOL,"qualified":false})
}

#[test]
fn fixture_reads_a_fragmented_request_body_before_responding() {
    use std::net::TcpStream;
    let fixture = Fixture::new();
    fixture.describe();
    let body = r#"{"version":1,"action":"describe"}"#;
    let mut socket = TcpStream::connect(("127.0.0.1", fixture.port)).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let header = format!("POST {BOOTSTRAP_PATH} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {SECRET}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    socket.write_all(header.as_bytes()).unwrap();
    // TCP may deliver headers and body separately. The listener intentionally
    // polls accept, but an accepted request must wait for its declared body.
    std::thread::sleep(Duration::from_millis(100));
    socket.write_all(body.as_bytes()).unwrap();
    let mut response = Vec::new();
    socket.read_to_end(&mut response).unwrap();
    assert!(response.starts_with(b"HTTP/1.1 200"));
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].ends_with(body));
}

#[test]
fn native_bootstrap_uses_only_selected_record_and_never_puts_secret_in_body() {
    let fixture = Fixture::new();
    fixture.describe();
    let selected = HostBootstrap::discover(&fixture.directory).unwrap();
    assert_eq!(selected.description.environment_id, "actual-environment");
    assert!(selected.description.source_registration_available);
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert!(request.starts_with("POST /native-authority/bootstrap HTTP/1.1"));
    assert!(request.to_ascii_lowercase().contains(&format!(
        "authorization: bearer {}",
        SECRET.to_ascii_lowercase()
    )));
    assert_eq!(
        request
            .split("\r\n\r\n")
            .nth(1)
            .unwrap()
            .parse::<Value>()
            .unwrap(),
        json!({"version":1,"action":"describe"})
    );
    assert!(!request.split("\r\n\r\n").nth(1).unwrap().contains(SECRET));
}

#[test]
fn changed_private_record_invalidates_old_host_before_any_recovery_request() {
    let fixture = Fixture::new();
    fixture.describe();
    let selected = HostBootstrap::discover(&fixture.directory).unwrap();
    fixture.record("replacementPrivateBootstrapSecret012345");
    assert!(matches!(
        selected.lookup(NONCE, PROFILE),
        Err(BootstrapError::ChangedHost)
    ));
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn registration_and_lookup_bind_actual_environment_without_replaying_register() {
    let fixture = Fixture::new();
    fixture.describe();
    fixture.reply(association());
    fixture.reply(
        json!({"version":1,"state":"associated","association":association(),"qualified":false}),
    );
    let selected = HostBootstrap::discover(&fixture.directory).unwrap();
    let current = selected
        .register(
            &format!(r"\\.\pipe\bycoda-authority-v1-{}", "a".repeat(32)),
            NONCE,
            PROFILE,
        )
        .unwrap();
    assert_eq!(current.source_profile_id, PROFILE);
    assert!(matches!(
        selected.lookup(NONCE, PROFILE),
        Ok(Lookup::Associated { .. })
    ));
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|value| value.contains("\"register-source\""))
            .count(),
        1
    );
    assert_eq!(
        requests
            .iter()
            .filter(|value| value.contains("\"lookup-source\""))
            .count(),
        1
    );
    assert!(requests[1].contains("actual-environment"));
}

#[test]
fn source_status_and_retirement_reject_scope_or_epoch_replacement() {
    let fixture = Fixture::new();
    fixture.describe();
    fixture.reply(association());
    let mut replacement = association();
    replacement["sourceEpoch"] = json!(NONCE);
    fixture.reply(replacement);
    fixture.reply(json!({"version":1,"associationId":ASSOCIATION,"sourceEpoch":EPOCH,"retired":true,"qualified":false}));
    let selected = HostBootstrap::discover(&fixture.directory).unwrap();
    let current = selected
        .register(
            &format!(r"\\.\pipe\bycoda-authority-v1-{}", "b".repeat(32)),
            NONCE,
            PROFILE,
        )
        .unwrap();
    assert!(matches!(
        selected.status(&current),
        Err(BootstrapError::InvalidResponse)
    ));
    selected.unregister(&current).unwrap();
}

#[test]
fn bootstrap_rejects_claimed_qualification_unknown_fields_and_oversized_responses() {
    for reply in [
        json!({"version":1,"environmentId":"actual-environment","qualified":true}),
        json!({"version":1,"environmentId":"actual-environment","qualified":false,"nativeActorId":"forged"}),
    ] {
        let fixture = Fixture::new();
        fixture.reply(reply);
        assert!(matches!(
            HostBootstrap::discover(&fixture.directory),
            Err(BootstrapError::InvalidResponse)
        ));
    }
    let fixture = Fixture::new();
    fixture
        .replies
        .lock()
        .unwrap()
        .push_back((200, vec![b' '; MAX_BODY + 1], None));
    assert!(matches!(
        HostBootstrap::discover(&fixture.directory),
        Err(BootstrapError::BodyTooLarge)
    ));
}

#[test]
fn bootstrap_does_not_follow_redirects_with_administrative_credentials() {
    let fixture = Fixture::new();
    fixture.replies.lock().unwrap().push_back((
        302,
        Vec::new(),
        Some(format!("http://127.0.0.1:{}/other", fixture.port)),
    ));
    assert!(HostBootstrap::discover(&fixture.directory).is_err());
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[test]
fn invalid_or_oversized_running_record_never_reaches_network() {
    let fixture = Fixture::new();
    for body in [
        vec![b' '; MAX_RECORD + 1],
        br#"{"pid":0,"port":1,"secret":"invalid"}"#.to_vec(),
    ] {
        std::fs::write(fixture.directory.join("running.json"), body).unwrap();
        assert!(matches!(
            HostBootstrap::discover(&fixture.directory),
            Err(BootstrapError::Unavailable)
        ));
    }
    assert!(fixture.requests.lock().unwrap().is_empty());
}
