//! Ephemeral read-only native folder access over the existing paired-host RPC.
use super::{read, rpc, store_path, RemoteConnections, StoredMachine};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[path = "remote_folder_access/os_adapter.rs"]
mod os_adapter;
#[path = "remote_folder_access/protocol.rs"]
mod protocol;

const IDLE: Duration = Duration::from_secs(15 * 60);
/// A player lease keeps its gateway alive; a lease whose window never released it (reload, crash)
/// stops counting after this long so the gateway can still expire.
const LEASE_MAX: Duration = Duration::from_secs(6 * 60 * 60);
const LIVE_MAX: usize = 8;
const MEDIA_MAX: usize = 8;
static GATEWAYS: OnceLock<Mutex<HashMap<String, Arc<Gateway>>>> = OnceLock::new();

trait Reader: Send + Sync {
    fn call(&self, command: &str, args: Value) -> Result<Value, String>;
    fn current(&self) -> bool;
}

struct Access {
    machine: StoredMachine,
    endpoint: String,
    store: PathBuf,
}
impl Reader for Access {
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
    fn call(&self, command: &str, args: Value) -> Result<Value, String> {
        if !self.current() {
            return Err("The owning computer is disconnected.".into());
        }
        rpc(
            &self.endpoint,
            &self.machine.token,
            Some(&self.machine.environment_id),
            "workspace.run",
            json!({"command":command,"args":args}),
        )
    }
}

struct Gateway {
    port: u16,
    capability: String,
    root: String,
    root_identity: String,
    machine_id: String,
    environment_id: String,
    /// Media gateways serve exactly this one file name under `root`, read-only; nothing else.
    file: Option<String>,
    reader: Arc<dyn Reader>,
    alive: AtomicBool,
    active: AtomicUsize,
    touched: Mutex<Instant>,
    leases: Mutex<HashMap<String, Instant>>,
    mount: Mutex<Option<os_adapter::Mount>>,
}

impl Gateway {
    fn leased(&self) -> bool {
        self.leases.lock().is_ok_and(|mut leases| {
            leases.retain(|_, since| since.elapsed() < LEASE_MAX);
            !leases.is_empty()
        })
    }
    fn lease(&self) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut leases) = self.leases.lock() {
            leases.insert(id.clone(), Instant::now());
        }
        self.touch();
        id
    }
    fn release(&self, id: &str) -> bool {
        let removed = self
            .leases
            .lock()
            .is_ok_and(|mut leases| leases.remove(id).is_some());
        if removed {
            self.touch();
        }
        removed
    }
    /// Idle past `limit` with no open player holding a lease.
    fn expired(&self, limit: Duration) -> bool {
        let idle = self
            .touched
            .lock()
            .map(|time| time.elapsed() > limit)
            .unwrap_or(true);
        idle && !self.leased()
    }
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/{}/", self.port, self.capability)
    }
    fn touch(&self) {
        if let Ok(mut time) = self.touched.lock() {
            *time = Instant::now();
        }
    }
    fn call(&self, command: &str, segments: &[String], mut args: Value) -> Result<Value, String> {
        if !self.alive.load(Ordering::SeqCst) || !self.reader.current() {
            return Err("The folder connection has closed.".into());
        }
        let path = if segments.is_empty() {
            self.root.clone()
        } else {
            format!("{}/{}", self.root.trim_end_matches('/'), segments.join("/"))
        };
        args["path"] = json!(path);
        args["root"] = json!(self.root);
        args["rootIdentity"] = json!(self.root_identity);
        self.touch();
        self.reader.call(command, args)
    }
    fn stop(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut mount) = self.mount.lock() {
            if let Some(mount) = mount.take() {
                mount.cleanup();
            }
        }
    }
}

