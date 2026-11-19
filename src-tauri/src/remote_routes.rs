//! Other ways to reach an SSH machine, learned from its Host. A connected Host
//! reports its home-network and Tailscale IPv4 addresses in
//! `environment.describe`; they are kept per saved address so a later dial can
//! try them when the saved addresses do not answer (Tailscale signed out at
//! home, or the home network unreachable on the road).
//!
//! Saved addresses are never changed. Each report replaces what the machine
//! taught before, so a changed DHCP address replaces the old one. A learned
//! address is a hint: ssh checks it against the host key filed for the saved
//! address, and the Host must answer with the saved environment id, so a
//! different machine that now holds that address is never used.
//!
//! A tunnel that had to use a later address moves back to a preferred one once
//! that answers again (`watch_better_routes`), the way the reference app preflights its
//! earlier routes: the new tunnel signs in completely before it replaces the
//! running one, and an address that stays silent or fails is checked less often.

use crate::remote::RemoteConnections;
use crate::remote_ssh::{LaterRoute, SshTarget, Tunnel};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};
use tauri::Manager;

/// At most this many learned addresses per machine; each is probed on a dial.
const MAX_ROUTES: usize = 6;
const FILE: &str = "remote-routes.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedRoute {
    /// `user@address`, ready to dial.
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

/// Which kind of address a machine is dialed over first. `Saved` keeps the
/// saved address first, then its other address, then reported ones.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Prefer {
    #[default]
    Saved,
    Lan,
    Tailscale,
}

impl Prefer {
    fn is_saved(&self) -> bool {
        *self == Prefer::Saved
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    /// HTTPS account routes are separate from SSH dial targets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    account_endpoints: Vec<String>,
    /// What the Host last reported, so an unchanged report costs nothing.
    #[serde(default)]
    reported: Vec<String>,
    /// Whether `routes` was worked out for `reported` by a successful `ssh -G`.
    /// Anything else is retried on a later identical report instead of being
    /// treated as settled. Files from before this field start unsettled.
    #[serde(default)]
    resolved: bool,
    #[serde(default)]
    routes: Vec<LearnedRoute>,
    /// What a successful `ssh -G` confirmed `routes` for. A transient probe
    /// failure keeps those routes only for the same identity and address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    confirmed: Option<Confirmed>,
    /// Addresses the owner turned off: never dialed. A new report keeps them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    disabled: Vec<String>,
    #[serde(default, skip_serializing_if = "Prefer::is_saved")]
    prefer: Prefer,
}

/// The identity and address inputs a confirmed route list was learned under.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Confirmed {
    environment_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    alternate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    identity_file: Option<String>,
}

fn confirmed_for(target: &SshTarget, environment_id: &str) -> Confirmed {
    Confirmed {
        environment_id: environment_id.to_string(),
        alternate: target
            .alternate
            .as_deref()
            .map(host_of)
            .filter(|host| !host.is_empty()),
        identity_file: target.identity_file.clone(),
    }
}

#[derive(Default)]
struct Store {
    path: Option<PathBuf>,
    machines: HashMap<String, Entry>,
    /// Counts saved snapshots, so the file is only ever replaced by a newer one.
    generation: u64,
    /// Serialized under the lock, written once the lock is released.
    pending: Option<Snapshot>,
}

/// What `persist` saved: the file's bytes and the generation they belong to.
struct Snapshot {
    path: PathBuf,
    bytes: Vec<u8>,
    generation: u64,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);
/// The generation of the file last written. Held only while writing, never
/// together with `STORE`, so an fsync never blocks a dial or a route listing.
static WRITTEN: Mutex<u64> = Mutex::new(0);
/// The account tunnel each environment's latest `environment.describe` answered
/// over, `None` once the saved route answered instead. Memory only.
static ACCOUNT_IN_USE: Mutex<Vec<(String, Option<String>)>> = Mutex::new(Vec::new());

pub(crate) fn note_account_route(environment_id: &str, endpoint: Option<&str>) {
    let mut guard = ACCOUNT_IN_USE
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    guard.retain(|(id, _)| id != environment_id);
    guard.push((environment_id.to_string(), endpoint.map(str::to_string)));
}

pub(crate) fn account_in_use(environment_id: &str) -> Option<String> {
    let guard = ACCOUNT_IN_USE
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    guard
        .iter()
        .find(|(id, _)| id == environment_id)
        .and_then(|(_, endpoint)| endpoint.clone())
}

