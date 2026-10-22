//! Opt-in metadata/replay over the canonical PTY owner; never a second process backend.
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const OUTPUT_LIMIT: usize = 1024 * 1024;
const LEASE: Duration = Duration::from_secs(30);
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
    code: Option<i32>,
    detached: bool,
    drained: bool,
    sequence: u64,
    input_unknown: bool,
    input_fingerprint: String,
    gap: bool,
}
impl Entry {
    fn leased(&self, lease: &str) -> bool {
        !self.gap
            && !self.detached
            && !self.exited
            && self.lease == lease
            && self.seen.elapsed() < LEASE
    }
    fn dto(&self) -> Value {
        json!({"terminalId":self.id,"epoch":self.epoch,"sourceSessionId":self.scope.source,"name":"Mobile terminal","shell":self.shell,"state":if self.exited && self.drained {"exited"}else{"running"},"cols":self.cols,"rows":self.rows,"exitCode":self.code,"control":if self.leased(&self.lease){"mobile"}else{"none"},"replayStart":self.replay.oldest(),"replayEnd":self.replay.end})
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
    requests: HashMap<String, (String, Value)>,
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
pub(crate) fn exited(app: &AppHandle, id: &str, code: Option<i32>) {
    if let Some(host) = app.try_state::<MobilePtyHost>() {
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = registry.entries.get_mut(id) {
            entry.exited = true;
            entry.detached = true;
            entry.code = code;
        }
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
pub(crate) fn drained(app: &AppHandle, id: &str) {
    if let Some(host) = app.try_state::<MobilePtyHost>() {
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = registry.entries.get_mut(id) {
            entry.drained = true;
        }
    }
}

#[tauri::command(async)]
pub fn mobile_pty_call(
    app: AppHandle,
    window: tauri::Window,
    action: String,
    input: Value,
) -> Result<Value, String> {
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
        let registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        let result = registry
            .requests
            .get(&key)
            .map(|(_, value)| value.clone())
            .unwrap_or_else(|| json!({"state":"unknown"}));
        if let Some(id) = result["terminal"]["terminalId"].as_str() {
            return Ok(registry.entries.get(id).filter(|value|value.scope==scope).map(Entry::lease_dto).unwrap_or_else(||json!({"state":"failed","message":"The created PTY was closed; no replacement was started"})));
        }
        return Ok(result);
    }
    if action == "ptyMobile.list" {
        let registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        return Ok(
            json!({"terminals":registry.entries.values().filter(|entry|entry.scope==scope).map(Entry::dto).collect::<Vec<_>>()}),
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
            if let Some((fingerprint, result)) = registry.requests.get(&key) {
                return if fingerprint == &signature {
                    Ok(result.clone())
                } else {
                    Err("PTY request identity changed".into())
                };
            }
            if registry.entries.len() >= 16 || registry.requests.len() >= 128 {
                return Err("Mobile PTY limit reached".into());
            }
            registry
                .requests
                .insert(key.clone(), (signature.clone(), json!({"state":"unknown"})));
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
            exited(&app, &id, None);
            return Err("Mobile PTY source closed during creation; no replay".into());
        }
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        let value = registry
            .entries
            .get_mut(&id)
            .ok_or("Mobile PTY creation interrupted")?;
        let reply = match result {
            Ok(()) => value.lease_dto(),
            Err(_) => {
                value.exited = true;
                value.detached = true;
                value.drained = true;
                json!({"state":"failed","message":"Could not create mobile PTY"})
            }
        };
        registry.requests.insert(key, (signature, reply.clone()));
        return Ok(reply);
    }
    let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
    if action == "ptyMobile.attach" || action == "ptyMobile.close" {
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
        if let Some((fingerprint, result)) = registry.requests.get(&key) {
            return if fingerprint == &signature {
                Ok(result.clone())
            } else {
                Err("PTY request identity changed".into())
            };
        }
        if registry.requests.len() >= 128 {
            return Err("Mobile PTY receipt limit reached".into());
        }
        let value = entry(&mut registry, &scope, &input)?;
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
            registry.requests.insert(key, (signature, result.clone()));
            return Ok(result);
        }
        value.detached = true;
        value.exited = true;
        let id = value.id.clone();
        registry
            .requests
            .insert(key.clone(), (signature.clone(), json!({"state":"unknown"})));
        drop(registry);
        crate::pty::pty_kill(window, app.state::<crate::pty::PtyHost>(), id)?;
        let result = json!({"closed":true});
        let mut registry = host.inner.lock().unwrap_or_else(|e| e.into_inner());
        registry
            .entries
            .remove(input["terminalId"].as_str().unwrap_or_default());
        registry.requests.insert(key, (signature, result.clone()));
        return Ok(result);
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
        if value.leased(&value.lease) {
            value.seen = Instant::now();
        }
        return Ok(
            json!({"terminalId":value.id,"epoch":value.epoch,"after":after,"next":next,"oldest":value.replay.oldest(),"end":value.replay.end,"dataBase64":base64::engine::general_purpose::STANDARD.encode(bytes),"state":if value.exited && value.drained {"exited"}else{"running"},"exitCode":value.code,"gap":gap,"hasMore":!gap&&next<value.replay.end}),
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
    }
    result
        .map(|_| json!({"accepted":true,"inputSequence":sequence}))
        .map_err(|_| "PTY input outcome is unknown; never resend".into())
}

#[cfg(test)]
mod tests {
    use super::*;
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
