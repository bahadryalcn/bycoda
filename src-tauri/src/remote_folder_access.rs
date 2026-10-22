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
use tauri::{AppHandle, Manager, State};

#[path = "remote_folder_access/os_adapter.rs"]
mod os_adapter;
#[path = "remote_folder_access/protocol.rs"]
mod protocol;

const IDLE: Duration = Duration::from_secs(15 * 60);
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
    reader: Arc<dyn Reader>,
    alive: AtomicBool,
    active: AtomicUsize,
    touched: Mutex<Instant>,
    mount: Mutex<Option<os_adapter::Mount>>,
}

impl Gateway {
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
        capability: format!("bycoda-{}", uuid::Uuid::new_v4().simple()),
        root,
        root_identity,
        machine_id,
        environment_id,
        reader,
        alive: AtomicBool::new(true),
        active: AtomicUsize::new(0),
        touched: Mutex::new(Instant::now()),
        mount: Mutex::new(None),
    });
    let running = gateway.clone();
    std::thread::spawn(move || {
        let mut checked = Instant::now();
        while running.alive.load(Ordering::SeqCst) {
            if checked.elapsed() >= Duration::from_secs(1) {
                let idle = running
                    .touched
                    .lock()
                    .map(|time| time.elapsed() > IDLE)
                    .unwrap_or(true);
                if idle || !running.reader.current() {
                    break;
                }
                checked = Instant::now();
            }
            match listener.accept() {
                Ok((socket, peer)) => {
                    if !peer.ip().is_loopback() || running.active.load(Ordering::SeqCst) >= 16 {
                        continue;
                    }
                    running.active.fetch_add(1, Ordering::SeqCst);
                    let session = running.clone();
                    std::thread::spawn(move || {
                        let _ = protocol::serve(socket, &session);
                        session.active.fetch_sub(1, Ordering::SeqCst);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25))
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

#[tauri::command(async)]
pub fn remote_open_live_folder(
    app: AppHandle,
    state: State<'_, RemoteConnections>,
    machine_id: String,
    environment_id: String,
    path: String,
) -> Result<(), String> {
    os_adapter::check_available()?;
    if path.len() > 4096 || path.chars().any(|ch| ch.is_control()) {
        return Err("Invalid connected folder path".into());
    }
    let store = store_path(&app)?;
    let machine = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        read(&store)?
            .into_iter()
            .find(|machine| machine.id == machine_id && machine.environment_id == environment_id)
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
        access.machine.id,
        access.machine.environment_id,
        access.machine.token,
        access.endpoint,
        path,
        root_identity
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
            if gateways.len() >= 8 {
                return Err(
                    "Too many live folders are open. Close an unused folder and try again later."
                        .into(),
                );
            }
            let gateway = listen(access, path, root_identity, machine_id, environment_id)?;
            gateways.insert(key, gateway.clone());
            (gateway, true)
        }
    };
    gateway.touch();
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
}
