//! Opt-in metadata/replay over the canonical PTY owner; never a second process backend.
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const OUTPUT_LIMIT: usize = 1024 * 1024;
const LEASE: Duration = Duration::from_secs(30);
// Retain exited replay for ten minutes; pending/unknown lifetimes never age out.
const SETTLED_TTL: Duration = Duration::from_secs(600);
const FENCE_BYTES: usize = 1024 * 1024;
#[derive(Clone, PartialEq, Eq)]
struct Scope {
    environment: String,
    source: String,
    cwd: String,
    actor: String,
    owner: String,
}
struct Replay {
    bytes: VecDeque<u8>,
    end: u64,
}
impl Replay {
    fn new() -> Self {
        Self {
            bytes: VecDeque::new(),
            end: 0,
        }
    }
    fn push(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        if bytes.len() >= OUTPUT_LIMIT {
            self.bytes.clear();
            self.bytes.extend(&bytes[bytes.len() - OUTPUT_LIMIT..]);
        } else {
            let remove = (self.bytes.len() + bytes.len()).saturating_sub(OUTPUT_LIMIT);
            self.bytes.drain(..remove);
            self.bytes.extend(bytes);
        }
    }
    fn oldest(&self) -> u64 {
        self.end - self.bytes.len() as u64
    }
    fn read(&self, after: u64, limit: usize) -> Result<(Vec<u8>, u64, bool), String> {
        if after > self.end {
            return Err("Invalid PTY cursor".into());
        }
        if after < self.oldest() {
            return Ok((Vec::new(), after, true));
        }
        let bytes: Vec<u8> = self
            .bytes
            .iter()
            .skip((after - self.oldest()) as usize)
            .take(limit)
            .copied()
            .collect();
        let next = after + bytes.len() as u64;
        Ok((bytes, next, false))
    }
}
struct Entry {
    scope: Scope,
    id: String,
    epoch: String,
    lease: String,
    seen: Instant,
    replay: Replay,
    cols: u16,
    rows: u16,
    shell: String,
    exited: bool,
    physical_exit: bool,
    native_generation: Option<String>,
    closed: bool,
    settled_at: Option<Instant>,
    code: Option<i32>,
    detached: bool,
    drained: bool,
    sequence: u64,
    input_unknown: bool,
    input_fingerprint: String,
    gap: bool,
}
impl Entry {
    fn reserve_generation(&mut self, generation: String) -> Result<(), String> {
        if self.native_generation.is_some() {
            return Err("Mobile PTY spawn is already reserved; never replay".into());
        }
        self.native_generation = Some(generation);
        Ok(())
    }
    fn matches_generation(&self, generation: &str) -> bool {
        self.native_generation.as_deref() == Some(generation)
    }
    fn leased(&self, lease: &str) -> bool {
        !self.gap
            && !self.detached
            && !self.exited
            && self.lease == lease
            && self.seen.elapsed() < LEASE
    }
    fn dto(&self) -> Value {
        json!({"terminalId":self.id,"epoch":self.epoch,"sourceSessionId":self.scope.source,"name":"Mobile terminal","shell":self.shell,"state":if self.physical_exit && self.drained {"exited"}else{"running"},"cols":self.cols,"rows":self.rows,"exitCode":self.code,"control":if self.leased(&self.lease){"mobile"}else{"none"},"replayStart":self.replay.oldest(),"replayEnd":self.replay.end})
    }
    fn lease_dto(&self) -> Value {
        json!({"terminal":self.dto(),"leaseId":self.lease,"expiresAt":now()+LEASE.saturating_sub(self.seen.elapsed()).as_millis() as u64})
    }
    fn reserve_input(&mut self, sequence: u64, fingerprint: &str) -> Result<bool, String> {
        if sequence == self.sequence && fingerprint == self.input_fingerprint {
            if self.input_unknown {
                return Err("PTY input outcome is unknown; never resend".into());
            }
            return Ok(false);
        }
        if self.input_unknown || sequence != self.sequence + 1 {
            return Err("PTY input order changed; inspect status without replay".into());
        }
        self.sequence = sequence;
        self.input_fingerprint = fingerprint.into();
        self.input_unknown = true;
        Ok(true)
    }
}
#[derive(Default)]
pub(crate) struct MobilePtyHost {
    inner: Mutex<Registry>,
}
#[derive(Default)]
struct Registry {
    entries: HashMap<String, Entry>,
    requests: HashMap<String, Receipt>,
    settled_attaches: HashMap<String, Instant>,
    expired: ExpiredFence,
}
struct Receipt {
    fingerprint: String,
    result: Value,
    terminal_id: String,
    pending: bool,
    close: bool,
}