pub(crate) fn account_tunnel(value: &str) -> Option<String> {
    if value.len() > 256 {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    let host = url.host_str()?;
    let label = host.strip_suffix(".trycloudflare.com")?;
    (url.scheme() == "https"
        && !label.is_empty()
        && label
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == "/")
        .then(|| url.origin().ascii_serialization())
}

pub(crate) fn account_endpoints(environment_id: &str) -> Vec<String> {
    with_store(|store| {
        store
            .machines
            .get(&format!("account:{environment_id}"))
            .map(|entry| {
                entry
                    .account_endpoints
                    .iter()
                    .filter_map(|endpoint| account_tunnel(endpoint))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// Called only after credential-free possession proof and saved-route fencing.
pub(crate) fn learn_account_endpoint(environment_id: &str, endpoint: String) -> bool {
    with_store(|store| {
        let entry = store
            .machines
            .entry(format!("account:{environment_id}"))
            .or_default();
        if entry.account_endpoints == [endpoint.clone()] {
            return false;
        }
        entry.account_endpoints = vec![endpoint];
        persist(store);
        true
    })
}

/// Longest a descriptor request may take.
const IDENTITY_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// Longest the possession-proof request may take.
const PROOF_REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
/// Total time a caller without a deadline of its own gives one verification.
pub(crate) const IDENTITY_BUDGET: Duration = Duration::from_secs(11);
/// How long a completed identity and possession proof stands in for a new one.
const PROOF_FRESH_FOR: Duration = Duration::from_secs(60);
/// More proofs than machines a person pairs; the oldest is dropped first.
const MAX_PROOFS: usize = 16;

/// One completed identity and possession proof, scoped to the exact route, the
/// machine and the credential it was made with. The credential is kept only as a
/// digest, in memory.
struct Proof {
    origin: String,
    environment_id: String,
    credential: [u8; 32],
    at: Instant,
    wall: std::time::SystemTime,
}

impl Proof {
    fn matches(&self, origin: &str, environment_id: &str, credential: &[u8; 32]) -> bool {
        self.origin == origin
            && self.environment_id == environment_id
            && self.credential == *credential
    }

    /// Both clocks must agree that it is recent: a suspended monotonic clock or a
    /// wall clock set backwards never extends a proof, it ends it.
    fn is_current(&self, now: Instant, wall: std::time::SystemTime) -> bool {
        now.checked_duration_since(self.at)
            .is_some_and(|age| age < PROOF_FRESH_FOR)
            && wall
                .duration_since(self.wall)
                .is_ok_and(|age| age < PROOF_FRESH_FOR)
    }
}

#[derive(Default)]
struct ProofCache(Vec<Proof>);

impl ProofCache {
    fn is_fresh(
        &mut self,
        origin: &str,
        environment_id: &str,
        credential: &[u8; 32],
        now: Instant,
        wall: std::time::SystemTime,
    ) -> bool {
        self.0.retain(|proof| proof.is_current(now, wall));
        self.0
            .iter()
            .any(|proof| proof.matches(origin, environment_id, credential))
    }

    fn remember(
        &mut self,
        origin: &str,
        environment_id: &str,
        credential: [u8; 32],
        now: Instant,
        wall: std::time::SystemTime,
    ) {
        self.0
            .retain(|proof| !proof.matches(origin, environment_id, &credential));
        self.0.push(Proof {
            origin: origin.to_string(),
            environment_id: environment_id.to_string(),
            credential,
            at: now,
            wall,
        });
        while self.0.len() > MAX_PROOFS {
            self.0.remove(0);
        }
    }

    fn forget(&mut self, environment_id: &str, origin: &str) {
        self.0
            .retain(|proof| !(proof.environment_id == environment_id && proof.origin == origin));
    }
}

static PROOFS: Mutex<Option<ProofCache>> = Mutex::new(None);

fn credential_digest(token: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"bycoda-account-route-credential-v1\0");
    hasher.update(token.as_bytes());
    hasher.finalize().into()
}

/// A poisoned lock is a miss: nothing is reused unless the cache can be trusted.
fn with_proofs<T>(action: impl FnOnce(&mut ProofCache) -> T) -> Option<T> {
    let mut guard = PROOFS.lock().ok()?;
    Some(action(guard.get_or_insert_with(ProofCache::default)))
}

/// Ends reuse of the proof for this route, whatever credential made it. Call
/// when the route or its Host stops answering as proven.
pub(crate) fn forget_account_identity(environment_id: &str, endpoint: &str) {
    if let Some(origin) = account_tunnel(endpoint) {
        with_proofs(|cache| cache.forget(environment_id, &origin));
    }
}

/// Proves that `endpoint` is this machine's Host: the public descriptor names
/// `environment_id` and the Host shows possession of `token`. A completed proof
/// is reused for `PROOF_FRESH_FOR` for the same route, machine and credential
/// only; a failed one is never kept. `budget` bounds all requests made here, and
/// the proof requests use the shared pooled agent with its TLS validation.
pub(crate) fn verify_account_endpoint(
    endpoint: &str,
    environment_id: &str,
    token: &str,
    budget: Duration,
) -> Result<(), String> {
    let origin = account_tunnel(endpoint).ok_or("Invalid account tunnel route")?;
    let credential = credential_digest(token);
    if with_proofs(|cache| {
        cache.is_fresh(
            &origin,
            environment_id,
            &credential,
            Instant::now(),
            std::time::SystemTime::now(),
        )
    })
    .unwrap_or(false)
    {
        return Ok(());
    }
    let deadline = Instant::now() + budget;
    let remaining = |cap: Duration| {
        deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .map(|left| left.min(cap))
            .ok_or_else(|| "Account route identity could not be verified in time".to_string())
    };
    let response = crate::remote::rpc_agent()
        .get(&format!("{origin}/.well-known/bycoda-host"))
        .timeout(remaining(IDENTITY_REQUEST_TIMEOUT)?)
        .call()
        .map_err(|_| "Account route identity could not be verified")?;
    let descriptor: Value = serde_json::from_reader(response.into_reader().take(4096))
        .map_err(|_| "Invalid account route identity")?;
    if descriptor.get("environmentId").and_then(Value::as_str) != Some(environment_id) {
        return Err("Host identity changed".into());
    }
    crate::remote::host_proof::verify(
        &origin,
        environment_id,
        token,
        "device",
        remaining(PROOF_REQUEST_TIMEOUT)?,
    )?;
    with_proofs(|cache| {
        cache.remember(
            &origin,
            environment_id,
            credential,
            Instant::now(),
            std::time::SystemTime::now(),
        )
    });
    Ok(())
}

pub(crate) fn retire_account_endpoint(environment_id: &str, endpoint: &str) {
    forget_account_identity(environment_id, endpoint);
    with_store(|store| {
        if let Some(entry) = store.machines.get_mut(&format!("account:{environment_id}")) {
            entry.account_endpoints.retain(|known| known != endpoint);
            persist(store);
        }
    });
    if account_in_use(environment_id).as_deref() == Some(endpoint) {
        note_account_route(environment_id, None);
    }
}

fn with_store<T>(action: impl FnOnce(&mut Store) -> T) -> T {
    let (result, pending) = {
        let mut guard = STORE.lock().unwrap_or_else(PoisonError::into_inner);
        let store = guard.get_or_insert_with(Store::default);
        let result = action(store);
        (result, store.pending.take())
    };
    if let Some(snapshot) = pending {
        write_snapshot(snapshot);
    }
    result
}

/// Loads what earlier runs learned, so the first dial after a restart can
/// already use it. A missing or unreadable file starts empty.
pub fn init(directory: &Path) {
    let path = directory.join(FILE);
    let machines = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    with_store(|store| {
        store.path = Some(path);
        store.machines = machines;
    });
}

fn key(target: &SshTarget) -> String {
    format!(
        "{}#{}",
        target.target.trim().to_ascii_lowercase(),
        target.port.unwrap_or(0)
    )
}

/// The addresses this machine's Host taught, in the order it reported them.
pub fn learned(target: &SshTarget) -> Vec<LearnedRoute> {
    with_store(|store| {
        store
            .machines
            .get(&key(target))
            .map(|entry| entry.routes.clone())
            .unwrap_or_default()
    })
}

fn address_kind(host: &str) -> Option<Prefer> {
    let ip: Ipv4Addr = host.trim().trim_matches(['[', ']']).parse().ok()?;
    let [a, b, ..] = ip.octets();
    if a == 100 && (64..=127).contains(&b) {
        Some(Prefer::Tailscale)
    } else {
        ip.is_private().then_some(Prefer::Lan)
    }
}

/// Applies the owner's choices to `candidates` (saved address first): drops
/// turned-off addresses the Host reported (never the saved or other address,
/// which the owner edits instead), and moves the preferred kind of
/// address to the front, keeping the order within each group. A saved ssh-config
/// alias has no known kind and keeps its place among the others.
pub fn arrange(target: &SshTarget, candidates: Vec<SshTarget>) -> Vec<SshTarget> {
    let other = target.alternate.as_deref().map(host_of);
    let (disabled, prefer) = with_store(|store| {
        store
            .machines
            .get(&key(target))
            .map(|entry| (entry.disabled.clone(), entry.prefer))
            .unwrap_or_default()
    });
    let mut kept: Vec<SshTarget> = candidates
        .into_iter()
        .enumerate()
        .filter(|(index, dial)| {
            let host = host_of(&dial.target);
            // The saved and other address are the owner's own entries: always tried.
            *index == 0 || other.as_deref() == Some(host.as_str()) || !disabled.contains(&host)
        })
        .map(|(_, dial)| dial)
        .collect();
    if !prefer.is_saved() {
        kept.sort_by_key(|dial| address_kind(&host_of(&dial.target)) != Some(prefer));
    }
    kept
}

/// Home-network (10/8, 172.16/12, 192.168/16) and Tailscale (100.64/10)
/// addresses only: a Host's public or loopback address is never learned.
fn usable(address: &str) -> Option<String> {
    let ip: Ipv4Addr = address.trim().parse().ok()?;
    let [a, b, ..] = ip.octets();
    let tailnet = a == 100 && (64..=127).contains(&b);
    (ip.is_private() || tailnet).then(|| ip.to_string())
}

fn reported_addresses(descriptor: &Value) -> Vec<String> {
    let mut addresses: Vec<String> = Vec::new();
    for address in descriptor
        .get("addresses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(usable)
    {
        if !addresses.contains(&address) {
            addresses.push(address);
        }
    }
    addresses.truncate(MAX_ROUTES);
    addresses
}

fn host_of(target: &str) -> String {
    let host = target.rsplit_once('@').map_or(target, |(_, host)| host);
    host.trim().trim_matches(['[', ']']).to_ascii_lowercase()
}

/// The user, host name and port ssh would use for the saved address.
fn resolved(target: &SshTarget) -> Option<(String, String, u16)> {
    let dump = crate::remote_ssh::ssh_config_dump(target)?;
    let field = |name: &str| {
        dump.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(' '))
            .map(|value| value.trim().to_string())
    };
    Some((
        field("user")?,
        field("hostname")?,
        field("port")?.parse().ok()?,
    ))
}

/// What probing the saved address for the reported ones came to.
#[derive(Debug, PartialEq, Eq)]
enum Probe {
    /// `ssh -G` answered: these routes are settled for the report.
    Resolved(Vec<LearnedRoute>),
    /// `ssh -G` failed or timed out but the saved `user@host` can still be
    /// reused: a guess (the configured port is unknown) that is retried later.
    Fallback(Vec<LearnedRoute>),
    /// `ssh -G` failed and nothing can be derived (an ssh-config alias).
    Unknown,
}

/// Dial targets for the reported addresses, skipping ones the machine is
/// already saved under. They sign in as the saved user on the saved port.
fn routes_for(target: &SshTarget, reported: &[String]) -> Probe {
    routes_from(target, reported, resolved(target))
}

/// `routes_for` with the `ssh -G` answer given, so it needs no ssh.
fn routes_from(
    target: &SshTarget,
    reported: &[String],
    probed: Option<(String, String, u16)>,
) -> Probe {
    let explicit_user = target
        .target
        .rsplit_once('@')
        .map(|(user, _)| user.to_string());
    let confirmed = probed.is_some();
    let (user, hostname, port) = match (probed, explicit_user) {
        (Some((user, hostname, port)), explicit) => {
            (explicit.unwrap_or(user), hostname, Some(port))
        }
        // shortcut: without `ssh -G` only a saved user@host can be reused; an
        // ssh-config alias then learns nothing until ssh can be inspected.
        (None, Some(user)) => (user, host_of(&target.target), target.port),
        (None, None) => return Probe::Unknown,
    };
    let saved = [
        Some(host_of(&target.target)),
        Some(hostname.to_ascii_lowercase()),
        target.alternate.as_deref().map(host_of),
    ];
    let routes = reported
        .iter()
        .filter(|address| !saved.iter().flatten().any(|host| host == *address))
        .map(|address| LearnedRoute {
            target: format!("{user}@{address}"),
            port,
        })
        .collect();
    if confirmed {
        Probe::Resolved(routes)
    } else {
        Probe::Fallback(routes)
    }
}

/// Stores what a probe of `reported` found. A probe that did not resolve never
/// erases routes `ssh -G` confirmed before: they stay (only those the Host
/// still reports) while the identity and address inputs are the same, and the
/// entry stays unsettled so a later report retries. Routes confirmed under a
/// different identity or address are dropped, never carried over.
fn apply_probe(entry: &mut Entry, confirmed: &Confirmed, reported: &[String], probe: Probe) {
    let keeps = entry.confirmed.as_ref().is_none_or(|known| known == confirmed);
    match probe {
        Probe::Resolved(routes) => {
            entry.routes = routes;
            entry.confirmed = Some(confirmed.clone());
            entry.resolved = true;
            return;
        }
        Probe::Fallback(routes) if entry.confirmed.as_ref() != Some(confirmed) => {
            entry.routes = routes;
            entry.confirmed = None;
        }
        Probe::Fallback(_) | Probe::Unknown if keeps => {}
        Probe::Fallback(_) | Probe::Unknown => {
            entry.routes.clear();
            entry.confirmed = None;
        }
    }
    entry
        .routes
        .retain(|route| reported.contains(&host_of(&route.target)));
    entry.resolved = false;
}

/// Serializes the store under the lock; `with_store` writes it after the lock
/// is released.
fn persist(store: &mut Store) {
    let Some(path) = store.path.clone() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec_pretty(&store.machines) else {
        return;
    };
    store.generation += 1;
    store.pending = Some(Snapshot {
        path,
        bytes,
        generation: store.generation,
    });
}

/// Writes a snapshot unless a newer one already reached the file, so the file
/// always ends on the latest state even when writers overlap.
fn write_snapshot(snapshot: Snapshot) {
    let mut written = WRITTEN.lock().unwrap_or_else(PoisonError::into_inner);
    if snapshot.generation <= *written {
        return;
    }
    match write_file(&snapshot.path, &snapshot.bytes) {
        Ok(()) => *written = snapshot.generation,
        Err(error) => log::warn!(
            "Learned routes could not be saved to {}: {error}",
            snapshot.path.display()
        ),
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no directory"))?;
    std::fs::create_dir_all(parent)?;
    let temporary = parent.join(format!("{FILE}.{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = std::fs::File::create(&temporary)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| std::fs::rename(&temporary, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

/// How long after a probe started an unresolved report waits before another
/// `ssh -G` retry, so each describe does not spawn one.
const PROBE_RETRY: Duration = Duration::from_secs(5 * 60);

/// Per machine key: the earliest next retry of an unresolved probe. Memory
/// only, so a restart retries at the first describe.
static PROBE_RETRY_AT: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

/// Whether an unresolved probe for `key` may start now; if so, books the next.
fn probe_retry_due(key: &str) -> bool {
    let mut guard = PROBE_RETRY_AT.lock().unwrap_or_else(PoisonError::into_inner);
    let times = guard.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    if times.get(key).is_some_and(|next| now < *next) {
        return false;
    }
    times.insert(key.to_string(), now + PROBE_RETRY);
    true
}

/// Learns from a successful describe of `environment_id` over `target`. A
/// changed report, or one whose routes `ssh -G` never resolved (retried at
/// most every `PROBE_RETRY`), does the work on a worker thread, since
/// resolving the saved address runs `ssh -G`.
pub fn observe(target: &SshTarget, environment_id: &str, descriptor: &Value) {
    if descriptor.get("environmentId").and_then(Value::as_str) != Some(environment_id) {
        return;
    }
    // An older Host reports nothing; what it taught before stays.
    if descriptor.get("addresses").is_none() {
        return;
    }
    let reported = reported_addresses(descriptor);
    let key = key(target);
    let confirmed = confirmed_for(target, environment_id);
    let due = with_store(|store| {
        let entry = store.machines.entry(key.clone()).or_default();
        if entry.reported == reported {
            // Settled for this report, or still waiting out the retry delay.
            if entry.resolved || !probe_retry_due(&key) {
                return false;
            }
        } else {
            entry.reported = reported.clone();
            entry.resolved = false;
            probe_retry_due(&key);
        }
        true
    });
    if !due {
        return;
    }
    let target = target.clone();
    std::thread::spawn(move || {
        let probe = routes_for(&target, &reported);
        with_store(|store| {
            let entry = store.machines.entry(key).or_default();
            // A newer report arrived meanwhile; its own worker writes it.
            if entry.reported != reported {
                return;
            }
            apply_probe(entry, &confirmed, &reported, probe);
            persist(store);
        });
    });
}

/// How often a tunnel on a later address checks for a preferred one, and how
/// long a tunnel must have run before it is checked.
const BETTER_ROUTE_CHECK: Duration = Duration::from_secs(60);
/// A preferred address that stays silent, or answers but fails to sign in,
/// is checked half as often each time, up to this.
const BETTER_ROUTE_BACKOFF_MAX: Duration = Duration::from_secs(30 * 60);

/// Per machine and address: failures so far and when to check it next.
static HELD_BACK: Mutex<Option<HashMap<String, (u32, Instant)>>> = Mutex::new(None);

fn held_back_key(id: &str, dial: &SshTarget) -> String {
    format!("{id}\u{0}{}", dial.target)
}

fn backoff(failures: u32) -> Duration {
    BETTER_ROUTE_CHECK
        .saturating_mul(2u32.saturating_pow(failures))
        .min(BETTER_ROUTE_BACKOFF_MAX)
}

fn with_held_back<T>(action: impl FnOnce(&mut HashMap<String, (u32, Instant)>) -> T) -> T {
    let mut guard = HELD_BACK.lock().unwrap_or_else(PoisonError::into_inner);
    action(guard.get_or_insert_with(HashMap::new))
}

fn is_held_back(key: &str) -> bool {
    with_held_back(|held| {
        held.get(key)
            .is_some_and(|(_, until)| Instant::now() < *until)
    })
}

/// `steps` failures more: a silent address costs one, a failed sign-in more.
fn hold_back(key: String, steps: u32) {
    with_held_back(|held| {
        let failures = held.get(&key).map_or(0, |(failures, _)| *failures) + steps;
        held.insert(key, (failures, Instant::now() + backoff(failures)));
    });
}

/// A signed-in tunnel over the best preferred address that answers now.
fn better_tunnel(later: &LaterRoute) -> Option<Tunnel> {
    let due: Vec<SshTarget> = later
        .better
        .iter()
        .filter(|dial| !is_held_back(&held_back_key(&later.id, dial)))
        .cloned()
        .collect();
    let probes: Vec<_> = due
        .iter()
        .cloned()
        .map(|dial| std::thread::spawn(move || crate::remote_ssh::ssh_server_reachable(&dial)))
        .collect();
    let answers: Vec<Option<bool>> = probes
        .into_iter()
        .map(|probe| probe.join().ok().flatten())
        .collect();
    for (dial, answer) in due.into_iter().zip(answers) {
        let key = held_back_key(&later.id, &dial);
        if answer != Some(true) {
            hold_back(key, 1);
            continue;
        }
        match Tunnel::start_route(&dial, &later.saved) {
            Ok(tunnel) => {
                with_held_back(|held| held.remove(&key));
                return Some(tunnel);
            }
            // It answered but did not carry a tunnel: do not let a flaky
            // network bounce the connection between addresses.
            Err(_) => hold_back(key, 3),
        }
    }
    None
}

/// Most machines whose better-route check runs at once. A slow check holds only
/// its own slot, so the other machines are not delayed behind it.
const BETTER_ROUTE_WORKERS: usize = 4;

/// Machine ids whose better-route check is in flight.
type Checking = Arc<Mutex<HashSet<String>>>;

/// One machine's better-route check in flight. Dropping it frees the machine
/// and its worker slot.
struct CheckSlot {
    checking: Checking,
    id: String,
}

impl Drop for CheckSlot {
    fn drop(&mut self) {
        let mut checking = self.checking.lock().unwrap_or_else(PoisonError::into_inner);
        checking.remove(&self.id);
    }
}

/// A slot to check `id` now, unless `BETTER_ROUTE_WORKERS` checks run already or
/// one for `id` does; that machine is then checked on a later minute.
fn start_check(checking: &Checking, id: &str) -> Option<CheckSlot> {
    let mut ids = checking.lock().unwrap_or_else(PoisonError::into_inner);
    if ids.len() >= BETTER_ROUTE_WORKERS || ids.contains(id) {
        return None;
    }
    ids.insert(id.to_string());
    Some(CheckSlot {
        checking: checking.clone(),
        id: id.to_string(),
    })
}

/// Forgets held-back addresses whose machine `has_machine` no longer knows.
fn prune_held_back_in(
    held: &mut HashMap<String, (u32, Instant)>,
    has_machine: impl Fn(&str) -> bool,
) {
    held.retain(|key, _| has_machine(key.split('\u{0}').next().unwrap_or_default()));
}

fn prune_held_back(has_machine: impl Fn(&str) -> bool) {
    with_held_back(|held| prune_held_back_in(held, has_machine));
}

/// Started once at launch: every minute, each tunnel running over a later
/// address than its machine prefers tries the preferred ones, and moves to the
/// best that signs in. Each machine is checked on its own worker, at most
/// `BETTER_ROUTE_WORKERS` at once, so one slow machine does not hold up the rest.
/// Requests on the old tunnel then reconnect over the new one.
// shortcut: held-back addresses wait out their time even after a network
// change; forget them on a network-change signal once the desktop has one.
pub fn watch_better_routes(app: tauri::AppHandle) {
    let checking: Checking = Arc::new(Mutex::new(HashSet::new()));
    std::thread::spawn(move || loop {
        std::thread::sleep(BETTER_ROUTE_CHECK);
        let Some(state) = app.try_state::<RemoteConnections>() else {
            continue;
        };
        prune_held_back(|id| state.tunnels.has_machine(id));
        for later in state.tunnels.later_routes(BETTER_ROUTE_CHECK) {
            let Some(slot) = start_check(&checking, &later.id) else {
                continue;
            };
            let app = app.clone();
            std::thread::spawn(move || {
                let _slot = slot;
                let Some(tunnel) = better_tunnel(&later) else {
                    return;
                };
                let Some(state) = app.try_state::<RemoteConnections>() else {
                    return;
                };
                if state.tunnels.switch(&later, tunnel) {
                    state.invalidate_ws(&later.id);
                }
            });
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteView {
    address: String,
    /// `tailscale`, `lan`, `tunnel` (a Quick Tunnel from the account), or `name`
    /// for an ssh-config alias or host name.
    kind: &'static str,
    /// `saved`, `other` (the saved other address), `reported` by the Host or
    /// `account` (learned from the signed-in account).
    source: &'static str,
    /// Turned on; the saved address always is.
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineRoutes {
    /// Every address in the order a dial tries them now, turned-off ones last.
    routes: Vec<RouteView>,
    prefer: Prefer,
    /// The address the running tunnel dialed; absent while it is down.
    active: Option<String>,
}

fn route_view(target: &str, source: &'static str, enabled: bool) -> RouteView {
    let address = host_of(target);
    RouteView {
        kind: match address_kind(&address) {
            Some(Prefer::Tailscale) => "tailscale",
            Some(_) => "lan",
            None => "name",
        },
        address,
        source,
        enabled,
    }
}

/// Every address in a fixed order that does not move when one is turned on or
/// off: the saved one, its other address, then the reported ones, with the
/// preferred kind first. Turning a switch never moves another under the pointer.
fn route_list(
    saved: &str,
    other: Option<&str>,
    reported: &[String],
    disabled: &[String],
    prefer: Prefer,
) -> Vec<RouteView> {
    let mut hosts: Vec<(String, &'static str)> = vec![(saved.to_string(), "saved")];
    let others = other
        .map(|host| (host.to_string(), "other"))
        .into_iter()
        .chain(reported.iter().map(|host| (host.clone(), "reported")));
    for (host, source) in others {
        if !hosts.iter().any(|(known, _)| *known == host) {
            hosts.push((host, source));
        }
    }
    let mut routes: Vec<RouteView> = hosts
        .into_iter()
        .map(|(host, source)| {
            let enabled = source != "reported" || !disabled.contains(&host);
            route_view(&host, source, enabled)
        })
        .collect();
    if !prefer.is_saved() {
        routes.sort_by_key(|route| address_kind(&route.address) != Some(prefer));
    }
    routes
}

/// Quick Tunnel addresses learned from the account, after the dialed ones. The
/// tunnel the latest answer came over is the one in use.
fn tunnel_views(environment_id: &str) -> (Vec<RouteView>, Option<String>) {
    let in_use = account_in_use(environment_id).and_then(|endpoint| account_tunnel(&endpoint));
    let views = account_endpoints(environment_id)
        .into_iter()
        .filter_map(|endpoint| {
            let host = url::Url::parse(&endpoint).ok()?.host_str()?.to_string();
            Some(RouteView {
                address: host,
                kind: "tunnel",
                source: "account",
                enabled: true,
            })
        })
        .collect();
    let active = in_use
        .and_then(|origin| url::Url::parse(&origin).ok())
        .and_then(|url| url.host_str().map(str::to_string));
    (views, active)
}

fn machine_routes(
    machine_id: &str,
    target: Option<&SshTarget>,
    environment_id: Option<&str>,
    state: &RemoteConnections,
) -> MachineRoutes {
    let (mut routes, prefer, mut active) = match target {
        Some(target) => {
            let (disabled, prefer) = with_store(|store| {
                store
                    .machines
                    .get(&key(target))
                    .map(|entry| (entry.disabled.clone(), entry.prefer))
                    .unwrap_or_default()
            });
            let reported: Vec<String> = learned(target)
                .iter()
                .map(|route| host_of(&route.target))
                .collect();
            let other = target.alternate.as_deref().map(host_of);
            (
                route_list(
                    &host_of(&target.target),
                    other.as_deref(),
                    &reported,
                    &disabled,
                    prefer,
                ),
                prefer,
                state
                    .tunnels
                    .dialed(machine_id)
                    .map(|dial| host_of(&dial.target)),
            )
        }
        None => (Vec::new(), Prefer::default(), None),
    };
    if let Some(environment_id) = environment_id {
        let (tunnels, in_use) = tunnel_views(environment_id);
        routes.extend(tunnels);
        if in_use.is_some() {
            active = in_use;
        }
    }
    MachineRoutes {
        routes,
        prefer,
        active,
    }
}

/// What Connections settings shows for a machine: every address it can be
/// reached at, the owner's choices and the one in use. `target` only selects
/// what to read.
#[tauri::command]
pub async fn remote_machine_routes(
    app: tauri::AppHandle,
    machine_id: String,
    target: Option<SshTarget>,
    environment_id: Option<String>,
) -> Result<MachineRoutes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RemoteConnections>();
        machine_routes(
            &machine_id,
            target.as_ref(),
            environment_id.as_deref(),
            &state,
        )
    })
    .await
    .map_err(|error| error.to_string())
}

/// Whether each address's SSH port answers now, checked at once (about three
/// seconds at most). `None` when the address cannot be resolved to check.
#[tauri::command]
pub async fn remote_machine_route_check(target: SshTarget) -> Result<Vec<RouteCheck>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let saved = SshTarget {
            alternate: None,
            ..target.clone()
        };
        let mut dials = vec![saved.clone()];
        if let Some(other) = target
            .alternate
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            dials.push(SshTarget {
                target: other.trim().to_string(),
                ..saved.clone()
            });
        }
        for route in learned(&target) {
            dials.push(SshTarget {
                target: route.target,
                port: route.port.or(saved.port),
                ..saved.clone()
            });
        }
        let probes: Vec<_> = dials
            .into_iter()
            .map(|dial| {
                std::thread::spawn(move || RouteCheck {
                    address: host_of(&dial.target),
                    reachable: crate::remote_ssh::ssh_server_reachable(&dial),
                })
            })
            .collect();
        probes
            .into_iter()
            .filter_map(|probe| probe.join().ok())
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteCheck {
    address: String,
    reachable: Option<bool>,
}

/// Saves which reported addresses are turned off and which kind is tried
/// first. The saved and other address cannot be turned off; edit the machine
/// to change them. A
/// connection on an address that is now off or no longer preferred moves to
/// a better one within a minute (`watch_better_routes`); new dials use it at once.
#[tauri::command]
pub async fn remote_machine_route_settings(
    app: tauri::AppHandle,
    machine_id: String,
    target: SshTarget,
    disabled: Vec<String>,
    prefer: Prefer,
) -> Result<MachineRoutes, String> {
    let saved = host_of(&target.target);
    let other = target.alternate.as_deref().map(host_of);
    let mut hosts: Vec<String> = Vec::new();
    for host in disabled.iter().map(|value| host_of(value)) {
        if host.is_empty()
            || host == saved
            || other.as_deref() == Some(host.as_str())
            || hosts.contains(&host)
        {
            continue;
        }
        hosts.push(host);
    }
    if hosts.len() > MAX_ROUTES + 1 {
        return Err("Too many addresses".into());
    }
    with_store(|store| {
        let entry = store.machines.entry(key(&target)).or_default();
        entry.disabled = hosts;
        entry.prefer = prefer;
        persist(store);
    });
    remote_machine_routes(app, machine_id, Some(target), None).await
}

/// The port a `connection-info` result reports (the script's last line).
pub(crate) fn reported_port(output: &str) -> Option<u16> {
    let info: Value = serde_json::from_str(output.lines().last()?.trim()).ok()?;
    u16::try_from(info.get("port")?.as_u64()?)
        .ok()
        .filter(|port| *port > 0)
}

/// Connection failures that a host listening on another port also produces.
/// Rejected credentials and changed identities are answered, not unreachable.
pub(crate) fn port_may_have_moved(error: &str) -> bool {
    error.starts_with("Machine is unreachable")
        || error.starts_with("The host request did not complete")
}

#[cfg(test)]
pub(crate) fn teach(target: &SshTarget, routes: Vec<LearnedRoute>) {
    with_store(|store| store.machines.entry(key(target)).or_default().routes = routes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn proof_at(cache: &mut ProofCache, token: &str, now: Instant, wall: std::time::SystemTime) {
        cache.remember(
            "https://a.trycloudflare.com",
            "env-a",
            credential_digest(token),
            now,
            wall,
        );
    }

    fn is_fresh(
        cache: &mut ProofCache,
        origin: &str,
        environment_id: &str,
        token: &str,
        now: Instant,
        wall: std::time::SystemTime,
    ) -> bool {
        cache.is_fresh(origin, environment_id, &credential_digest(token), now, wall)
    }

    #[test]
    fn a_proof_is_reused_only_for_the_exact_route_machine_and_credential() {
        let (now, wall) = (Instant::now(), std::time::SystemTime::now());
        let mut cache = ProofCache::default();
        proof_at(&mut cache, "token-1", now, wall);
        let origin = "https://a.trycloudflare.com";
        assert!(is_fresh(&mut cache, origin, "env-a", "token-1", now, wall));
        // A rotated credential, another machine or another route is a different proof.
        assert!(!is_fresh(&mut cache, origin, "env-a", "token-2", now, wall));
        assert!(!is_fresh(&mut cache, origin, "env-b", "token-1", now, wall));
        assert!(!is_fresh(
            &mut cache,
            "https://b.trycloudflare.com",
            "env-a",
            "token-1",
            now,
            wall
        ));
    }

    #[test]
    fn a_proof_expires_and_a_clock_set_backwards_ends_it() {
        let (now, wall) = (Instant::now(), std::time::SystemTime::now());
        let origin = "https://a.trycloudflare.com";
        let almost = PROOF_FRESH_FOR - Duration::from_secs(1);
        let mut cache = ProofCache::default();
        proof_at(&mut cache, "token-1", now, wall);
        assert!(is_fresh(
            &mut cache,
            origin,
            "env-a",
            "token-1",
            now + almost,
            wall + almost
        ));
        let mut cache = ProofCache::default();
        proof_at(&mut cache, "token-1", now, wall);
        assert!(!is_fresh(
            &mut cache,
            origin,
            "env-a",
            "token-1",
            now + PROOF_FRESH_FOR,
            wall + PROOF_FRESH_FOR
        ));
        // The monotonic clock was suspended but the wall clock moved on.
        let mut cache = ProofCache::default();
        proof_at(&mut cache, "token-1", now, wall);
        assert!(!is_fresh(
            &mut cache,
            origin,
            "env-a",
            "token-1",
            now + almost,
            wall + PROOF_FRESH_FOR
        ));
        // The wall clock went back.
        let mut cache = ProofCache::default();
        proof_at(&mut cache, "token-1", now, wall + Duration::from_secs(5));
        assert!(!is_fresh(&mut cache, origin, "env-a", "token-1", now, wall));
    }

    #[test]
    fn forgetting_a_route_ends_its_proof_for_every_credential_and_the_cache_is_bounded() {
        let (now, wall) = (Instant::now(), std::time::SystemTime::now());
        let origin = "https://a.trycloudflare.com";
        let mut cache = ProofCache::default();
        proof_at(&mut cache, "token-1", now, wall);
        proof_at(&mut cache, "token-2", now, wall);
        cache.remember(
            "https://b.trycloudflare.com",
            "env-a",
            credential_digest("token-1"),
            now,
            wall,
        );
        cache.forget("env-a", origin);
        assert!(!is_fresh(&mut cache, origin, "env-a", "token-1", now, wall));
        assert!(!is_fresh(&mut cache, origin, "env-a", "token-2", now, wall));
        assert!(is_fresh(
            &mut cache,
            "https://b.trycloudflare.com",
            "env-a",
            "token-1",
            now,
            wall
        ));
        for index in 0..MAX_PROOFS + 4 {
            proof_at(&mut cache, &format!("bulk-{index}"), now, wall);
        }
        assert_eq!(cache.0.len(), MAX_PROOFS);
        assert!(!is_fresh(&mut cache, origin, "env-a", "bulk-0", now, wall));
    }

    /// Offline: a fresh proof answers without a request, a spent budget fails closed
    /// before any request, and retiring the route ends reuse.
    #[test]
    fn verification_reuses_a_fresh_proof_without_a_request_and_fails_closed_otherwise() {
        let endpoint = "https://reuse-fixture.trycloudflare.com";
        let (environment_id, token) = ("reuse-fixture-env", "reuse-fixture-token");
        assert!(verify_account_endpoint(endpoint, environment_id, token, Duration::ZERO).is_err());
        with_proofs(|cache| {
            cache.remember(
                endpoint,
                environment_id,
                credential_digest(token),
                Instant::now(),
                std::time::SystemTime::now(),
            )
        })
        .unwrap();
        assert!(verify_account_endpoint(endpoint, environment_id, token, Duration::ZERO).is_ok());
        assert!(
            verify_account_endpoint(endpoint, environment_id, "other-token", Duration::ZERO)
                .is_err()
        );
        assert!(verify_account_endpoint(endpoint, "other-env", token, Duration::ZERO).is_err());
        retire_account_endpoint(environment_id, endpoint);
        assert!(verify_account_endpoint(endpoint, environment_id, token, Duration::ZERO).is_err());
    }

    #[test]
    fn account_tunnel_hints_are_bounded_to_credential_free_quick_tunnel_origins() {
        assert_eq!(
            account_tunnel("https://new-host.trycloudflare.com/").as_deref(),
            Some("https://new-host.trycloudflare.com")
        );
        for route in [
            "http://a.trycloudflare.com",
            "https://a.trycloudflare.com.evil.test",
            "https://user@a.trycloudflare.com",
            "https://a.trycloudflare.com/rpc",
            "https://a.trycloudflare.com?token=secret",
            "https://a.trycloudflare.com:444",
        ] {
            assert!(account_tunnel(route).is_none(), "{route}");
        }
    }

    #[test]
    fn a_new_account_tunnel_replaces_the_old_route_for_only_the_same_environment() {
        let environment = "account-route-test";
        assert!(learn_account_endpoint(
            environment,
            "https://old.trycloudflare.com".into()
        ));
        assert!(!learn_account_endpoint(
            environment,
            "https://old.trycloudflare.com".into()
        ));
        assert!(learn_account_endpoint(
            environment,
            "https://new.trycloudflare.com".into()
        ));
        assert_eq!(
            account_endpoints(environment),
            ["https://new.trycloudflare.com"]
        );
        assert!(account_endpoints("other-account-route-test").is_empty());
    }

    fn target(value: &str) -> SshTarget {
        SshTarget {
            target: value.into(),
            identity_file: None,
            port: Some(2222),
            remote_port: 3774,
            alternate: Some("me@192.168.2.145".into()),
            host_key_alias: None,
        }
    }

    #[test]
    fn only_home_network_and_tailscale_addresses_are_learned() {
        let descriptor = json!({ "addresses": [
            "192.168.2.145", "10.0.0.4", "100.97.82.0", "172.20.1.1", "8.8.8.8",
            "127.0.0.1", "169.254.1.1", "100.128.0.1", "fe80::1", "10.0.0.4", 7
        ]});
        assert_eq!(
            reported_addresses(&descriptor),
            ["192.168.2.145", "10.0.0.4", "100.97.82.0", "172.20.1.1"]
        );
    }

    #[test]
    fn learned_addresses_reuse_the_saved_user_and_skip_saved_addresses() {
        let saved = target("me@100.97.82.0");
        let reported = [
            "100.97.82.0".into(),
            "192.168.2.145".into(),
            "10.0.0.4".into(),
        ];
        let Probe::Fallback(routes) = routes_from(&saved, &reported, None) else {
            panic!("a saved user@host reuses its user without ssh -G");
        };
        assert_eq!(
            routes
                .iter()
                .map(|route| route.target.as_str())
                .collect::<Vec<_>>(),
            ["me@10.0.0.4"]
        );
        assert_eq!(routes[0].port, Some(2222));
        let probed = Some(("me".into(), "100.97.82.0".into(), 22));
        let Probe::Resolved(routes) = routes_from(&saved, &reported, probed) else {
            panic!("an ssh -G answer resolves the routes");
        };
        assert_eq!(routes[0].port, Some(22));
    }

    fn learned_route(address: &str) -> LearnedRoute {
        LearnedRoute {
            target: format!("me@{address}"),
            port: Some(22),
        }
    }

    fn confirmed_entry(reported: &[&str], confirmed: &Confirmed) -> Entry {
        Entry {
            reported: reported.iter().map(|address| address.to_string()).collect(),
            resolved: true,
            routes: reported.iter().map(|address| learned_route(address)).collect(),
            confirmed: Some(confirmed.clone()),
            ..Entry::default()
        }
    }

    #[test]
    fn a_failed_probe_keeps_confirmed_routes_and_retries_later() {
        let saved = target("me@100.97.82.0");
        let confirmed = confirmed_for(&saved, "env");
        let reported: Vec<String> = vec!["10.0.0.4".into(), "192.168.2.9".into()];
        for failed in [
            Probe::Unknown,
            routes_from(&saved, &reported, None),
            routes_from(&target("alias"), &reported, None),
        ] {
            let mut entry = confirmed_entry(&["10.0.0.4", "192.168.2.9"], &confirmed);
            apply_probe(&mut entry, &confirmed, &reported, failed);
            assert_eq!(
                entry.routes,
                [learned_route("10.0.0.4"), learned_route("192.168.2.9")]
            );
            assert!(!entry.resolved, "an unresolved report is retried");
            assert_eq!(entry.confirmed.as_ref(), Some(&confirmed));
        }
    }

    #[test]
    fn a_failed_probe_drops_confirmed_routes_the_host_no_longer_reports() {
        let saved = target("me@100.97.82.0");
        let confirmed = confirmed_for(&saved, "env");
        let mut entry = confirmed_entry(&["10.0.0.4", "192.168.2.9"], &confirmed);
        let reported = ["10.0.0.4".to_string()];
        apply_probe(&mut entry, &confirmed, &reported, Probe::Unknown);
        assert_eq!(entry.routes, [learned_route("10.0.0.4")]);
    }

    #[test]
    fn a_failed_probe_never_applies_routes_confirmed_for_another_identity_or_address() {
        let saved = target("me@100.97.82.0");
        let reported: Vec<String> = vec!["10.0.0.4".into()];
        let mut other_alternate = saved.clone();
        other_alternate.alternate = Some("me@192.168.9.9".into());
        for changed in [
            confirmed_for(&saved, "other-env"),
            confirmed_for(&other_alternate, "env"),
        ] {
            let old = confirmed_for(&saved, "env");
            let mut entry = confirmed_entry(&["10.0.0.4"], &old);
            apply_probe(&mut entry, &changed, &reported, Probe::Unknown);
            assert!(entry.routes.is_empty());
            assert_eq!(entry.confirmed, None);
            assert!(!entry.resolved);
        }
        // With a usable saved user@host the new report's own routes replace them.
        let old = confirmed_for(&saved, "env");
        let new = confirmed_for(&saved, "other-env");
        let mut entry = confirmed_entry(&["10.0.0.4"], &old);
        let fallback = routes_from(&saved, &reported, None);
        apply_probe(&mut entry, &new, &reported, fallback);
        assert_eq!(entry.routes[0].port, saved.port);
        assert_eq!(entry.confirmed, None);
        assert!(!entry.resolved);
    }

    #[test]
    fn a_resolved_probe_replaces_routes_and_settles_the_report() {
        let saved = target("me@100.97.82.0");
        let confirmed = confirmed_for(&saved, "env");
        let mut entry = Entry {
            routes: vec![learned_route("10.0.0.9")],
            ..Entry::default()
        };
        let reported: Vec<String> = vec!["10.0.0.4".into()];
        apply_probe(
            &mut entry,
            &confirmed,
            &reported,
            Probe::Resolved(vec![learned_route("10.0.0.4")]),
        );
        assert_eq!(entry.routes, [learned_route("10.0.0.4")]);
        assert!(entry.resolved);
        assert_eq!(entry.confirmed, Some(confirmed.clone()));
        // A real, empty answer (every address is saved) is settled too.
        apply_probe(&mut entry, &confirmed, &reported, Probe::Resolved(Vec::new()));
        assert!(entry.routes.is_empty() && entry.resolved);
    }

    #[test]
    fn an_unresolved_report_is_retried_only_after_the_delay() {
        let key = "probe-retry-test#0";
        assert!(probe_retry_due(key));
        assert!(!probe_retry_due(key));
    }

    #[test]
    fn a_report_from_another_environment_or_an_older_host_teaches_nothing() {
        let saved = target("me@learn-test.invalid");
        teach(
            &saved,
            vec![LearnedRoute {
                target: "me@10.0.0.9".into(),
                port: None,
            }],
        );
        observe(
            &saved,
            "env",
            &json!({ "environmentId": "other", "addresses": ["10.0.0.4"] }),
        );
        observe(&saved, "env", &json!({ "environmentId": "env" }));
        assert_eq!(learned(&saved)[0].target, "me@10.0.0.9");
    }

    #[test]
    fn a_failing_preferred_address_is_checked_less_often_up_to_half_an_hour() {
        assert_eq!(backoff(1), Duration::from_secs(120));
        assert_eq!(backoff(4), Duration::from_secs(960));
        assert_eq!(backoff(5), BETTER_ROUTE_BACKOFF_MAX);
        assert_eq!(backoff(40), BETTER_ROUTE_BACKOFF_MAX);
        let key = "backoff-test\u{0}me@10.0.0.4".to_string();
        assert!(!is_held_back(&key));
        hold_back(key.clone(), 1);
        assert!(is_held_back(&key));
    }

    #[test]
    fn better_route_checks_run_a_few_at_a_time_and_once_per_machine() {
        let checking: Checking = Arc::new(Mutex::new(HashSet::new()));
        let first = start_check(&checking, "machine-0");
        assert!(first.is_some());
        assert!(start_check(&checking, "machine-0").is_none());
        let rest: Vec<_> = (1..BETTER_ROUTE_WORKERS)
            .map(|i| start_check(&checking, &format!("machine-{i}")))
            .collect();
        assert!(rest.iter().all(Option::is_some));
        assert!(start_check(&checking, "machine-extra").is_none());
        drop(first);
        drop(rest);
        assert!(start_check(&checking, "machine-extra").is_some());
    }

    #[test]
    fn held_back_addresses_of_removed_machines_are_forgotten() {
        let kept = held_back_key("kept", &target("me@10.0.0.4"));
        let mut held = HashMap::new();
        held.insert(kept.clone(), (1, Instant::now()));
        held.insert(
            held_back_key("gone", &target("me@10.0.0.5")),
            (1, Instant::now()),
        );
        prune_held_back_in(&mut held, |id| id == "kept");
        assert_eq!(held.len(), 1);
        assert!(held.contains_key(&kept));
    }

    #[test]
    fn routes_are_shown_as_tailscale_home_network_or_name() {
        let tailnet = route_view("me@100.97.82.0", "saved", true);
        assert_eq!(
            (tailnet.address.as_str(), tailnet.kind),
            ("100.97.82.0", "tailscale")
        );
        let lan = route_view("me@192.168.2.145", "other", true);
        assert_eq!((lan.address.as_str(), lan.kind), ("192.168.2.145", "lan"));
        assert_eq!(route_view("macbook", "saved", true).kind, "name");
    }

    fn dial(value: &str) -> SshTarget {
        SshTarget {
            alternate: None,
            ..target(value)
        }
    }

    fn hosts(order: &[SshTarget]) -> Vec<String> {
        order.iter().map(|dial| host_of(&dial.target)).collect()
    }

    #[test]
    fn turned_off_addresses_are_skipped_but_the_saved_one_never_is() {
        let saved = target("me@arrange-off.invalid");
        with_store(|store| {
            let entry = store.machines.entry(key(&saved)).or_default();
            // A stale entry for the saved or other address never drops them.
            entry.disabled = vec![
                "arrange-off.invalid".into(),
                "192.168.2.145".into(),
                "192.168.95.2".into(),
            ];
        });
        let order = arrange(
            &saved,
            vec![
                dial("me@arrange-off.invalid"),
                dial("me@192.168.2.145"),
                dial("me@192.168.95.2"),
            ],
        );
        assert_eq!(hosts(&order), ["arrange-off.invalid", "192.168.2.145"]);
    }

    #[test]
    fn the_preferred_kind_goes_first_and_keeps_its_order() {
        let saved = target("me@100.97.82.0");
        with_store(|store| {
            store.machines.entry(key(&saved)).or_default().prefer = Prefer::Lan;
        });
        let candidates = || {
            vec![
                dial("me@100.97.82.0"),
                dial("me@macbook"),
                dial("me@192.168.2.145"),
                dial("me@10.0.0.4"),
            ]
        };
        assert_eq!(
            hosts(&arrange(&saved, candidates())),
            ["192.168.2.145", "10.0.0.4", "100.97.82.0", "macbook"]
        );
        with_store(|store| {
            store.machines.entry(key(&saved)).or_default().prefer = Prefer::Saved;
        });
        assert_eq!(
            hosts(&arrange(&saved, candidates())),
            ["100.97.82.0", "macbook", "192.168.2.145", "10.0.0.4"]
        );
    }

    #[test]
    fn account_tunnels_are_listed_as_tunnel_routes_and_the_answering_one_is_in_use() {
        let environment = "tunnel-view-env";
        learn_account_endpoint(environment, "https://abc-123.trycloudflare.com".into());
        let (views, active) = tunnel_views(environment);
        assert_eq!(active, None);
        assert_eq!(views.len(), 1);
        assert_eq!(
            (views[0].address.as_str(), views[0].kind, views[0].source),
            ("abc-123.trycloudflare.com", "tunnel", "account")
        );
        note_account_route(environment, Some("https://abc-123.trycloudflare.com"));
        assert_eq!(
            tunnel_views(environment).1.as_deref(),
            Some("abc-123.trycloudflare.com")
        );
        note_account_route(environment, None);
        assert_eq!(tunnel_views(environment).1, None);
    }

    #[test]
    fn the_address_list_keeps_its_order_when_an_address_is_turned_off() {
        let reported = ["192.168.95.2".to_string(), "10.0.0.4".to_string()];
        let order = |disabled: &[String], prefer| {
            route_list(
                "100.110.53.9",
                Some("192.168.2.108"),
                &reported,
                disabled,
                prefer,
            )
            .iter()
            .map(|route| (route.address.clone(), route.enabled))
            .collect::<Vec<_>>()
        };
        let on = order(&[], Prefer::Saved);
        let off = order(&["192.168.95.2".to_string()], Prefer::Saved);
        let addresses = |list: &[(String, bool)]| {
            list.iter()
                .map(|(address, _)| address.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(addresses(&on), addresses(&off));
        assert_eq!(
            addresses(&on),
            ["100.110.53.9", "192.168.2.108", "192.168.95.2", "10.0.0.4"]
        );
        assert!(off[0].1 && off[1].1 && !off[2].1 && off[3].1);
        // The other address is the owner's own entry: never turned off here.
        assert!(order(&["192.168.2.108".to_string()], Prefer::Saved)[1].1);
        // The saved address is always on, even if a stale entry names it.
        assert!(order(&["100.110.53.9".to_string()], Prefer::Saved)[0].1);
        assert_eq!(
            addresses(&order(&[], Prefer::Lan))[..3],
            ["192.168.2.108", "192.168.95.2", "10.0.0.4"]
        );
    }

    #[test]
    fn owner_choices_survive_a_new_report() {
        let saved = target("me@arrange-keep.invalid");
        with_store(|store| {
            let entry = store.machines.entry(key(&saved)).or_default();
            entry.disabled = vec!["10.0.0.9".into()];
            entry.prefer = Prefer::Tailscale;
        });
        observe(
            &saved,
            "env",
            &json!({ "environmentId": "env", "addresses": ["10.0.0.4"] }),
        );
        with_store(|store| {
            let entry = &store.machines[&key(&saved)];
            assert_eq!(entry.disabled, ["10.0.0.9"]);
            assert_eq!(entry.prefer, Prefer::Tailscale);
        });
    }

    #[test]
    fn an_older_snapshot_never_replaces_a_newer_file() {
        let directory =
            std::env::temp_dir().join(format!("remote-routes-{}", uuid::Uuid::new_v4().simple()));
        let path = directory.join(FILE);
        write_snapshot(Snapshot {
            path: path.clone(),
            bytes: b"newer".to_vec(),
            generation: 2,
        });
        write_snapshot(Snapshot {
            path: path.clone(),
            bytes: b"older".to_vec(),
            generation: 1,
        });
        assert_eq!(std::fs::read(&path).unwrap(), b"newer");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn reported_port_reads_the_last_line() {
        assert_eq!(reported_port("noise\n{\"port\":3776}\n"), Some(3776));
        assert_eq!(reported_port("{\"port\":0}"), None);
        assert!(port_may_have_moved("Machine is unreachable. Check"));
        assert!(!port_may_have_moved("Host identity changed"));
    }
}