fn listen(
    reader: Arc<dyn Reader>,
    root: String,
    root_identity: String,
    machine_id: String,
    environment_id: String,
    file: Option<String>,
) -> Result<Arc<Gateway>, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let gateway = Arc::new(Gateway {
        port: listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port(),
        // Two random v4 UUIDs: well over 128 bits of unguessable capability.
        capability: format!(
            "bycoda-{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
        root,
        root_identity,
        machine_id,
        environment_id,
        file,
        reader,
        alive: AtomicBool::new(true),
        active: AtomicUsize::new(0),
        touched: Mutex::new(Instant::now()),
        leases: Mutex::new(HashMap::new()),
        mount: Mutex::new(None),
    });
    let running = gateway.clone();
    std::thread::spawn(move || {
        let mut checked = Instant::now();
        while running.alive.load(Ordering::SeqCst) {
            if checked.elapsed() >= Duration::from_secs(1) {
                if running.expired(IDLE) || !running.reader.current() {
                    break;
                }
                checked = Instant::now();
            }
            match listener.accept() {
                Ok((socket, peer)) => {
                    if !peer.ip().is_loopback() || running.active.load(Ordering::SeqCst) >= 16 {
                        continue;
                    }
                    // Accepted sockets can inherit the listener's nonblocking mode.
                    let _ = socket.set_nonblocking(false);
                    let _ = socket.set_read_timeout(Some(Duration::from_secs(15)));
                    let _ = socket.set_write_timeout(Some(Duration::from_secs(15)));
                    running.active.fetch_add(1, Ordering::SeqCst);
                    let session = running.clone();
                    std::thread::spawn(move || {
                        let _ = protocol::serve(socket, &session);
                        session.active.fetch_sub(1, Ordering::SeqCst);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if crate::ssh_http_proxy::wait_tcp_ready(
                        &[(&listener, true, false)],
                        Duration::from_secs(1),
                    )
                    .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        running.stop();
    });
    Ok(gateway)
}

pub(super) fn shutdown() {
    if let Some(gateways) = GATEWAYS.get() {
        let values = gateways
            .lock()
            .map(|mut all| all.drain().map(|(_, gate)| gate).collect::<Vec<_>>())
            .unwrap_or_default();
        for gateway in values {
            gateway.stop();
        }
    }
}

pub(super) fn stop_machine(machine_id: &str) {
    stop_matching(|gate| gate.machine_id == machine_id);
}

pub(super) fn stop_environment(environment_id: &str) {
    stop_matching(|gate| gate.environment_id == environment_id);
}

fn stop_matching(predicate: impl Fn(&Gateway) -> bool) {
    if let Some(gateways) = GATEWAYS.get() {
        let values = gateways
            .lock()
            .map(|all| {
                all.values()
                    .filter(|gate| predicate(gate))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for gateway in values {
            gateway.stop();
        }
    }
}

/// Makes room for one more gateway of its kind. Live folders and media streams have separate caps
/// so streaming never starves live folders; a full media set first drops its oldest idle,
/// unleased stream.
fn make_room(gateways: &mut HashMap<String, Arc<Gateway>>, media: bool) -> Result<(), String> {
    let cap = if media { MEDIA_MAX } else { LIVE_MAX };
    if gateways
        .values()
        .filter(|gate| gate.file.is_some() == media)
        .count()
        < cap
    {
        return Ok(());
    }
    if media {
        let oldest = gateways
            .iter()
            .filter(|(_, gate)| gate.file.is_some() && !gate.leased())
            .min_by_key(|(_, gate)| gate.touched.lock().map_or_else(|_| Instant::now(), |t| *t))
            .map(|(key, _)| key.clone());
        if let Some(gate) = oldest.and_then(|key| gateways.remove(&key)) {
            gate.stop();
            return Ok(());
        }
        return Err("Too many media streams are playing. Close one and try again.".into());
    }
    Err("Too many live folders are open. Close an unused folder and try again later.".into())
}

/// Opens or reuses the gateway for one folder of a recorded machine. `kind` keeps live-folder
/// (mounted) and media-only gateways apart so neither adopts the other's mount state; a media
/// gateway is scoped to the single `file` it was opened for.
fn acquire_gateway(
    app: &AppHandle,
    machine_id: &str,
    environment_id: &str,
    path: &str,
    kind: &str,
    file: Option<&str>,
) -> Result<(Arc<Gateway>, bool), String> {
    {
        let state = app.state::<RemoteConnections>();
        if path.len() > 4096 || path.chars().any(|ch| ch.is_control()) {
            return Err("Invalid connected folder path".into());
        }
        let store = store_path(app)?;
        let machine = {
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            read(&store)?
                .into_iter()
                .find(|machine| {
                    machine.id == machine_id && machine.environment_id == environment_id
                })
                .ok_or("The owning computer is not connected")?
        };
        let endpoint = match &machine.ssh {
            Some(target) => {
                state
                    .tunnels
                    .endpoint(&machine.id, &machine.environment_id, target, true)?
                    .endpoint
            }
            None => machine.endpoint.clone(),
        };
        let access = Arc::new(Access {
            machine,
            endpoint,
            store,
        });
        // The host checks the selected root itself, not merely the project containing it.
        let entry = access
            .call(
                "read_folder_entry",
                json!({"root":path,"path":path,"children":false}),
            )
            .map_err(|error| {
                if error.contains("Unsupported") {
                    "Update bycoda Host on the connected computer to open live folders.".into()
                } else {
                    error
                }
            })?;
        if entry["isDir"].as_bool() != Some(true) {
            return Err("Choose a folder for live file-manager access".into());
        }
        let root_identity = entry["rootIdentity"]
            .as_str()
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or("The connected computer returned an invalid folder identity")?
            .to_owned();
        let key = json!([
            kind,
            access.machine.id,
            access.machine.environment_id,
            access.machine.token,
            access.endpoint,
            path,
            root_identity,
            file
        ])
        .to_string();
        let (gateway, created) = {
            let mut gateways = GATEWAYS
                .get_or_init(Mutex::default)
                .lock()
                .map_err(|_| "Folder access is unavailable")?;
            gateways.retain(|_, gate| gate.alive.load(Ordering::SeqCst));
            if let Some(gateway) = gateways.get(&key) {
                (gateway.clone(), false)
            } else {
                make_room(&mut gateways, file.is_some())?;
                let gateway = listen(
                    access,
                    path.to_owned(),
                    root_identity,
                    machine_id.to_owned(),
                    environment_id.to_owned(),
                    file.map(str::to_owned),
                )?;
                gateways.insert(key, gateway.clone());
                (gateway, true)
            }
        };
        gateway.touch();
        Ok((gateway, created))
    }
}

/// Splits a connected file path into its folder and file name.
fn media_target(path: &str) -> Result<(String, String), String> {
    if path.len() > 4096 || path.chars().any(|ch| ch.is_control()) {
        return Err("Invalid connected file path".into());
    }
    let split = path.rfind('/').ok_or("Invalid connected file path")?;
    let name = &path[split + 1..];
    if name.is_empty() || name == "." || name == ".." || name.contains('\\') {
        return Err("Invalid connected file path".into());
    }
    let folder = &path[..split];
    // A drive root ("C:") and the POSIX root keep their trailing separator.
    let folder = if folder.is_empty() || folder.ends_with(':') {
        format!("{folder}/")
    } else {
        folder.to_owned()
    };
    Ok((folder, name.to_owned()))
}

#[derive(serde::Serialize)]
pub struct RemoteMediaUrl {
    url: String,
    size: u64,
    /// Held by the open player; release it when the player closes.
    lease: String,
}

/// A loopback-only, read-only URL for one remote file, served with HTTP Range by a gateway scoped
/// to that single file. It never opens the OS file manager and mounts nothing. The gateway stays
/// alive while the returned lease is held, however long the player sits idle.
#[tauri::command]
pub async fn remote_media_url(
    app: AppHandle,
    machine_id: String,
    environment_id: String,
    path: String,
) -> Result<RemoteMediaUrl, String> {
    crate::harness::run_blocking("remote_media_url", move || {
        let (folder, name) = media_target(&path)?;
        let (gateway, _) = acquire_gateway(
            &app,
            &machine_id,
            &environment_id,
            &folder,
            "media",
            Some(&name),
        )?;
        let info = gateway.call("read_file_info", std::slice::from_ref(&name), json!({}))?;
        let size = info["size"]
            .as_u64()
            .filter(|size| *size <= protocol::MAX_FILE)
            .ok_or("This file is too large to stream (maximum 1 GB).")?;
        Ok(RemoteMediaUrl {
            url: format!("{}{}", gateway.url(), protocol::encode_segment(&name)),
            size,
            lease: gateway.lease(),
        })
    })
    .await
}

/// Releases a player lease; the gateway then expires after the normal idle period.
#[tauri::command]
pub fn remote_media_release(lease: String) {
    let gateways = GATEWAYS
        .get()
        .and_then(|all| all.lock().ok())
        .map(|all| all.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for gateway in gateways {
        if gateway.release(&lease) {
            break;
        }
    }
}

#[tauri::command]
pub async fn remote_open_live_folder(
    app: AppHandle,
    machine_id: String,
    environment_id: String,
    path: String,
) -> Result<(), String> {
    crate::harness::run_blocking("remote_open_live_folder", move || {
        os_adapter::check_available()?;
        let (gateway, created) =
            acquire_gateway(&app, &machine_id, &environment_id, &path, "live", None)?;
        if !created {
            let mount = gateway
                .mount
                .lock()
                .map_err(|_| "Folder access is unavailable")?;
            return mount
                .as_ref()
                .ok_or("This folder is still opening. Try again shortly.")?
                .open();
        }
        let mounted = (|| {
            let base = app
                .path()
                .app_cache_dir()
                .map_err(|error| error.to_string())?;
            std::fs::create_dir_all(&base).map_err(|error| error.to_string())?;
            let storage = base.join("remote-live-folders");
            crate::file_access::produced_target(&storage, &base, "remote-live-folders")?;
            std::fs::create_dir_all(&storage).map_err(|error| error.to_string())?;
            let mount_dir = storage.join(uuid::Uuid::new_v4().to_string());
            os_adapter::mount_and_open(&gateway.url(), &mount_dir)
        })();
        match mounted {
            Ok(mount) => {
                let mut slot = match gateway.mount.lock() {
                    Ok(slot) => slot,
                    Err(_) => {
                        mount.cleanup();
                        gateway.stop();
                        return Err("Folder access is unavailable".into());
                    }
                };
                if !gateway.alive.load(Ordering::SeqCst) || !gateway.reader.current() {
                    mount.cleanup();
                    drop(slot);
                    gateway.stop();
                    return Err("The folder connection closed while opening.".into());
                }
                *slot = Some(mount);
                Ok(())
            }
            Err(error) => {
                gateway.stop();
                Err(error)
            }
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_target_splits_folder_and_name_and_rejects_escapes() {
        assert_eq!(
            media_target("/srv/media/clip one.mp4").unwrap(),
            ("/srv/media".to_owned(), "clip one.mp4".to_owned())
        );
        assert_eq!(
            media_target("/clip.mp4").unwrap(),
            ("/".to_owned(), "clip.mp4".to_owned())
        );
        assert_eq!(
            media_target("C:/clip.mp4").unwrap(),
            ("C:/".to_owned(), "clip.mp4".to_owned())
        );
        for bad in [
            "relative.mp4",
            "/srv/",
            "/srv/..",
            "/srv/.",
            r"/srv/a\b.mp4",
            "/srv/a\nb.mp4",
        ] {
            assert!(media_target(bad).is_err(), "accepted {bad:?}");
        }
        assert!(media_target(&format!("/{}", "a".repeat(4100))).is_err());
    }

    fn bare(file: Option<&str>) -> Gateway {
        Gateway {
            port: 4321,
            capability: "bycoda-token".into(),
            root: "/srv".into(),
            root_identity: "id".into(),
            machine_id: "m".into(),
            environment_id: "e".into(),
            file: file.map(str::to_owned),
            reader: Arc::new(Closed),
            alive: AtomicBool::new(true),
            active: AtomicUsize::new(0),
            touched: Mutex::new(Instant::now()),
            leases: Mutex::new(HashMap::new()),
            mount: Mutex::new(None),
        }
    }

    #[test]
    fn a_lease_keeps_an_idle_gateway_alive_until_released() {
        let gateway = bare(Some("a.mp4"));
        std::thread::sleep(Duration::from_millis(5));
        assert!(gateway.expired(Duration::from_millis(1)));
        let lease = gateway.lease();
        std::thread::sleep(Duration::from_millis(5));
        assert!(!gateway.expired(Duration::from_millis(1)));
        assert!(!gateway.release("unknown"));
        assert!(gateway.release(&lease));
        // Release restarts the idle clock instead of dropping the stream at once.
        assert!(!gateway.expired(Duration::from_secs(60)));
        std::thread::sleep(Duration::from_millis(5));
        assert!(gateway.expired(Duration::from_millis(1)));
    }

    #[test]
    fn a_full_media_set_evicts_the_oldest_unleased_stream_and_never_touches_live_folders() {
        let mut gateways: HashMap<String, Arc<Gateway>> = HashMap::new();
        gateways.insert("live".into(), Arc::new(bare(None)));
        for index in 0..MEDIA_MAX {
            gateways.insert(format!("m{index}"), Arc::new(bare(Some("a.mp4"))));
            std::thread::sleep(Duration::from_millis(2));
        }
        let held = gateways["m0"].lease();
        make_room(&mut gateways, true).unwrap();
        assert!(gateways.contains_key("live") && gateways.contains_key("m0"));
        assert!(!gateways.contains_key("m1"), "oldest unleased goes first");
        assert!(gateways.values().filter(|gate| gate.file.is_some()).count() < MEDIA_MAX);
        for gate in gateways.values().filter(|gate| gate.file.is_some()) {
            gate.lease();
        }
        make_room(&mut gateways, true).unwrap();
        for index in 0..MEDIA_MAX {
            gateways
                .entry(format!("n{index}"))
                .or_insert_with(|| Arc::new(bare(Some("b.mp4"))))
                .lease();
        }
        assert!(make_room(&mut gateways, true).is_err());
        assert!(gateways["m0"].release(&held));
        // Live folders have their own cap, unaffected by media.
        assert!(make_room(&mut gateways, false).is_ok());
    }

    #[test]
    fn capabilities_are_at_least_128_bits_of_hex() {
        let source: Arc<dyn Reader> = Arc::new(Closed);
        let gateway = listen(
            source,
            "/".into(),
            "id".into(),
            "m".into(),
            "e".into(),
            None,
        )
        .unwrap();
        let hex = gateway.capability.strip_prefix("bycoda-").unwrap();
        assert!(hex.len() >= 32 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()));
        gateway.stop();
    }

    #[test]
    fn media_urls_stay_loopback_with_the_opaque_capability_and_encoded_name() {
        let gateway = bare(Some("x"));
        assert_eq!(
            format!(
                "{}{}",
                gateway.url(),
                protocol::encode_segment("ölçüm & 1.mp4")
            ),
            "http://127.0.0.1:4321/bycoda-token/%C3%B6l%C3%A7%C3%BCm%20%26%201.mp4"
        );
    }

    struct Closed;
    impl Reader for Closed {
        fn call(&self, _: &str, _: Value) -> Result<Value, String> {
            Err("closed".into())
        }
        fn current(&self) -> bool {
            false
        }
    }
}