struct ExpiredFence {
    bits: Vec<u8>,
    set_bits: usize,
}
impl Default for ExpiredFence {
    fn default() -> Self {
        Self {
            bits: vec![0; FENCE_BYTES],
            set_bits: 0,
        }
    }
}
impl ExpiredFence {
    fn indexes(key: &str) -> [usize; 4] {
        let digest = Sha256::digest(key.as_bytes());
        std::array::from_fn(|i| {
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&digest[i * 8..i * 8 + 8]);
            (u64::from_le_bytes(bytes) % (FENCE_BYTES as u64 * 8)) as usize
        })
    }
    fn contains(&self, key: &str) -> bool {
        Self::indexes(key)
            .into_iter()
            .all(|i| self.bits[i / 8] & (1 << (i % 8)) != 0)
    }
    fn insert(&mut self, key: &str) {
        for i in Self::indexes(key) {
            let bit = 1 << (i % 8);
            if self.bits[i / 8] & bit == 0 {
                self.bits[i / 8] |= bit;
                self.set_bits += 1;
            }
        }
    }
    fn saturated(&self) -> bool {
        self.set_bits >= FENCE_BYTES * 8 / 4
    }
}
impl Registry {
    fn receipt_outcome(&self, key: &str, signature: &str) -> Result<Value, String> {
        let receipt = self
            .requests
            .get(key)
            .ok_or("PTY request receipt is unavailable")?;
        if receipt.fingerprint != signature {
            return Err("PTY request identity changed".into());
        }
        if receipt.close && receipt.pending {
            return Err("PTY close is unconfirmed; retry after the process exits".into());
        }
        Ok(receipt.result.clone())
    }
    fn retry_closed(&mut self, key: &str, id: &str) -> Result<Value, String> {
        let exited = self
            .entries
            .get(id)
            .is_some_and(|entry| entry.physical_exit);
        // Even an unconfirmed retry ID must never authorize a different effect.
        self.expired.insert(key);
        if !exited {
            return Err("PTY close is unconfirmed; retry after the process exits".into());
        }
        Ok(json!({"closed":true}))
    }
    fn record_physical_exit(
        &mut self,
        id: &str,
        generation: &str,
        code: Option<i32>,
        now: Instant,
    ) {
        if let Some(entry) = self.entries.get_mut(id) {
            if entry.matches_generation(generation) {
                entry.record_exit(code, now);
                self.reconcile_close(id);
            }
        }
    }
    fn reconcile_close(&mut self, id: &str) {
        for receipt in self.requests.values_mut() {
            if receipt.close && receipt.pending && receipt.terminal_id == id {
                receipt.result = json!({"closed": true});
                receipt.pending = false;
            }
        }
    }
    fn prune(&mut self, now: Instant) {
        let expired_attaches: Vec<String> = self
            .settled_attaches
            .iter()
            .filter_map(|(key, at)| {
                (now.saturating_duration_since(*at) >= SETTLED_TTL).then_some(key.clone())
            })
            .collect();
        for key in expired_attaches {
            // Fence before discarding the receipt: an old retry must not rotate a lease.
            self.expired.insert(&key);
            self.requests.remove(&key);
            self.settled_attaches.remove(&key);
        }
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter_map(|(id, entry)| {
                if entry.input_unknown || entry.gap {
                    return None;
                }
                if self
                    .requests
                    .values()
                    .any(|receipt| receipt.terminal_id == *id && receipt.pending)
                {
                    return None;
                }
                entry
                    .settled_at
                    .filter(|at| now.saturating_duration_since(*at) >= SETTLED_TTL)
                    .map(|_| id.clone())
            })
            .collect();
        for id in expired {
            let keys: Vec<String> = self
                .requests
                .iter()
                .filter_map(|(key, receipt)| (receipt.terminal_id == id).then_some(key.clone()))
                .collect();
            for key in keys {
                self.expired.insert(&key);
                self.requests.remove(&key);
                self.settled_attaches.remove(&key);
            }
            self.entries.remove(&id);
        }
    }
    fn admit(&self, key: &str, close: bool) -> Result<(), String> {
        if self.expired.contains(key) {
            return Err("PTY request receipt expired; never replay".into());
        }
        if !close && self.expired.saturated() {
            return Err("Mobile PTY receipt fence is full".into());
        }
        Ok(())
    }
    fn capacity(&self) -> (usize, usize) {
        let mut active = 0;
        let mut history = 0;
        for (id, entry) in &self.entries {
            if entry.settled_at.is_some()
                && !entry.input_unknown
                && !entry.gap
                && !self
                    .requests
                    .values()
                    .any(|receipt| receipt.terminal_id == *id && receipt.pending)
            {
                history += 1;
            } else {
                active += 1;
            }
        }
        (active, history)
    }
}
impl Entry {
    fn record_exit(&mut self, code: Option<i32>, now: Instant) {
        self.exited = true;
        self.physical_exit = true;
        self.detached = true;
        self.code = code;
        self.mark_settled(now);
    }
    fn record_drain(&mut self, complete: bool, now: Instant) {
        self.drained = complete;
        if !complete {
            self.gap = true;
        }
        self.mark_settled(now);
    }
    fn mark_settled(&mut self, now: Instant) {
        if self.physical_exit
            && self.drained
            && !self.input_unknown
            && !self.gap
            && self.settled_at.is_none()
        {
            self.settled_at = Some(now);
        }
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn string(input: &Value, key: &str) -> Result<String, String> {
    let value = input[key].as_str().ok_or("Missing PTY identity")?;
    if value.is_empty() || value.len() > 256 || value.chars().any(|c| c.is_control()) {
        return Err("Invalid PTY identity".into());
    }
    Ok(value.into())
}
fn dimensions(input: &Value) -> Result<(u16, u16), String> {
    let cols = input["cols"].as_u64().ok_or("PTY columns required")?;
    let rows = input["rows"].as_u64().ok_or("PTY rows required")?;
    if !(2..=400).contains(&cols) || !(2..=200).contains(&rows) {
        return Err("Invalid PTY dimensions".into());
    }
    Ok((cols as u16, rows as u16))
}
fn entry<'a>(
    registry: &'a mut Registry,
    scope: &Scope,
    input: &Value,
) -> Result<&'a mut Entry, String> {
    let id = string(input, "terminalId")?;
    let epoch = string(input, "epoch")?;
    let value = registry
        .entries
        .get_mut(&id)
        .ok_or("Mobile PTY is unavailable")?;
    if &value.scope != scope || value.epoch != epoch {
        return Err("Mobile PTY belongs to another source or actor".into());
    }
    Ok(value)
}
pub(crate) fn output(app: &AppHandle, id: &str, owner: &str, bytes: &[u8]) {
    if let Some(host) = app.try_state::<MobilePtyHost>() {
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = registry.entries.get_mut(id) {
            if entry.scope.owner == owner {
                entry.replay.push(bytes);
            }
        }
    }
}
pub(crate) fn reserve_native_spawn(app: &AppHandle, id: &str) -> Result<(), String> {
    if let Some(host) = app.try_state::<MobilePtyHost>() {
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = registry.entries.get_mut(id) {
            entry.reserve_generation(uuid::Uuid::new_v4().to_string())?;
        }
    }
    Ok(())
}
pub(crate) fn native_generation(app: &AppHandle, id: &str) -> Option<String> {
    app.try_state::<MobilePtyHost>().and_then(|host| {
        host.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .get(id)
            .and_then(|entry| entry.native_generation.clone())
    })
}
pub(crate) fn exited(app: &AppHandle, id: &str, generation: &str, code: Option<i32>) {
    if let Some(host) = app.try_state::<MobilePtyHost>() {
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        registry.record_physical_exit(id, generation, code, Instant::now());
    }
}
pub(crate) fn registered(app: &AppHandle, id: &str) -> bool {
    app.try_state::<MobilePtyHost>().is_some_and(|host| {
        host.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .contains_key(id)
    })
}
pub(crate) fn desktop_control(app: &AppHandle, id: &str) -> Result<(), String> {
    if registered(app, id) {
        return Err(
            "This PTY is controlled by the mobile viewport; desktop adoption is unavailable".into(),
        );
    }
    Ok(())
}
pub(crate) fn drained(app: &AppHandle, id: &str, generation: &str, complete: bool) {
    if let Some(host) = app.try_state::<MobilePtyHost>() {
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = registry.entries.get_mut(id) {
            if entry.matches_generation(generation) {
                entry.record_drain(complete, Instant::now());
            }
        }
    }
}

