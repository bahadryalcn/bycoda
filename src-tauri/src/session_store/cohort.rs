//! Mandatory participation by this native version, before any writable SQLite
//! open. Kernel leases track connection lifetime, never heartbeat/PID guesses.
//! This registry cannot discover old binaries which never registered. Its
//! coverage is ALWAYS unknown and it is NOT migration/floor activation proof.
#![allow(dead_code)] // Native-only inspection awaits the authenticated coordinator.

#[path = "cohort_os.rs"]
mod os;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions, TryLockError},
    io::{Read, Write},
    ops::{Deref, DerefMut},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::{Duration, Instant},
};

const MAX_ACTORS: usize = 128;
const MAX_RECORD_BYTES: usize = 64 * 1024;
const ADMISSION_WAIT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoreBinding {
    pub canonical_path: PathBuf,
    pub physical_file_id: String,
}

impl StoreBinding {
    fn resolve(path: &Path, create: bool) -> Result<Self, String> {
        if create {
            if let Some(parent) = path.parent().filter(|path| !path.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)
                    .map_err(|_| "Native writer database directory is unavailable")?;
            }
        }
        // Creating the empty filesystem entry is not opening SQLite. Its real
        // file identity and all registration work precede Connection::open.
        let file = OpenOptions::new()
            .read(true)
            .write(create)
            .create(create)
            .truncate(false)
            .open(path)
            .map_err(|_| "Native writer database identity cannot be opened")?;
        if !file
            .metadata()
            .map_err(|_| "Native writer database metadata is unavailable")?
            .is_file()
        {
            return Err("Native writer database must be a regular file".into());
        }
        let (physical_file_id, links) = os::file_identity(&file)?;
        if links != 1 {
            return Err("Hardlinked writable SQLite databases are unsupported; use the original profile database".into());
        }
        let canonical_path = std::fs::canonicalize(path)
            .map_err(|_| "Native writer database path cannot be resolved")?;
        if canonical_path.to_str().is_none() {
            return Err("Native writer database path cannot be represented safely".into());
        }
        Ok(Self {
            canonical_path,
            physical_file_id,
        })
    }
    fn registry(&self) -> Result<PathBuf, String> {
        let parent = self
            .canonical_path
            .parent()
            .ok_or("Native writer database has no parent")?;
        let hash = Sha256::digest(
            self.canonical_path
                .to_str()
                .ok_or("Native writer database path is invalid")?
                .as_bytes(),
        );
        Ok(parent.join(format!(".bycoda-writers-{hash:x}")))
    }
    fn key(&self) -> String {
        format!(
            "{}:{}",
            self.canonical_path.display(),
            self.physical_file_id
        )
    }
    fn verify(&self) -> Result<(), String> {
        if Self::resolve(&self.canonical_path, false)? != *self {
            return Err("Native writer database identity changed during admission".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ActorRecord {
    pub protocol: u64,
    pub actor_id: String,
    pub registration_id: String,
    pub process_id: u32,
    pub process_start: Option<String>,
    pub executable_path: PathBuf,
    pub binding: StoreBinding,
    pub writer_protocol: u64,
}

#[derive(Clone)]
struct NativeActor {
    id: String,
    pid: u32,
    start: Option<String>,
    executable: PathBuf,
}
fn native_actor() -> Result<&'static NativeActor, String> {
    static ACTOR: OnceLock<Result<NativeActor, String>> = OnceLock::new();
    ACTOR
        .get_or_init(|| {
            let executable = std::env::current_exe()
                .and_then(std::fs::canonicalize)
                .map_err(|_| "Native writer executable identity is unavailable".to_owned())?;
            if executable.to_str().is_none() {
                return Err(
                    "Native writer executable identity cannot be represented safely".into(),
                );
            }
            Ok(NativeActor {
                id: uuid::Uuid::new_v4().to_string(),
                pid: std::process::id(),
                start: os::process_start()?,
                executable,
            })
        })
        .as_ref()
        .map_err(Clone::clone)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Coverage {
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LeaseState {
    Live,
    Unleased,
}
#[derive(Clone, Debug)]
pub(crate) struct Observation {
    pub actor: ActorRecord,
    pub lease: LeaseState,
}
#[derive(Clone, Debug)]
pub(crate) struct Census {
    pub binding: StoreBinding,
    pub coverage: Coverage,
    pub actors: Vec<Observation>,
}

struct Gate {
    file: File,
    path: PathBuf,
}
impl Gate {
    fn acquire(binding: &StoreBinding) -> Result<Self, String> {
        let directory = binding.registry()?;
        os::registry_directory(&directory)?;
        let path = directory.join("admission.lock");
        let file = os::safe_file(&path, true, false)?;
        let until = Instant::now() + ADMISSION_WAIT;
        loop {
            match file.try_lock() {
                Ok(()) => break,
                Err(TryLockError::WouldBlock) if Instant::now() < until => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                Err(TryLockError::WouldBlock) => return Err(
                    "Native writer admission is frozen or busy; retry after inspection finishes"
                        .into(),
                ),
                Err(TryLockError::Error(_)) => {
                    return Err("Native writer admission lock is unavailable".into())
                }
            }
        }
        let gate = Self { file, path };
        gate.verify()?;
        Ok(gate)
    }
    fn verify(&self) -> Result<(), String> {
        let current = os::safe_file(&self.path, false, false)?;
        if os::file_identity(&current)?.0 != os::file_identity(&self.file)?.0 {
            return Err("Native writer admission file changed".into());
        }
        Ok(())
    }
    fn scan(&self, binding: &StoreBinding) -> Result<Vec<(PathBuf, Observation)>, String> {
        self.verify()?;
        binding.verify()?;
        let directory = self
            .path
            .parent()
            .ok_or("Native writer registry path is invalid")?;
        let mut names: HashMap<String, u8> = HashMap::new();
        for entry in std::fs::read_dir(directory)
            .map_err(|_| "Native writer census cannot enumerate participants")?
        {
            let entry = entry.map_err(|_| "Native writer census entry is unavailable")?;
            if entry.file_name() == "admission.lock" {
                continue;
            }
            let path = entry.path();
            let filename = path
                .file_stem()
                .and_then(|name| name.to_str())
                .ok_or("Native writer census has an unknown entry")?;
            let extension = match path.extension().and_then(|value| value.to_str()) {
                Some("json") => 1,
                Some("lease") => 2,
                _ => return Err("Native writer census has an unknown entry".into()),
            };
            if !uuid::Uuid::parse_str(filename).is_ok_and(|id| id.to_string() == filename) {
                return Err("Native writer census has an unknown entry".into());
            }
            if names.len() >= MAX_ACTORS && !names.contains_key(filename) {
                return Err("Native writer census exceeds its participant bound".into());
            }
            *names.entry(filename.to_owned()).or_default() |= extension;
        }
        let mut names: Vec<_> = names.into_iter().collect();
        names.sort_by(|left, right| left.0.cmp(&right.0));
        let mut result = Vec::new();
        for (filename, files) in names {
            if files != 3 {
                return Err("Native writer participant publication is incomplete".into());
            }
            let path = directory.join(format!("{filename}.json"));
            // Windows byte-range locks are mandatory for reads too. Keep the
            // kernel lease separate from immutable participant metadata.
            let lease_file = os::safe_file(&path.with_extension("lease"), false, false)?;
            if lease_file
                .metadata()
                .map_err(|_| "Native writer lease metadata is unavailable")?
                .len()
                != 0
            {
                return Err("Native writer lease file is corrupt".into());
            }
            let lease = match lease_file.try_lock() {
                Ok(()) => LeaseState::Unleased,
                Err(TryLockError::WouldBlock) => LeaseState::Live,
                Err(TryLockError::Error(_)) => {
                    return Err("Native writer lease state is unknown".into())
                }
            };
            let file = os::safe_file(&path, false, false)?;
            let mut bytes = Vec::new();
            (&file)
                .take(MAX_RECORD_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Native writer participant metadata cannot be read")?;
            if bytes.len() > MAX_RECORD_BYTES {
                return Err("Native writer participant metadata exceeds its bound".into());
            }
            let record: ActorRecord = serde_json::from_slice(&bytes)
                .map_err(|_| "Native writer participant metadata is invalid or incomplete")?;
            if record.protocol != 1
                || record.registration_id != filename
                || uuid::Uuid::parse_str(&record.actor_id).is_err()
                || record.process_id == 0
                || !record.executable_path.is_absolute()
                || record.binding != *binding
            {
                return Err("Native writer participant identity or binding is unknown".into());
            }
            result.push((
                path,
                Observation {
                    actor: record,
                    lease,
                },
            ));
        }
        Ok(result)
    }
}

pub(crate) struct Inspection {
    _gate: Gate,
    census: Census,
}
impl Inspection {
    /// Excludes new supported registrations/reopens, NOT writes by actors whose
    /// leases are live. Unknown older binaries remain outside this registry.
    pub(crate) fn begin(path: &Path) -> Result<Self, String> {
        let binding = StoreBinding::resolve(path, false)?;
        let gate = Gate::acquire(&binding)?;
        let actors = gate
            .scan(&binding)?
            .into_iter()
            .map(|(_, actor)| actor)
            .collect();
        Ok(Self {
            _gate: gate,
            census: Census {
                binding,
                coverage: Coverage::Unknown,
                actors,
            },
        })
    }
    pub(crate) fn census(&self) -> &Census {
        &self.census
    }
}

pub(crate) struct Registration {
    pub(crate) record: ActorRecord,
    _metadata: File,
    // Metadata handles close before the final OS lease is released, so an
    // Unleased observation cannot race a still-open metadata deletion handle.
    _lease: File,
}
type Registrations = Mutex<HashMap<String, Weak<Registration>>>;
fn registrations() -> &'static Registrations {
    static REGISTRATIONS: OnceLock<Registrations> = OnceLock::new();
    REGISTRATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) struct OpenAdmission {
    gate: Gate,
    pub(super) registration: Arc<Registration>,
}
impl OpenAdmission {
    pub(super) fn begin(path: &Path) -> Result<Self, String> {
        let binding = StoreBinding::resolve(path, true)?;
        let gate = Gate::acquire(&binding)?;
        // Always take the cross-process gate BEFORE cache lookup. An existing
        // local registration never permits a reopen through an inspection.
        let actors = gate.scan(&binding)?;
        let mut cached = registrations()
            .lock()
            .map_err(|_| "Native writer registration cache is unavailable")?;
        cached.retain(|_, value| value.strong_count() != 0);
        if let Some(registration) = cached.get(&binding.key()).and_then(Weak::upgrade) {
            if !actors.iter().any(|(_, entry)| {
                entry.actor == registration.record && entry.lease == LeaseState::Live
            }) {
                return Err("Native writer's retained registration changed".into());
            }
            return Ok(Self { gate, registration });
        }
        if cached.len() >= MAX_ACTORS {
            return Err("Native writer registration store bound exceeded".into());
        }
        let mut live = 0;
        for (path, actor) in actors {
            if actor.lease == LeaseState::Unleased {
                // The exclusive probe proved this record has no kernel lease,
                // not that its PID is dead. Never prune unknown/corrupt records.
                std::fs::remove_file(&path)
                    .map_err(|_| "Native writer unleased record cannot be retired")?;
                std::fs::remove_file(path.with_extension("lease"))
                    .map_err(|_| "Native writer unleased lease cannot be retired")?;
            } else {
                live += 1;
            }
        }
        if live >= MAX_ACTORS {
            return Err("Native writer participant bound exceeded".into());
        }
        let actor = native_actor()?;
        let record = ActorRecord {
            protocol: 1,
            actor_id: actor.id.clone(),
            registration_id: uuid::Uuid::new_v4().to_string(),
            process_id: actor.pid,
            process_start: actor.start.clone(),
            executable_path: actor.executable.clone(),
            binding: binding.clone(),
            writer_protocol: super::authority::WRITER_PROTOCOL,
        };
        let bytes =
            serde_json::to_vec(&record).map_err(|_| "Native writer identity cannot be encoded")?;
        if bytes.len() > MAX_RECORD_BYTES {
            return Err("Native writer identity exceeds its metadata bound".into());
        }
        let path = gate
            .path
            .parent()
            .unwrap()
            .join(format!("{}.json", record.registration_id));
        let lease = os::safe_file(&path.with_extension("lease"), true, true)?;
        lease
            .try_lock()
            .map_err(|_| "Native writer cannot acquire its participant lease")?;
        let mut file = os::safe_file(&path, true, true)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Native writer registration cannot be persisted")?;
        gate.verify()?;
        binding.verify()?;
        let registration = Arc::new(Registration {
            record,
            _lease: lease,
            _metadata: file,
        });
        cached.insert(binding.key(), Arc::downgrade(&registration));
        Ok(Self { gate, registration })
    }
    pub(super) fn path(&self) -> &Path {
        &self.registration.record.binding.canonical_path
    }
    pub(super) fn verify(&self) -> Result<(), String> {
        self.gate.verify()?;
        self.registration.record.binding.verify()
    }
}

/// The lease follows the SQLite connection itself through every Arc clone,
/// including provider admission reservations which outlive SessionStore.
pub(crate) struct RegisteredConnection {
    connection: Connection,
    registration: Option<Arc<Registration>>,
}
impl RegisteredConnection {
    pub(super) fn new(connection: Connection, registration: Arc<Registration>) -> Self {
        Self {
            connection,
            registration: Some(registration),
        }
    }
    #[cfg(test)]
    pub(super) fn in_memory(connection: Connection) -> Self {
        Self {
            connection,
            registration: None,
        }
    }
    pub(super) fn inspect(&self) -> Result<Inspection, String> {
        let registration = self
            .registration
            .as_ref()
            .ok_or("In-memory stores have no physical writer cohort")?;
        Inspection::begin(&registration.record.binding.canonical_path)
    }
}
impl Deref for RegisteredConnection {
    type Target = Connection;
    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}
impl DerefMut for RegisteredConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.connection
    }
}

#[cfg(test)]
#[path = "cohort_tests.rs"]
mod tests;
