//! Loopback-only local/SOCKS5 SSH forwarding using the canonical endpoint policy.
use crate::ssh_security::{connection_args, SshEndpoint};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStatus {
    pub id: String,
    pub connection_id: String,
    pub local_port: u16,
    pub kind: String,
    pub target_host: String,
    pub target_port: u16,
    pub state: String,
    pub error: Option<String>,
}
struct LiveForward {
    _http_proxy: Option<std::sync::Arc<crate::ssh_http_proxy::HttpProxyLease>>,
    _jump_config: Option<std::sync::Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    generation: uuid::Uuid,
    owner: String,
    identity: String,
    status: ForwardStatus,
    child: Option<Child>,
}
#[derive(Default)]
pub struct SshForwards {
    sessions: Mutex<HashMap<String, LiveForward>>,
}
type ForwardOwner = crate::ssh_window_lifecycle::Lease;

fn stop_child(live: &mut LiveForward) {
    if let Some(mut child) = live.child.take() {
        if !matches!(child.try_wait(), Ok(Some(_))) {
            crate::harness::terminate_all(&[child.id()]);
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    live.status.state = "stopped".into();
    live._jump_config = None;
    live._http_proxy = None;
}
impl SshForwards {
    /// Native window creation only. A recreated label gets a fresh generation;
    /// pending work retains the revoked generation from the destroyed window.
    #[cfg(test)]
    pub(crate) fn register_window(&self, owner: &str) -> Result<(), String> {
        crate::ssh_window_lifecycle::register(owner).map(|_| ())
    }
    fn owner(&self, owner: &str) -> Result<ForwardOwner, String> {
        crate::ssh_window_lifecycle::capture(owner)
    }
    pub(crate) fn kill_window(&self, owner: &str) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, live| {
            if live.owner == owner {
                stop_child(live);
                false
            } else {
                true
            }
        });
    }
    pub(crate) fn kill_all(&self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for (_, mut live) in sessions.drain() {
            stop_child(&mut live);
        }
    }
}
impl Drop for SshForwards {
    fn drop(&mut self) {
        self.kill_all();
    }
}