#[tauri::command]
pub async fn mobile_pty_call(
    app: AppHandle,
    window: tauri::Window,
    action: String,
    input: Value,
) -> Result<Value, String> {
    crate::harness::run_blocking("mobile_pty_call", move || {
        let extra: &[&str] = match action.as_str() {
            "ptyMobile.list" => &[],
            "ptyMobile.create" => &["requestId", "profileId", "cols", "rows"],
            "ptyMobile.attach" => &["terminalId", "epoch", "requestId", "after", "freshRenderer"],
            "ptyMobile.close" => &["terminalId", "epoch", "requestId"],
            "ptyMobile.read" => &["terminalId", "epoch", "after", "limit"],
            "ptyMobile.write" => &[
                "terminalId",
                "epoch",
                "leaseId",
                "inputSequence",
                "dataBase64",
            ],
            "ptyMobile.resize" => &["terminalId", "epoch", "leaseId", "cols", "rows"],
            "ptyMobile.status" => &["terminalId", "epoch", "leaseId", "requestId"],
            "ptyMobile.detach" => &["terminalId", "epoch", "leaseId"],
            _ => return Err("Unsupported mobile PTY action".into()),
        };
        let fields = input.as_object().ok_or("Invalid mobile PTY input")?;
        if fields.keys().any(|key| {
            !["environmentId", "sessionId", "projectCwd", "actorId"].contains(&key.as_str())
                && !extra.contains(&key.as_str())
        }) {
            return Err("Unsupported mobile PTY field".into());
        }
        let scope = Scope {
            environment: string(&input, "environmentId")?,
            source: string(&input, "sessionId")?,
            cwd: input["projectCwd"]
                .as_str()
                .filter(|value| value.len() <= 4096 && !value.starts_with("remote://"))
                .ok_or("Local PTY project required")?
                .into(),
            actor: string(&input, "actorId")?,
            owner: window.label().into(),
        };
        crate::control::validate_history_source_owner(
            &app,
            &scope.owner,
            &scope.source,
            &scope.cwd,
            &scope.environment,
        )?;
        let host = app.state::<MobilePtyHost>();
        if action == "ptyMobile.status" && input.get("requestId").is_some() {
            if ["terminalId", "epoch", "leaseId"]
                .iter()
                .any(|key| input.get(key).is_some())
            {
                return Err("Mixed PTY status identity".into());
            }
            let request = string(&input, "requestId")?;
            let key = serde_json::to_string(&(
                &scope.environment,
                &scope.source,
                &scope.cwd,
                &scope.actor,
                &scope.owner,
                "create",
                request,
            ))
            .map_err(|_| "Invalid PTY receipt")?;
            let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
            registry.prune(Instant::now());
            let result = registry
                .requests
                .get(&key)
                .map(|receipt| receipt.result.clone())
                .unwrap_or_else(|| json!({"state":"unknown"}));
            if let Some(id) = result["terminal"]["terminalId"].as_str() {
                return Ok(registry.entries.get(id).filter(|value|value.scope==scope).map(Entry::lease_dto).unwrap_or_else(||json!({"state":"failed","message":"The created PTY was closed; no replacement was started"})));
            }
            return Ok(result);
        }
        if action == "ptyMobile.list" {
            let registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
            return Ok(
                json!({"terminals":registry.entries.values().filter(|entry|entry.scope==scope && !entry.closed).map(Entry::dto).collect::<Vec<_>>()}),
            );
        }
        if action == "ptyMobile.create" {
            let request = string(&input, "requestId")?;
            let (cols, rows) = dimensions(&input)?;
            let profile = input["profileId"].as_str().map(str::to_owned);
            let key = serde_json::to_string(&(
                &scope.environment,
                &scope.source,
                &scope.cwd,
                &scope.actor,
                &scope.owner,
                "create",
                request,
            ))
            .map_err(|_| "Invalid PTY receipt")?;
            let signature = serde_json::to_string(&input).map_err(|_| "Invalid PTY creation")?;
            let id = uuid::Uuid::new_v4().to_string();
            {
                let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
                registry.prune(Instant::now());
                if let Some(receipt) = registry.requests.get(&key) {
                    return if receipt.fingerprint == signature {
                        Ok(receipt.result.clone())
                    } else {
                        Err("PTY request identity changed".into())
                    };
                }
                registry.admit(&key, false)?;
                // Active capacity and replay grace are separate; a burst of 16
                // live terminals can settle above the 32-entry history watermark.
                let (active, history) = registry.capacity();
                if active >= 16 {
                    return Err("Mobile PTY limit reached".into());
                }
                if history >= 32 { return Err("Mobile PTY replay history is full; retry after the retention period".into()); }
                if registry.requests.len() >= 512 { return Err("Mobile PTY receipt limit reached".into()); }
                registry
                    .requests
                    .insert(key.clone(), Receipt { fingerprint: signature.clone(), result: json!({"state":"unknown"}), terminal_id: id.clone(), pending: true, close: false });
                registry.entries.insert(
                    id.clone(),
                    Entry {
                        scope: scope.clone(),
                        id: id.clone(),
                        epoch: uuid::Uuid::new_v4().to_string(),
                        lease: uuid::Uuid::new_v4().to_string(),
                        seen: Instant::now(),
                        replay: Replay::new(),
                        cols,
                        rows,
                        shell: profile.clone().unwrap_or_else(|| "default".into()),
                        exited: false,
                        physical_exit: false,
                        native_generation: None,
                        closed: false,
                        settled_at: None,
                        code: None,
                        detached: false,
                        drained: false,
                        sequence: 0,
                        input_unknown: false,
                        input_fingerprint: String::new(),
                        gap: false,
                    },
                );
            }
            // The exact same native owner/spawn path as desktop; no shell command is accepted.
            let result = crate::pty::pty_spawn(
                app.clone(),
                window.clone(),
                app.state::<crate::pty::PtyHost>(),
                id.clone(),
                scope.cwd.clone(),
                cols,
                rows,
                profile,
            );
            if crate::control::validate_history_source_owner(
                &app,
                &scope.owner,
                &scope.source,
                &scope.cwd,
                &scope.environment,
            )
            .is_err()
            {
                let _ = crate::pty::pty_kill(
                    window.clone(),
                    app.state::<crate::pty::PtyHost>(),
                    id.clone(),
                );
                let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(value) = registry.entries.get_mut(&id) { value.detached = true; value.exited = true; value.closed = true; }
                return Err("Mobile PTY source closed during creation; no replay".into());
            }
            let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
            let value = registry
                .entries
                .get_mut(&id)
                .ok_or("Mobile PTY creation interrupted")?;
            let pending = result.is_err();
            let reply = match result {
                Ok(()) => value.lease_dto(),
                Err(_) => {
                    value.exited = true;
                    value.detached = true;
                    json!({"state":"unknown","message":"Mobile PTY creation outcome is unknown; never replay"})
                }
            };
            registry.requests.insert(key, Receipt { fingerprint: signature, result: reply.clone(), terminal_id: id, pending, close: false });
            return Ok(reply);
        }
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        if action == "ptyMobile.attach" || action == "ptyMobile.close" {
            registry.prune(Instant::now());
            let request = string(&input, "requestId")?;
            let key = serde_json::to_string(&(
                &scope.environment,
                &scope.source,
                &scope.cwd,
                &scope.actor,
                &scope.owner,
                &action,
                request,
            ))
            .map_err(|_| "Invalid PTY receipt")?;
            let signature = serde_json::to_string(&input).map_err(|_| "Invalid PTY receipt")?;
            if registry.requests.contains_key(&key) {
                return registry.receipt_outcome(&key, &signature);
            }
            // One exact close receipt per entry remains available at capacity.
            let closing = action == "ptyMobile.close";
            registry.admit(&key, closing)?;
            if !closing && registry.requests.len() >= 512 {
                return Err("Mobile PTY receipt limit reached".into());
            }
            let value = entry(&mut registry, &scope, &input)?;
            if closing && value.closed {
                let id = value.id.clone();
                // The new ID must never be used for another effect, but repeated
                // mobile retries must not allocate an unbounded receipt history.
                return registry.retry_closed(&key, &id);
            }
            if action == "ptyMobile.attach" {
                let after = input["after"]
                    .as_u64()
                    .ok_or("PTY resume cursor required")?;
                let fresh = input["freshRenderer"]
                    .as_bool()
                    .ok_or("PTY renderer identity required")?;
                if value.exited
                    || after < value.replay.oldest()
                    || after > value.replay.end
                    || (fresh && (after != 0 || value.replay.oldest() != 0))
                {
                    return Err(
                        "PTY replay prefix is unavailable; open a fresh terminal explicitly".into(),
                    );
                }
                value.gap = false;
                value.lease = uuid::Uuid::new_v4().to_string();
                value.seen = Instant::now();
                value.detached = false;
                value.sequence = 0;
                value.input_unknown = false;
                value.input_fingerprint.clear();
                let result = value.lease_dto();
                let terminal_id = value.id.clone();
                registry.settled_attaches.insert(key.clone(), Instant::now());
                registry.requests.insert(key, Receipt { fingerprint: signature, result: result.clone(), terminal_id, pending: false, close: false });
                return Ok(result);
            }
            value.detached = true;
            value.exited = true;
            value.closed = true;
            let id = value.id.clone();
            let already_exited = value.physical_exit;
            registry
                .requests
                .insert(key.clone(), Receipt { fingerprint: signature.clone(), result: if already_exited { json!({"closed":true}) } else { json!({"state":"unknown"}) }, terminal_id: id.clone(), pending: !already_exited, close: true });
            if already_exited { return Ok(json!({"closed":true})); }
            drop(registry);
            let _ = crate::pty::pty_kill(window, app.state::<crate::pty::PtyHost>(), id);
            let registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
            return registry.receipt_outcome(&key, &signature);
        }
        let value = entry(&mut registry, &scope, &input)?;
        if action == "ptyMobile.read" {
            let after = input["after"].as_u64().ok_or("PTY cursor required")?;
            let limit = input["limit"].as_u64().unwrap_or(32768);
            if !(1..=32768).contains(&limit) {
                return Err("Invalid PTY read limit".into());
            }
            let (bytes, next, gap) = value.replay.read(after, limit as usize)?;
            if gap {
                value.gap = true;
            }
            let gap = gap || value.gap;
            if value.leased(&value.lease) {
                value.seen = Instant::now();
            }
            return Ok(
                json!({"terminalId":value.id,"epoch":value.epoch,"after":after,"next":next,"oldest":value.replay.oldest(),"end":value.replay.end,"dataBase64":base64::engine::general_purpose::STANDARD.encode(bytes),"state":if value.physical_exit && value.drained {"exited"}else{"running"},"exitCode":value.code,"gap":gap,"hasMore":!gap&&next<value.replay.end}),
            );
        }
        let lease = string(&input, "leaseId")?;
        if action == "ptyMobile.status" {
            if value.lease != lease {
                return Err("PTY lease changed".into());
            }
            let mut result = value.lease_dto();
            result["lastInputSequence"] = json!(value.sequence);
            result["lastInputState"] = json!(if value.input_unknown {
                "unknown"
            } else {
                "accepted"
            });
            return Ok(result);
        }
        if !value.leased(&lease) {
            return Err("PTY control lease expired or closed".into());
        }
        if action == "ptyMobile.detach" {
            value.detached = true;
            return Ok(json!({"detached":true}));
        }
        if action == "ptyMobile.resize" {
            let (cols, rows) = dimensions(&input)?;
            let id = value.id.clone();
            value.cols = cols;
            value.rows = rows;
            drop(registry);
            crate::pty::mobile_resize(&app, window.label(), &id, cols, rows)?;
            return Ok(json!({"resized":true}));
        }
        let sequence = input["inputSequence"]
            .as_u64()
            .filter(|value| *value > 0 && *value <= 9_007_199_254_740_991)
            .ok_or("PTY input sequence required")?;
        let encoded = input["dataBase64"]
            .as_str()
            .filter(|value| value.len() <= 21848)
            .ok_or("Invalid PTY input")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid PTY input bytes")?;
        if bytes.is_empty() || bytes.len() > 16384 {
            return Err("Invalid PTY input size".into());
        }
        let fingerprint = base64::engine::general_purpose::STANDARD.encode(&bytes);
        if !value.reserve_input(sequence, &fingerprint)? {
            return Ok(json!({"accepted":true,"inputSequence":sequence}));
        }
        let id = value.id.clone();
        drop(registry);
        let result = crate::pty::mobile_write(&app, window.label(), &id, &bytes);
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        let value = entry(&mut registry, &scope, &input)?;
        if value.lease != lease {
            return Err("PTY control changed while writing; outcome unknown".into());
        }
        if result.is_ok() {
            value.input_unknown = false;
            value.seen = Instant::now();
            value.mark_settled(Instant::now());
        }
        result
            .map(|_| json!({"accepted":true,"inputSequence":sequence}))
            .map_err(|_| "PTY input outcome is unknown; never resend".into())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_entry(id: &str, now: Instant) -> Entry {
        Entry {
            scope: Scope {
                environment: "env".into(),
                source: "source".into(),
                cwd: "/project".into(),
                actor: "actor".into(),
                owner: "owner".into(),
            },
            id: id.into(),
            epoch: "epoch".into(),
            lease: "lease".into(),
            seen: now,
            replay: Replay::new(),
            cols: 80,
            rows: 24,
            shell: "default".into(),
            exited: false,
            physical_exit: false,
            native_generation: None,
            closed: false,
            settled_at: None,
            code: None,
            detached: false,
            drained: false,
            sequence: 0,
            input_unknown: false,
            input_fingerprint: String::new(),
            gap: false,
        }
    }
    #[test]
    fn completed_receipts_age_into_permanent_fence_without_duplicate_admission() {
        let now = Instant::now();
        let mut registry = Registry::default();
        for i in 0..300 {
            let id = format!("terminal-{i}");
            let key = format!("request-{i}");
            let mut value = test_entry(&id, now);
            value.physical_exit = true;
            value.drained = true;
            value.mark_settled(now);
            registry.entries.insert(id.clone(), value);
            registry.requests.insert(
                key.clone(),
                Receipt {
                    fingerprint: "original".into(),
                    result: json!({"closed":true}),
                    terminal_id: id,
                    pending: false,
                    close: false,
                },
            );
            registry.prune(now + SETTLED_TTL - Duration::from_millis(1));
            assert!(registry.requests.contains_key(&key));
            registry.prune(now + SETTLED_TTL);
            assert!(!registry.requests.contains_key(&key));
            assert!(registry.admit(&key, false).is_err());
        }
        assert!(registry.entries.is_empty());
        assert!(registry.requests.is_empty());
        assert!(registry.admit("new-request", false).is_ok());
    }
    #[test]
    fn live_terminal_completed_attach_receipts_expire_without_rotating_old_ids() {
        let now = Instant::now();
        let mut registry = Registry::default();
        registry
            .entries
            .insert("live".into(), test_entry("live", now));
        registry.requests.insert(
            "create".into(),
            Receipt {
                fingerprint: "create".into(),
                result: json!({"state":"unknown"}),
                terminal_id: "live".into(),
                pending: true,
                close: false,
            },
        );
        registry.requests.insert(
            "close".into(),
            Receipt {
                fingerprint: "close".into(),
                result: json!({"state":"unknown"}),
                terminal_id: "live".into(),
                pending: true,
                close: true,
            },
        );
        for i in 0..600 {
            let key = format!("attach-{i}");
            let at = now + SETTLED_TTL * i;
            assert!(registry.admit(&key, false).is_ok());
            registry.requests.insert(
                key.clone(),
                Receipt {
                    fingerprint: "attach".into(),
                    result: json!({"leaseId":"original"}),
                    terminal_id: "live".into(),
                    pending: false,
                    close: false,
                },
            );
            registry.settled_attaches.insert(key.clone(), at);
            registry.prune(at + SETTLED_TTL - Duration::from_millis(1));
            assert!(registry.requests.contains_key(&key));
            registry.prune(at + SETTLED_TTL);
            assert!(!registry.requests.contains_key(&key));
            assert!(registry.admit(&key, false).is_err());
            assert_eq!(registry.entries["live"].lease, "lease");
        }
        assert!(registry.requests.contains_key("create"));
        assert!(registry.requests.contains_key("close"));
        assert_eq!(registry.entries.len(), 1);
    }
    #[test]
    fn live_unknown_incomplete_drain_and_pending_receipts_never_age_out() {
        let now = Instant::now();
        let mut registry = Registry::default();
        for (id, physical_exit, drained, pending) in [
            ("live", false, false, false),
            ("close-unknown", false, true, false),
            ("drain-unknown", true, false, false),
            ("pending", true, true, true),
        ] {
            let mut value = test_entry(id, now);
            value.exited = true;
            value.physical_exit = physical_exit;
            value.drained = drained;
            value.mark_settled(now);
            registry.entries.insert(id.into(), value);
            registry.requests.insert(
                id.into(),
                Receipt {
                    fingerprint: "request".into(),
                    result: json!({"state":"unknown"}),
                    terminal_id: id.into(),
                    pending,
                    close: false,
                },
            );
        }
        registry.prune(now + SETTLED_TTL * 100);
        assert_eq!(registry.entries.len(), 4);
        assert_eq!(registry.requests.len(), 4);
        assert_eq!(registry.expired.set_bits, 0);
    }
    #[test]
    fn unknown_input_and_replay_gap_block_expiry_even_after_exit_and_drain() {
        let now = Instant::now();
        let mut registry = Registry::default();
        for id in ["unknown-input", "gap"] {
            let mut value = test_entry(id, now);
            value.record_exit(Some(0), now);
            value.record_drain(true, now);
            if id == "gap" {
                value.gap = true;
            } else {
                value.input_unknown = true;
            }
            registry.entries.insert(id.into(), value);
            registry.requests.insert(
                id.into(),
                Receipt {
                    fingerprint: "original".into(),
                    result: json!({"closed":true}),
                    terminal_id: id.into(),
                    pending: false,
                    close: false,
                },
            );
        }
        registry.prune(now + SETTLED_TTL * 100);
        assert_eq!(registry.capacity(), (2, 0));
        assert_eq!(registry.entries.len(), 2);
        assert_eq!(registry.requests.len(), 2);
        assert_eq!(registry.expired.set_bits, 0);
    }
    #[test]
    fn close_and_drain_do_not_prove_exit_and_failed_drain_blocks_retirement() {
        let now = Instant::now();
        let mut value = test_entry("id", now);
        value.closed = true;
        value.exited = true;
        value.record_drain(true, now);
        assert!(value.settled_at.is_none());
        assert_eq!(value.dto()["state"], "running");
        value.record_exit(Some(0), now + Duration::from_secs(1));
        assert_eq!(value.settled_at, Some(now + Duration::from_secs(1)));
        let mut failed = test_entry("failed", now);
        failed.record_exit(None, now);
        failed.record_drain(false, now);
        assert!(failed.gap);
        assert!(failed.settled_at.is_none());
    }
    #[test]
    fn native_generation_rejects_replacement_and_stale_callbacks() {
        let now = Instant::now();
        let mut value = test_entry("id", now);
        value.reserve_generation("first".into()).unwrap();
        assert!(value.reserve_generation("second".into()).is_err());
        assert!(!value.matches_generation("second"));
        assert!(value.matches_generation("first"));
        value.closed = true;
        assert!(value.reserve_generation("third".into()).is_err());
    }
    #[test]
    fn close_ack_waits_for_matching_exit_and_new_retries_never_repeat_effect() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let mut value = test_entry("id", now);
        value.reserve_generation("generation".into()).unwrap();
        value.closed = true;
        value.exited = true;
        registry.entries.insert("id".into(), value);
        registry.requests.insert(
            "create".into(),
            Receipt {
                fingerprint: "create".into(),
                result: json!({"state":"unknown"}),
                terminal_id: "id".into(),
                pending: true,
                close: false,
            },
        );
        registry.requests.insert(
            "close".into(),
            Receipt {
                fingerprint: "original".into(),
                result: json!({"state":"unknown"}),
                terminal_id: "id".into(),
                pending: true,
                close: true,
            },
        );
        // A successful kill dispatch is not physical exit; same and fresh IDs
        // both report unconfirmed without allocating another receipt.
        assert!(registry.receipt_outcome("close", "original").is_err());
        assert!(registry.receipt_outcome("close", "different").is_err());
        assert!(registry.retry_closed("fresh", "id").is_err());
        assert!(registry.admit("fresh", true).is_err());
        assert_eq!(registry.requests.len(), 2);
        registry.record_physical_exit("id", "stale", Some(0), now);
        assert!(registry.receipt_outcome("close", "original").is_err());
        registry.record_physical_exit("id", "generation", Some(0), now);
        assert_eq!(
            registry.receipt_outcome("close", "original").unwrap(),
            json!({"closed":true})
        );
        assert!(registry.requests["create"].pending);
        assert_eq!(
            registry.requests["create"].result,
            json!({"state":"unknown"})
        );
        assert_eq!(
            registry.retry_closed("fresh-after", "id").unwrap(),
            json!({"closed":true})
        );
        assert_eq!(registry.requests.len(), 2);
        assert!(registry.admit("fresh-after", true).is_err());
    }
    #[test]
    fn fence_saturation_refuses_new_admission_without_clearing_old_ids() {
        let mut registry = Registry::default();
        registry.expired.insert("old");
        registry.expired.set_bits = FENCE_BYTES * 8 / 4;
        assert!(registry.admit("old", false).is_err());
        assert!(registry.admit("old", true).is_err());
        assert!(registry.admit("fresh", false).is_err());
        assert!(registry.admit("fresh", true).is_ok());
        assert!(registry.expired.contains("old"));
    }
    #[test]
    fn confirmed_history_does_not_consume_active_capacity_and_pending_does() {
        let now = Instant::now();
        let mut registry = Registry::default();
        for i in 0..16 {
            let id = format!("settled-{i}");
            let mut value = test_entry(&id, now);
            value.physical_exit = true;
            value.drained = true;
            value.mark_settled(now);
            registry.entries.insert(id, value);
        }
        let mut pending = test_entry("pending", now);
        pending.physical_exit = true;
        pending.drained = true;
        pending.mark_settled(now);
        registry.entries.insert("pending".into(), pending);
        registry.requests.insert(
            "pending-request".into(),
            Receipt {
                fingerprint: "x".into(),
                result: json!({"state":"unknown"}),
                terminal_id: "pending".into(),
                pending: true,
                close: false,
            },
        );
        assert_eq!(registry.capacity(), (1, 16));
        registry.prune(now + SETTLED_TTL);
        assert_eq!(registry.capacity(), (1, 0));
    }
    #[test]
    fn byte_replay_keeps_utf8_fragments_and_refuses_gap_as_screen() {
        let mut replay = Replay::new();
        replay.push(&[0xe2]);
        replay.push(&[0x82, 0xac, 27, b'[', b'2', b'J']);
        assert_eq!(replay.read(0, 2).unwrap().0, vec![0xe2, 0x82]);
        replay.push(&vec![b'x'; OUTPUT_LIMIT]);
        assert!(replay.read(0, 32).unwrap().2);
        assert_eq!(replay.bytes.len(), OUTPUT_LIMIT);
        assert!(replay.read(replay.end + 1, 1).is_err());
    }
    #[test]
    fn input_reservation_never_replays_unknown_or_reorders() {
        let mut value = Entry {
            scope: Scope {
                environment: "env".into(),
                source: "s".into(),
                cwd: "/project".into(),
                actor: "actor".into(),
                owner: "window".into(),
            },
            id: "id".into(),
            epoch: "epoch".into(),
            lease: "lease".into(),
            seen: Instant::now(),
            replay: Replay::new(),
            cols: 80,
            rows: 24,
            shell: "default".into(),
            exited: false,
            physical_exit: false,
            native_generation: None,
            closed: false,
            settled_at: None,
            code: None,
            detached: false,
            drained: false,
            sequence: 0,
            input_unknown: false,
            input_fingerprint: String::new(),
            gap: false,
        };
        assert!(value.reserve_input(1, "bytes").unwrap());
        assert!(value.reserve_input(1, "bytes").is_err());
        assert!(value.reserve_input(2, "other").is_err());
        value.input_unknown = false;
        assert!(!value.reserve_input(1, "bytes").unwrap());
        assert!(value.reserve_input(1, "different").is_err());
        assert!(value.reserve_input(3, "other").is_err());
        assert!(value.reserve_input(2, "next").unwrap());
        value.detached = true;
        assert!(!value.leased("lease"));
        value.exited = true;
        assert_eq!(value.dto()["state"], "running");
        value.drained = true;
        assert_eq!(value.dto()["state"], "running");
        value.physical_exit = true;
        assert_eq!(value.dto()["state"], "exited");
        let scope = value.scope.clone();
        let mut registry = Registry::default();
        registry.entries.insert("id".into(), value);
        let input = json!({"terminalId":"id","epoch":"epoch"});
        assert!(entry(&mut registry, &scope, &input).is_ok());
        let mut other = scope.clone();
        other.actor = "other".into();
        assert!(entry(&mut registry, &other, &input).is_err());
        other = scope.clone();
        other.cwd = "/different".into();
        assert!(entry(&mut registry, &other, &input).is_err());
        assert!(entry(
            &mut registry,
            &scope,
            &json!({"terminalId":"id","epoch":"old"})
        )
        .is_err());
    }
}