#[cfg(test)]
fn forward_args(
    endpoint: &SshEndpoint,
    local_port: u16,
    target_host: &str,
    target_port: u16,
) -> Result<Vec<String>, String> {
    forward_args_kind(endpoint, local_port, target_host, target_port, "local")
}
pub(crate) fn forward_args_kind(
    endpoint: &SshEndpoint,
    local_port: u16,
    target_host: &str,
    target_port: u16,
    kind: &str,
) -> Result<Vec<String>, String> {
    if local_port == 0 || !matches!(kind, "local" | "dynamic") {
        return Err("Invalid forwarding type or local port".into());
    }
    if kind == "dynamic" && (!target_host.is_empty() || target_port != 0) {
        return Err("SOCKS5 forwarding cannot include a fixed destination".into());
    }
    if kind == "local"
        && (target_port == 0
            || target_host.is_empty()
            || target_host.len() > 253
            || target_host.starts_with('-')
            || !target_host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-_:".contains(c)))
    {
        return Err("Invalid local forwarding destination".into());
    }
    if kind == "local"
        && target_host.contains(':')
        && target_host.parse::<std::net::Ipv6Addr>().is_err()
    {
        return Err("Invalid IPv6 forwarding destination".into());
    }
    let target = if target_host.contains(':') {
        format!("[{target_host}]")
    } else {
        target_host.to_string()
    };
    let mut args = connection_args(endpoint)?;
    // Only this vetted loopback -L or -D is enabled. No user configuration is
    // loaded by connection_args, and remote/agent/X11 forwarding stays disabled.
    for arg in &mut args {
        if arg == "ClearAllForwardings=yes" {
            *arg = "ClearAllForwardings=no".into();
        }
    }
    args.extend([
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-N".into(),
        if kind == "dynamic" {
            "-D".into()
        } else {
            "-L".into()
        },
        if kind == "dynamic" {
            format!("127.0.0.1:{local_port}")
        } else {
            format!("127.0.0.1:{local_port}:{target}:{target_port}")
        },
        "--".into(),
        endpoint.host.clone(),
    ]);
    Ok(args)
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn start(
    state: &SshForwards,
    owner: &str,
    id: String,
    connection_id: String,
    local_port: u16,
    target_host: String,
    target_port: u16,
    args: Vec<String>,
) -> Result<ForwardStatus, String> {
    state.register_window(owner)?;
    start_prepared(
        state,
        owner,
        id,
        connection_id,
        local_port,
        target_host,
        target_port,
        args,
        None,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(crate) fn start_prepared(
    state: &SshForwards,
    owner: &str,
    id: String,
    connection_id: String,
    local_port: u16,
    target_host: String,
    target_port: u16,
    args: Vec<String>,
    identity_args: Option<Vec<String>>,
    jump_config: Option<std::sync::Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    http_proxy: Option<std::sync::Arc<crate::ssh_http_proxy::HttpProxyLease>>,
) -> Result<ForwardStatus, String> {
    let owner = state.owner(owner)?;
    start_for_owner(
        state,
        &owner,
        id,
        connection_id,
        local_port,
        target_host,
        target_port,
        args,
        identity_args,
        jump_config,
        http_proxy,
    )
}

#[allow(clippy::too_many_arguments)]
fn start_for_owner(
    state: &SshForwards,
    owner: &ForwardOwner,
    id: String,
    connection_id: String,
    local_port: u16,
    target_host: String,
    target_port: u16,
    args: Vec<String>,
    identity_args: Option<Vec<String>>,
    jump_config: Option<Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    http_proxy: Option<Arc<crate::ssh_http_proxy::HttpProxyLease>>,
) -> Result<ForwardStatus, String> {
    if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
        return Err("Invalid forwarding identifier".into());
    }
    let identity =
        serde_json::to_string(&(&connection_id, identity_args.as_ref().unwrap_or(&args)))
            .map_err(|_| "Invalid forwarding target")?;
    // The common native lifecycle lock covers spawning and registration only.
    let lifetime = owner;
    let owner = lifetime.owner();
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), local_port);
    let generation = uuid::Uuid::new_v4();
    let existing = lifetime.with_live(|| {
        let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(live) = sessions.get_mut(&id) {
            if live.owner != owner || live.identity != identity {
                return Err("Forward belongs to another window or target".into());
            }
            if let Some(child) = &mut live.child {
                if child
                    .try_wait()
                    .map_err(|_| "Unable to inspect forwarding process")?
                    .is_none()
                {
                    return Ok(Some(live.status.clone()));
                }
            }
            sessions.remove(&id);
        }
        drop(TcpListener::bind(address).map_err(|_| "Local port is already in use")?);
        let mut command = Command::new("ssh");
        if let Some(proxy) = &http_proxy {
            command.envs(proxy.environment());
        }
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env("SSH_ASKPASS_REQUIRE", "never")
            .env("PATH", crate::harness::gui_search_path());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        let spawned = crate::windows::spawn_managed(&mut command);
        #[cfg(not(windows))]
        let spawned = command.spawn();
        let child = spawned.map_err(|_| "Could not launch SSH forwarding process")?;
        let live = LiveForward {
            _http_proxy: http_proxy,
            _jump_config: jump_config,
            generation,
            owner: owner.into(),
            identity,
            child: Some(child),
            status: ForwardStatus {
                id: id.clone(),
                connection_id,
                local_port,
                kind: if target_host.is_empty() && target_port == 0 {
                    "dynamic".into()
                } else {
                    "local".into()
                },
                target_host,
                target_port,
                state: "starting".into(),
                error: None,
            },
        };
        sessions.insert(id.clone(), live);
        drop(sessions);
        Ok(None)
    })?;
    if let Some(status) = existing {
        return Ok(status);
    }
    let deadline = Instant::now() + Duration::from_secs(18);
    let mut listener_since = None;
    while Instant::now() < deadline {
        let listening = TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_ok();
        let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let live = sessions
            .get_mut(&id)
            .filter(|live| live.generation == generation)
            .ok_or("SSH forwarding was cancelled")?;
        let failed = !matches!(
            live.child.as_mut().map(|child| child.try_wait()),
            Some(Ok(None))
        );
        if failed {
            let mut live = sessions.remove(&id).unwrap();
            drop(sessions);
            stop_child(&mut live);
            return Err("SSH forwarding failed. Check host trust, agent/key authentication and destination.".into());
        }
        if listening {
            // Observe the listener twice with the same live child, allowing a
            // conflicting bind failure to settle without blocking owner cleanup.
            if listener_since.get_or_insert_with(Instant::now).elapsed()
                >= Duration::from_millis(100)
            {
                live.status.state = "running".into();
                return Ok(live.status.clone());
            }
        } else {
            listener_since = None;
        }
        drop(sessions);
        std::thread::sleep(Duration::from_millis(30));
    }
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if sessions
        .get(&id)
        .is_some_and(|live| live.generation == generation)
    {
        let mut live = sessions.remove(&id).unwrap();
        drop(sessions);
        stop_child(&mut live);
    }
    Err("SSH forwarding timed out before opening the loopback listener".into())
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn ssh_forward_start(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, SshForwards>,
    id: String,
    connection_id: String,
    local_port: u16,
    target_host: String,
    target_port: u16,
    kind: Option<String>,
    http_proxy_ticket_id: Option<String>,
) -> Result<ForwardStatus, String> {
    let owner = state.owner(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let proxy_grant = http_proxy_ticket_id
        .as_deref()
        .map(|ticket| {
            app.state::<crate::ssh_http_proxy_credentials::HttpProxyCredentials>()
                .consume(
                    window.label(),
                    ticket,
                    Some(&connection_id),
                    &endpoint,
                    &crate::ssh_http_proxy_credentials::ProxyOperation::Forward {
                        id: id.clone(),
                        forward_kind: kind.clone().unwrap_or_else(|| "local".into()),
                        local_port,
                        target_host: target_host.clone(),
                        target_port,
                    },
                )
        })
        .transpose()?;
    let args = forward_args_kind(
        &endpoint,
        local_port,
        &target_host,
        target_port,
        kind.as_deref().unwrap_or("local"),
    )?;
    let identity_args = crate::ssh_security::stable_args(&endpoint, &args);
    start_for_owner(
        &state,
        &owner,
        id,
        connection_id,
        local_port,
        target_host,
        target_port,
        args,
        Some(identity_args),
        endpoint.prepared_jump_config.clone(),
        crate::ssh_security::start_http_proxy_authorized(&endpoint, proxy_grant.as_ref())?,
    )
}
#[tauri::command(async)]
pub fn ssh_forward_stop(
    window: tauri::Window,
    state: State<'_, SshForwards>,
    id: String,
) -> Result<(), String> {
    stop_owned(&state, window.label(), &id)
}
pub(crate) fn stop_owned(state: &SshForwards, owner: &str, id: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if sessions.get(id).is_some_and(|live| live.owner != owner) {
        return Err("Forward belongs to another window".into());
    }
    if let Some(mut live) = sessions.remove(id) {
        stop_child(&mut live);
    }
    Ok(())
}
#[tauri::command(async)]
pub fn ssh_forward_list(
    window: tauri::Window,
    state: State<'_, SshForwards>,
) -> Vec<ForwardStatus> {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    sessions
        .values_mut()
        .filter(|live| live.owner == window.label())
        .map(|live| {
            if let Some(child) = &mut live.child {
                if let Ok(Some(_)) = child.try_wait() {
                    live.child = None;
                    live._jump_config = None;
                    live._http_proxy = None;
                    live.status.state = "failed".into();
                    live.status.error = Some("SSH forwarding process exited".into());
                }
            }
            live.status.clone()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_start_cannot_spawn_after_close_or_recreated_window_label() {
        let state = Arc::new(SshForwards::default());
        state.register_window("native-window").unwrap();
        let pending_owner = state.owner("native-window").unwrap();
        // Holding this port proves a stale request must fail at the lifetime
        // boundary, before even reaching local-port validation or process spawn.
        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = occupied.local_addr().unwrap().port();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (resume_tx, resume_rx) = std::sync::mpsc::channel();
        let pending = state.clone();
        let worker = std::thread::spawn(move || {
            ready_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            start_for_owner(
                &pending,
                &pending_owner,
                "late-start".into(),
                "saved-server".into(),
                port,
                "localhost".into(),
                22,
                Vec::new(),
                None,
                None,
                None,
            )
        });
        ready_rx.recv().unwrap();
        crate::ssh_window_lifecycle::close("native-window");
        state.kill_window("native-window");
        // A genuinely recreated native window is usable but must never revive
        // a request captured by its destroyed predecessor with the same label.
        state.register_window("native-window").unwrap();
        resume_tx.send(()).unwrap();
        let error = worker.join().unwrap().unwrap_err();
        assert!(error.contains("closed before process launch"), "{error}");
        assert!(state.sessions.lock().unwrap().is_empty());
        let current = state.owner("native-window").unwrap();
        let error = start_for_owner(
            &state,
            &current,
            "new-generation".into(),
            "saved-server".into(),
            port,
            "localhost".into(),
            22,
            Vec::new(),
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(
            error.contains("already in use"),
            "a newly registered generation remains valid: {error}"
        );
    }

    #[test]
    fn unregistered_closed_and_shutdown_owners_have_no_forwarding_capability() {
        let state = SshForwards::default();
        assert!(state.owner("never-registered").is_err());
        state.register_window("closed-native-window").unwrap();
        crate::ssh_window_lifecycle::close("closed-native-window");
        state.kill_window("closed-native-window");
        assert!(state.owner("closed-native-window").is_err());
        state.register_window("closed-native-window").unwrap();
        crate::ssh_window_lifecycle::close("closed-native-window");
        state.kill_all();
        assert!(state.owner("closed-native-window").is_err());
        assert!(state.sessions.lock().unwrap().is_empty());
    }
    #[test]
    fn dynamic_forward_has_one_explicit_loopback_listener_and_no_fixed_target() {
        let endpoint = SshEndpoint {
            host: "server.example".into(),
            port: 22,
            ..Default::default()
        };
        let args = forward_args_kind(&endpoint, 1080, "", 0, "dynamic").unwrap();
        assert!(args.windows(2).any(|pair| pair == ["-D", "127.0.0.1:1080"]));
        for disabled in ["-L", "-R", "-A", "-g"] {
            assert!(!args.iter().any(|arg| arg == disabled));
        }
        for policy in [
            "-N",
            "ForwardAgent=no",
            "ForwardX11=no",
            "StrictHostKeyChecking=yes",
            "ClearAllForwardings=no",
            "BatchMode=yes",
        ] {
            assert!(args.iter().any(|arg| arg == policy));
        }
        for (port, host, target, kind) in [
            (0, "", 0, "dynamic"),
            (1080, "localhost", 0, "dynamic"),
            (1080, "", 22, "dynamic"),
            (1080, "", 0, "http"),
            (1080, "", 0, "local"),
        ] {
            assert!(forward_args_kind(&endpoint, port, host, target, kind).is_err());
        }
    }
    #[test]
    fn only_explicit_loopback_forwarding_is_built() {
        let endpoint = SshEndpoint {
            host: "server.example".into(),
            port: 22,
            ..Default::default()
        };
        let args = forward_args(&endpoint, 14567, "127.0.0.1", 5432).unwrap();
        assert!(args.contains(&"127.0.0.1:14567:127.0.0.1:5432".into()));
        assert!(args.contains(&"ClearAllForwardings=no".into()));
        assert!(args.contains(&"BatchMode=yes".into()));
        assert!(args.contains(&"StrictHostKeyChecking=yes".into()));
        assert!(!args.contains(&"-R".into()));
        assert!(!args.contains(&"-D".into()));
        for target in [
            "-oProxyCommand=x",
            "host:22:other",
            "host user",
            "host;evil",
            "",
        ] {
            assert!(forward_args(&endpoint, 14567, target, 22).is_err());
        }
        assert!(forward_args(&endpoint, 0, "localhost", 22).is_err());
        assert!(forward_args(&endpoint, 22, "localhost", 0).is_err());
    }

    #[test]
    fn occupied_loopback_port_fails_without_launching_a_process() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = SshForwards::default();
        let error = start(
            &state,
            "main",
            "rule".into(),
            "server".into(),
            port,
            "localhost".into(),
            22,
            vec![],
        )
        .unwrap_err();
        assert!(error.contains("already in use"));
        assert!(state.sessions.lock().unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn connecting_forward_can_be_cancelled_without_waiting_for_handshake() {
        use std::sync::{mpsc, Arc};
        let peer = TcpListener::bind("127.0.0.1:0").unwrap();
        peer.set_nonblocking(true).unwrap();
        let endpoint = SshEndpoint {
            host: "127.0.0.1".into(),
            port: peer.local_addr().unwrap().port(),
            ..Default::default()
        };
        let local = TcpListener::bind("127.0.0.1:0").unwrap();
        let local_port = local.local_addr().unwrap().port();
        drop(local);
        let (done_tx, done_rx) = mpsc::channel();
        let slow_peer = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if let Ok((stream, _)) = peer.accept() {
                    let _ = done_rx.recv_timeout(Duration::from_secs(5));
                    drop(stream);
                    break;
                }
                if done_rx.try_recv().is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        let state = Arc::new(SshForwards::default());
        let pending = state.clone();
        let args = forward_args(&endpoint, local_port, "localhost", 22).unwrap();
        let starting = std::thread::spawn(move || {
            start(
                &pending,
                "owner",
                "pending".into(),
                "fixture".into(),
                local_port,
                "localhost".into(),
                22,
                args,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && !state.sessions.lock().unwrap().contains_key("pending") {
            std::thread::sleep(Duration::from_millis(10));
        }
        let before = Instant::now();
        state.kill_window("owner");
        assert!(
            before.elapsed() < Duration::from_secs(3),
            "cleanup must not await 15 second SSH handshake"
        );
        assert!(starting.join().unwrap().is_err());
        let _ = done_tx.send(());
        slow_peer.join().unwrap();
        assert!(state.sessions.lock().unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Requires disposable SSH fixture specified by BYCODA_SSH_FIXTURE_DIR"]
    fn disposable_real_loopback_forward_transfer_stop_restart_and_window_cleanup() {
        use std::io::{Read, Write};
        let root = std::path::PathBuf::from(std::env::var("BYCODA_SSH_FIXTURE_DIR").unwrap());
        let ssh_port = std::fs::read_to_string(root.join("port.txt"))
            .unwrap()
            .parse()
            .unwrap();
        let endpoint = SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(std::env::var("USERNAME").unwrap()),
            port: ssh_port,
            identity_file: Some(root.join("client_key").to_string_lossy().into_owned()),
            jump_host: None,
            jump_hosts: Vec::new(),
            certificate_file: None,
            ..Default::default()
        };
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let target_port = target.local_addr().unwrap().port();
        let echo = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline {
                if let Ok((mut stream, _)) = target.accept() {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut bytes = [0u8; 128];
                    if let Ok(n) = stream.read(&mut bytes) {
                        if n > 0 {
                            stream.write_all(&bytes[..n]).unwrap();
                            return n;
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            0
        });
        let free = TcpListener::bind("127.0.0.1:0").unwrap();
        let local_port = free.local_addr().unwrap().port();
        drop(free);
        let mut args = vec![
            "-o".into(),
            format!("UserKnownHostsFile={}", root.join("known_hosts").display()),
        ];
        args.extend(forward_args(&endpoint, local_port, "127.0.0.1", target_port).unwrap());
        crate::windows::initialize().unwrap();
        let state = SshForwards::default();
        let status = start(
            &state,
            "main",
            "fixture-rule".into(),
            "fixture-server".into(),
            local_port,
            "127.0.0.1".into(),
            target_port,
            args.clone(),
        )
        .unwrap();
        assert_eq!(status.state, "running");
        let mut connection = TcpStream::connect(("127.0.0.1", local_port)).unwrap();
        connection
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let payload = b"BYCODA_REAL_SSH_FORWARD";
        connection.write_all(payload).unwrap();
        let mut reply = vec![0u8; payload.len()];
        connection.read_exact(&mut reply).unwrap();
        assert_eq!(&reply, payload);
        drop(connection);
        assert_eq!(echo.join().unwrap(), payload.len());
        state.kill_window("other-window");
        assert!(TcpStream::connect(("127.0.0.1", local_port)).is_ok());
        state.kill_window("main");
        assert!(TcpStream::connect(("127.0.0.1", local_port)).is_err());
        let restarted = start(
            &state,
            "main",
            "fixture-rule".into(),
            "fixture-server".into(),
            local_port,
            "127.0.0.1".into(),
            target_port,
            args,
        )
        .unwrap();
        assert_eq!(restarted.state, "running");
        state.kill_all();
        assert!(TcpListener::bind(("127.0.0.1", local_port)).is_ok());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Requires the disposable running SSH/SFTP fixture and test environment"]
    fn disposable_real_socks5_handshake_echo_owner_stop_conflict_and_cleanup() {
        use std::io::{Read, Write};
        const PAYLOAD: &[u8] = b"BYCODA_REAL_SOCKS5_INSERT_NO_HTTP";
        let root = std::path::PathBuf::from(std::env::var("BYCODA_TEST_SFTP_ROOT").unwrap());
        let endpoint = SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(std::env::var("USERNAME").unwrap()),
            port: std::fs::read_to_string(root.join("port.txt"))
                .unwrap()
                .trim()
                .parse()
                .unwrap(),
            identity_file: Some(std::env::var("BYCODA_TEST_SFTP_IDENTITY").unwrap()),
            ..Default::default()
        };
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let target_port = target.local_addr().unwrap().port();
        // Windows resolves localhost to ::1 first. Both target listeners must
        // exist to test real remote DNS, rather than an IPv4-only fixture.
        // The actual SOCKS listener remains strictly 127.0.0.1.
        let target_v6 = TcpListener::bind(("::1", target_port)).unwrap();
        target_v6.set_nonblocking(true).unwrap();
        let echo = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut transferred = 0;
            while transferred < 2 && Instant::now() < deadline {
                for listener in [&target, &target_v6] {
                    if let Ok((mut stream, _)) = listener.accept() {
                        // Accepted sockets inherit nonblocking mode on Windows.
                        // The fixture reads a complete payload with a timeout.
                        stream.set_nonblocking(false).unwrap();
                        stream
                            .set_read_timeout(Some(Duration::from_secs(3)))
                            .unwrap();
                        let mut payload = vec![0u8; PAYLOAD.len()];
                        stream.read_exact(&mut payload).unwrap();
                        assert_eq!(payload, PAYLOAD);
                        stream.write_all(&payload).unwrap();
                        transferred += 1;
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            transferred
        });
        let available = TcpListener::bind("127.0.0.1:0").unwrap();
        let local_port = available.local_addr().unwrap().port();
        drop(available);
        let mut args = vec![
            "-o".into(),
            format!("UserKnownHostsFile={}", root.join("known_hosts").display()),
        ];
        args.extend(forward_args_kind(&endpoint, local_port, "", 0, "dynamic").unwrap());
        crate::windows::initialize().unwrap();
        let state = SshForwards::default();
        let status = start(
            &state,
            "socks-owner",
            "socks-rule".into(),
            "fixture-server".into(),
            local_port,
            "".into(),
            0,
            args.clone(),
        )
        .unwrap();
        assert_eq!(status.kind, "dynamic");
        assert_eq!(status.state, "running");
        assert!(start(
            &state,
            "other-window",
            "socks-rule".into(),
            "fixture-server".into(),
            local_port,
            "".into(),
            0,
            args.clone()
        )
        .is_err());
        assert!(stop_owned(&state, "other-window", "socks-rule").is_err());
        for domain in [false, true] {
            let mut stream = TcpStream::connect(("127.0.0.1", local_port)).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream.write_all(&[5, 1, 0]).unwrap();
            let mut method = [0; 2];
            stream.read_exact(&mut method).unwrap();
            assert_eq!(method, [5, 0]);
            let mut request = if domain {
                vec![
                    5, 1, 0, 3, 9, b'l', b'o', b'c', b'a', b'l', b'h', b'o', b's', b't',
                ]
            } else {
                vec![5, 1, 0, 1, 127, 0, 0, 1]
            };
            request.extend(target_port.to_be_bytes());
            stream.write_all(&request).unwrap();
            let mut header = [0; 4];
            stream.read_exact(&mut header).unwrap();
            assert_eq!(&header[..3], &[5, 0, 0]);
            let address_length = match header[3] {
                1 => 4,
                4 => 16,
                3 => {
                    let mut n = [0];
                    stream.read_exact(&mut n).unwrap();
                    n[0] as usize
                }
                other => panic!("Invalid SOCKS5 reply address type {other}"),
            };
            let mut bound = vec![0; address_length + 2];
            stream.read_exact(&mut bound).unwrap();
            stream.write_all(PAYLOAD).unwrap();
            let mut reply = vec![0; PAYLOAD.len()];
            stream.read_exact(&mut reply).unwrap();
            assert_eq!(reply, PAYLOAD);
        }
        assert_eq!(echo.join().unwrap(), 2);
        state.kill_window("other-window");
        assert!(TcpStream::connect(("127.0.0.1", local_port)).is_ok());
        stop_owned(&state, "socks-owner", "socks-rule").unwrap();
        let conflict = TcpListener::bind(("127.0.0.1", local_port)).unwrap();
        assert!(start(
            &state,
            "socks-owner",
            "conflict-rule".into(),
            "fixture-server".into(),
            local_port,
            "".into(),
            0,
            args.clone()
        )
        .unwrap_err()
        .contains("already in use"));
        assert!(state.sessions.lock().unwrap().is_empty());
        drop(conflict);
        assert_eq!(
            start(
                &state,
                "socks-owner",
                "socks-rule".into(),
                "fixture-server".into(),
                local_port,
                "".into(),
                0,
                args
            )
            .unwrap()
            .state,
            "running"
        );
        state.kill_window("socks-owner");
        assert!(TcpListener::bind(("127.0.0.1", local_port)).is_ok());
        assert!(state.sessions.lock().unwrap().is_empty());
    }
}
