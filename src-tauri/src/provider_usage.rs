//! Token usage read from the Claude Code and Codex session logs on disk.
//!
//! Each provider CLI writes one JSONL transcript per session into its config
//! directory. This module walks the directory for one account profile, keeps
//! the per-request token counts newer than a cutoff, and folds them into
//! 15-minute buckets per model and working directory. Pricing and calendar-day
//! grouping happen in the webview, which knows the user's time zone.
//!
//! Parsing a transcript is the expensive part, so each file's requests are
//! kept in an on-disk cache keyed by path, size and modification time. A scan
//! only reparses files that are new or have changed; everything else is read
//! back from the cache, and the cutoff is applied afterwards.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Bucket width. Fine enough that every time zone offset (including the
/// 30- and 45-minute ones) lands a bucket on the right local day.
const SLOT_SECONDS: i64 = 15 * 60;
/// How deep to look below the log root. Claude nests subagent transcripts
/// under `projects/<project>/<session>/subagents/`; Codex uses
/// `sessions/YYYY/MM/DD/`.
const MAX_DEPTH: usize = 5;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    /// Start of the 15-minute bucket, in Unix seconds (UTC).
    pub slot: i64,
    pub model: String,
    /// Working directory the session ran in. Empty when the log has none.
    pub project: String,
    /// Input tokens billed at the full rate (cache reads and writes excluded).
    pub input: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub output: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub rows: Vec<UsageRow>,
    /// False when the account has no log directory yet.
    pub found: bool,
    pub files_scanned: usize,
    /// How many of those had to be parsed; the rest came from the cache.
    pub files_parsed: usize,
}

#[tauri::command]
pub async fn provider_usage_report(
    app: AppHandle,
    provider: String,
    account_id: Option<String>,
    since_ms: i64,
) -> Result<UsageReport, String> {
    let config_dir = account_config_dir(&app, &provider, account_id.as_deref())?;
    // One cache file per account directory, so concurrent accounts never share one.
    let cache = app.path().app_cache_dir().ok().map(|dir| {
        dir.join(format!(
            "usage-scan-{provider}-{:016x}.json",
            fnv1a(&config_dir.to_string_lossy())
        ))
    });
    tauri::async_runtime::spawn_blocking(move || {
        // Two views asking at once would both parse the same cold logs; the
        // second waits and then reads what the first cached.
        static SCAN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _scan = SCAN_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let since = since_ms.div_euclid(1000);
        Ok(match provider.as_str() {
            "claude" => scan(
                &[config_dir.join("projects")],
                since,
                Provider::Claude,
                cache.as_deref(),
            ),
            // Codex moves sessions the user archives out of `sessions`.
            _ => scan(
                &[
                    config_dir.join("sessions"),
                    config_dir.join("archived_sessions"),
                ],
                since,
                Provider::Codex,
                cache.as_deref(),
            ),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The directory a provider CLI uses for this account, without creating it.
pub(crate) fn account_config_dir(
    app: &AppHandle,
    provider: &str,
    account_id: Option<&str>,
) -> Result<PathBuf, String> {
    if provider != "claude" && provider != "codex" {
        return Err("Usage is only available for Claude Code and Codex".into());
    }
    if let Some(id) = account_id.filter(|id| *id != crate::harness::DEFAULT_PROVIDER_ACCOUNT_ID) {
        return crate::harness::provider_account_path(app, provider, id);
    }
    let (env, dir) = if provider == "claude" {
        ("CLAUDE_CONFIG_DIR", ".claude")
    } else {
        ("CODEX_HOME", ".codex")
    };
    match std::env::var_os(env).filter(|value| !value.is_empty()) {
        Some(path) => Ok(PathBuf::from(path)),
        None => {
            Ok(PathBuf::from(crate::dirs_home().ok_or("Home directory is unavailable")?).join(dir))
        }
    }
}

/// Which transcript format, and how a request seen twice is reconciled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provider {
    Claude,
    Codex,
}

impl Provider {
    fn parse(self, path: &Path, requests: &mut Requests) {
        match self {
            Provider::Claude => parse_claude_file(path, requests),
            Provider::Codex => parse_codex_file(path, requests),
        }
    }

    /// Claude repeats a request with growing counts; Codex repeats it verbatim.
    fn merge(self, requests: &mut Requests, key: u64, request: Request) {
        match requests.get_mut(&key) {
            Some(kept) if self == Provider::Claude => kept.usage.keep_largest(&request.usage),
            Some(_) => {}
            None => {
                requests.insert(key, request);
            }
        }
    }
}

type Totals = HashMap<(i64, String, String), UsageRow>;

/// A request seen in the logs, keyed by a hash of its ids, before it is bucketed.
struct Request {
    timestamp: i64,
    model: String,
    project: String,
    usage: UsageRow,
}
type Requests = HashMap<u64, Request>;

impl UsageRow {
    fn keep_largest(&mut self, other: &UsageRow) {
        self.input = self.input.max(other.input);
        self.cache_read = self.cache_read.max(other.cache_read);
        self.cache_write_5m = self.cache_write_5m.max(other.cache_write_5m);
        self.cache_write_1h = self.cache_write_1h.max(other.cache_write_1h);
        self.output = self.output.max(other.output);
    }
}

/// FNV-1a, so request keys hash the same in every run and toolchain; the
/// standard hasher makes no such promise and the cache outlives a run.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Bumped whenever the parsers or this layout change what a file yields.
const CACHE_VERSION: u32 = 1;

/// One request in the cache: key, time, model and project (indexes into the
/// file's strings), then the five token counts.
#[derive(Serialize, Deserialize)]
struct CachedRequest(u64, i64, u32, u32, u64, u64, u64, u64, u64);

#[derive(Serialize, Deserialize)]
struct CachedFile {
    size: u64,
    modified_ms: i64,
    strings: Vec<String>,
    requests: Vec<CachedRequest>,
}

#[derive(Default, Serialize, Deserialize)]
struct ScanCache {
    version: u32,
    files: HashMap<String, CachedFile>,
}

impl CachedFile {
    fn new(size: u64, modified_ms: i64, requests: Requests) -> Self {
        let mut strings: Vec<String> = Vec::new();
        let mut index: HashMap<String, u32> = HashMap::new();
        let mut intern = |text: &str| -> u32 {
            *index.entry(text.to_string()).or_insert_with(|| {
                strings.push(text.to_string());
                strings.len() as u32 - 1
            })
        };
        let requests = requests
            .into_iter()
            .map(|(key, request)| {
                let usage = &request.usage;
                CachedRequest(
                    key,
                    request.timestamp,
                    intern(&request.model),
                    intern(&request.project),
                    usage.input,
                    usage.cache_read,
                    usage.cache_write_5m,
                    usage.cache_write_1h,
                    usage.output,
                )
            })
            .collect();
        CachedFile {
            size,
            modified_ms,
            strings,
            requests,
        }
    }

    fn decode(&self, cached: &CachedRequest) -> Option<(u64, Request)> {
        let CachedRequest(key, timestamp, model, project, input, cache_read, w5, w1, output) =
            cached;
        Some((
            *key,
            Request {
                timestamp: *timestamp,
                model: self.strings.get(*model as usize)?.clone(),
                project: self.strings.get(*project as usize)?.clone(),
                usage: UsageRow {
                    input: *input,
                    cache_read: *cache_read,
                    cache_write_5m: *w5,
                    cache_write_1h: *w1,
                    output: *output,
                    ..UsageRow::default()
                },
            },
        ))
    }
}

fn load_cache(path: &Path) -> ScanCache {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ScanCache>(&bytes).ok())
        .filter(|cache| cache.version == CACHE_VERSION)
        .unwrap_or_default()
}

/// Written beside the target and renamed into place, so a crash mid-write
/// leaves the previous cache intact. Failure only costs the next scan time.
fn save_cache(path: &Path, cache: &ScanCache) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let Ok(bytes) = serde_json::to_vec(cache) else {
        return;
    };
    let temp = path.with_extension("tmp");
    if std::fs::write(&temp, bytes).is_ok() && std::fs::rename(&temp, path).is_err() {
        let _ = std::fs::remove_file(&temp);
    }
}

/// Size and modification time in milliseconds: what says a file is unchanged.
fn file_stamp(path: &Path) -> Option<(u64, i64)> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some((metadata.len(), modified))
}

/// A transcript to (re)parse: cache key, path, size and modification time.
type StaleFile = (String, PathBuf, u64, i64);

/// Parses every changed file, spread across the available cores.
fn parse_files(provider: Provider, stale: &[StaleFile]) -> Vec<CachedFile> {
    let next = AtomicUsize::new(0);
    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(stale.len().max(1));
    let mut parsed: Vec<(usize, CachedFile)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                scope.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        let Some((_, path, size, modified)) = stale.get(index) else {
                            return out;
                        };
                        let mut requests = Requests::new();
                        provider.parse(path, &mut requests);
                        out.push((index, CachedFile::new(*size, *modified, requests)));
                    }
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    });
    parsed.sort_by_key(|(index, _)| *index);
    parsed.into_iter().map(|(_, file)| file).collect()
}

fn scan(
    roots: &[PathBuf],
    since: i64,
    provider: Provider,
    cache_path: Option<&Path>,
) -> UsageReport {
    let roots: Vec<&PathBuf> = roots.iter().filter(|root| root.is_dir()).collect();
    if roots.is_empty() {
        return UsageReport::default();
    }
    let mut files = Vec::new();
    let mut names = HashMap::new();
    for (index, root) in roots.iter().enumerate() {
        let mut found = Vec::new();
        collect_jsonl(root, since, 0, &mut found);
        for (modified, path) in found {
            // The same session under two roots (moved while we scan) counts once.
            let name = log_name(&path);
            if *names.entry(name).or_insert(index) == index {
                files.push((modified, path));
            }
        }
    }
    // Oldest first, so a request logged again by a resumed session is counted
    // once, under the transcript that first recorded it.
    files.sort_by_key(|(modified, _)| *modified);

    let mut cache = cache_path.map(load_cache).unwrap_or_default();
    cache.version = CACHE_VERSION;
    let mut dirty = false;
    let mut stale = Vec::new();
    let mut seen = HashSet::new();
    for (_, path) in &files {
        let Some((size, modified)) = file_stamp(path) else {
            continue;
        };
        let key = path.to_string_lossy().into_owned();
        let fresh = cache
            .files
            .get(&key)
            .is_some_and(|entry| entry.size == size && entry.modified_ms == modified);
        if !fresh {
            stale.push((key.clone(), path.clone(), size, modified));
        }
        seen.insert(key);
    }
    let files_parsed = stale.len();
    if !stale.is_empty() {
        dirty = true;
        let parsed = parse_files(provider, &stale);
        for ((key, ..), file) in stale.into_iter().zip(parsed) {
            cache.files.insert(key, file);
        }
    }

    // In file order (the sort above), so the first transcript to record a
    // request owns it.
    let mut requests = Requests::new();
    for (_, path) in &files {
        let key = path.to_string_lossy();
        if let Some(entry) = cache.files.get(key.as_ref()) {
            for cached in &entry.requests {
                if let Some((id, request)) = entry.decode(cached) {
                    provider.merge(&mut requests, id, request);
                }
            }
        }
    }
    // Drop entries for transcripts that no longer exist; keep older ones the
    // cutoff skipped, since a longer range will want them.
    let before = cache.files.len();
    cache
        .files
        .retain(|key, _| seen.contains(key) || Path::new(key).exists());
    dirty |= cache.files.len() != before;
    if dirty {
        if let Some(path) = cache_path {
            save_cache(path, &cache);
        }
    }

    let mut totals = Totals::new();
    for request in requests.into_values() {
        if request.timestamp < since {
            continue;
        }
        add(
            &mut totals,
            request.timestamp,
            &request.model,
            &request.project,
            &request.usage,
        );
    }
    let mut rows: Vec<UsageRow> = totals.into_values().collect();
    rows.sort_by(|a, b| (a.slot, &a.model, &a.project).cmp(&(b.slot, &b.model, &b.project)));
    UsageReport {
        rows,
        found: true,
        files_scanned: files.len(),
        files_parsed,
    }
}

pub(crate) fn collect_jsonl(dir: &Path, since: i64, depth: usize, out: &mut Vec<(i64, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            if depth < MAX_DEPTH {
                collect_jsonl(&path, since, depth + 1, out);
            }
            continue;
        }
        if !file_type.is_file() || !is_log(&path) {
            continue;
        }
        // A transcript last written before the cutoff holds nothing newer.
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|elapsed: Duration| elapsed.as_secs() as i64)
            .unwrap_or(i64::MAX);
        if modified >= since {
            out.push((modified, path));
        }
    }
}

/// A JSONL transcript, plain or zstd-compressed as Codex can store them.
pub(crate) fn is_log(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
}

fn log_name(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    name.strip_suffix(".zst").unwrap_or(name).to_string()
}

fn add(totals: &mut Totals, timestamp: i64, model: &str, project: &str, usage: &UsageRow) {
    let slot = timestamp.div_euclid(SLOT_SECONDS) * SLOT_SECONDS;
    let row = totals
        .entry((slot, model.to_string(), project.to_string()))
        .or_insert_with(|| UsageRow {
            slot,
            model: model.to_string(),
            project: project.to_string(),
            ..UsageRow::default()
        });
    row.input += usage.input;
    row.cache_read += usage.cache_read;
    row.cache_write_5m += usage.cache_write_5m;
    row.cache_write_1h += usage.cache_write_1h;
    row.output += usage.output;
}

/// Lines of a transcript, decompressed on the fly for `.zst` files. Reading
/// stops at the first damaged line or frame.
fn lines(path: &Path) -> Box<dyn Iterator<Item = String>> {
    match open_log(path) {
        Some(reader) => Box::new(reader.lines().map_while(Result::ok)),
        None => Box::new(std::iter::empty()),
    }
}

/// A transcript opened for reading, decompressed on the fly for `.zst` files.
pub(crate) fn open_log(path: &Path) -> Option<Box<dyn BufRead>> {
    let file = BufReader::new(std::fs::File::open(path).ok()?);
    if path.extension().and_then(|ext| ext.to_str()) == Some("zst") {
        let frames = ZstdFrames {
            source: Some(file),
            decoder: None,
        };
        return Some(Box::new(BufReader::new(frames)));
    }
    Some(Box::new(file))
}

/// Streams every frame of a zstd file in turn, since a file appended to over
/// time can hold several.
struct ZstdFrames<R: BufRead> {
    source: Option<R>,
    decoder: Option<ruzstd::decoding::StreamingDecoder<R, ruzstd::decoding::FrameDecoder>>,
}

impl<R: BufRead> Read for ZstdFrames<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            if let Some(decoder) = &mut self.decoder {
                match decoder.read(buf) {
                    Ok(0) if !buf.is_empty() => {
                        // Frame finished; carry on with whatever follows it.
                        self.source = self.decoder.take().map(|decoder| decoder.into_inner());
                    }
                    result => return result,
                }
            }
            let Some(mut source) = self.source.take() else {
                return Ok(0);
            };
            if source.fill_buf()?.is_empty() {
                return Ok(0);
            }
            let decoder = ruzstd::decoding::StreamingDecoder::new(source)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            self.decoder = Some(decoder);
        }
    }
}

fn count(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Claude Code writes one line per content block of an assistant message, each
/// repeating the message's usage, so requests are keyed by message and request
/// id and counted once. An early line can carry a partial snapshot (output
/// still streaming), so each count keeps the largest value logged for it.
fn parse_claude_file(path: &Path, requests: &mut Requests) {
    for line in lines(path) {
        if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some((timestamp, model, project, usage, key)) = claude_usage(&entry) {
            Provider::Claude.merge(
                requests,
                fnv1a(&key),
                Request {
                    timestamp,
                    model,
                    project,
                    usage,
                },
            );
        }
    }
}

fn claude_usage(entry: &Value) -> Option<(i64, String, String, UsageRow, String)> {
    if entry.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = entry.get("message")?;
    let model = message.get("model")?.as_str()?;
    // Locally generated notices ("<synthetic>") were never billed.
    if model.starts_with('<') {
        return None;
    }
    let usage = message.get("usage")?;
    let timestamp = parse_timestamp(entry.get("timestamp")?.as_str()?)?;
    let cache_write = count(usage, "cache_creation_input_tokens");
    let (write_5m, write_1h) = match usage.get("cache_creation") {
        Some(split) => (
            count(split, "ephemeral_5m_input_tokens"),
            count(split, "ephemeral_1h_input_tokens"),
        ),
        None => (cache_write, 0),
    };
    let row = UsageRow {
        input: count(usage, "input_tokens"),
        cache_read: count(usage, "cache_read_input_tokens"),
        // Older logs report only the total; treat it all as 5-minute writes.
        cache_write_5m: if write_5m + write_1h == 0 {
            cache_write
        } else {
            write_5m
        },
        cache_write_1h: write_1h,
        output: count(usage, "output_tokens"),
        ..UsageRow::default()
    };
    let message_id = message.get("id").and_then(Value::as_str).unwrap_or("");
    let request_id = entry.get("requestId").and_then(Value::as_str).unwrap_or("");
    let key = if message_id.is_empty() && request_id.is_empty() {
        entry
            .get("uuid")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    } else {
        format!("{message_id}:{request_id}")
    };
    let project = entry
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Some((timestamp, model.to_string(), project, row, key))
}

/// Codex logs a running total after each model response. `last_token_usage`
/// is that response alone; a repeated total means the same response was
/// reported twice. A resumed or forked session replays earlier lines into a
/// new rollout, so responses are also keyed across files and counted once.
fn parse_codex_file(path: &Path, requests: &mut Requests) {
    let mut model = String::new();
    let mut project = String::new();
    let mut last_total: Option<u64> = None;
    for line in lines(path) {
        let wanted = line.contains("token_count")
            || line.contains("turn_context")
            || line.contains("session_meta");
        if !wanted {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(payload) = entry.get("payload") else {
            continue;
        };
        match entry.get("type").and_then(Value::as_str) {
            Some("session_meta") | Some("turn_context") => {
                if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                    project = cwd.to_string();
                }
                if let Some(name) = payload.get("model").and_then(Value::as_str) {
                    model = name.to_string();
                }
            }
            Some("event_msg")
                if payload.get("type").and_then(Value::as_str) == Some("token_count") =>
            {
                let Some(info) = payload.get("info").filter(|info| !info.is_null()) else {
                    continue;
                };
                let total = info
                    .get("total_token_usage")
                    .map(|usage| count(usage, "total_tokens"));
                if total.is_some() && total == last_total {
                    continue;
                }
                last_total = total;
                let Some(usage) = info.get("last_token_usage") else {
                    continue;
                };
                let Some(timestamp) = entry
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(parse_timestamp)
                else {
                    continue;
                };
                let input = count(usage, "input_tokens");
                let cached = count(usage, "cached_input_tokens").min(input);
                let row = UsageRow {
                    input: input - cached,
                    cache_read: cached,
                    output: count(usage, "output_tokens"),
                    ..UsageRow::default()
                };
                let name = if model.is_empty() { "codex" } else { &model };
                let key = format!(
                    "{}|{}|{}",
                    entry.get("timestamp").and_then(Value::as_str).unwrap_or(""),
                    info.get("total_token_usage").unwrap_or(&Value::Null),
                    usage,
                );
                Provider::Codex.merge(
                    requests,
                    fnv1a(&key),
                    Request {
                        timestamp,
                        model: name.to_string(),
                        project: project.clone(),
                        usage: row,
                    },
                );
            }
            _ => {}
        }
    }
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)` into Unix seconds.
pub(crate) fn parse_timestamp(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> { text.get(range)?.parse().ok() };
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut rest = &text[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        rest = fraction.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        zone if zone.len() == 6 && (zone.starts_with('+') || zone.starts_with('-')) => {
            let hours: i64 = zone.get(1..3)?.parse().ok()?;
            let minutes: i64 = zone.get(4..6)?.parse().ok()?;
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            sign * (hours * 3600 + minutes * 60)
        }
        _ => return None,
    };
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const PRICES_FILE: &str = "openrouter-prices.json";
/// How long a downloaded price list is used before it is fetched again.
const PRICES_MAX_AGE_SECS: u64 = 24 * 60 * 60;
const PRICES_TIMEOUT: Duration = Duration::from_secs(15);

/// One model's list price in US dollars per token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    /// OpenRouter id, such as `anthropic/claude-opus-5.5`.
    pub id: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
    pub cache_write_1h: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrices {
    pub models: Vec<ModelPrice>,
    /// When the list was downloaded, in Unix seconds.
    pub fetched_at: u64,
}

/// Anthropic and OpenAI list prices from OpenRouter's public model list.
///
/// Only the public list is downloaded; nothing about local usage is sent.
/// The list is cached on disk for a day, and a stale copy is returned when
/// the download fails.
#[tauri::command]
pub async fn provider_model_prices(app: AppHandle) -> Result<ModelPrices, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(PRICES_FILE);
    tauri::async_runtime::spawn_blocking(move || model_prices(&cache, now_secs(), download_prices))
        .await
        .map_err(|error| error.to_string())?
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn model_prices(
    cache: &Path,
    now: u64,
    download: fn() -> Result<Vec<ModelPrice>, String>,
) -> Result<ModelPrices, String> {
    let cached = std::fs::read(cache)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ModelPrices>(&bytes).ok());
    if let Some(cached) = &cached {
        if now.saturating_sub(cached.fetched_at) < PRICES_MAX_AGE_SECS {
            return Ok(cached.clone());
        }
    }
    match download() {
        Ok(models) => {
            let prices = ModelPrices {
                models,
                fetched_at: now,
            };
            if let Some(dir) = cache.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(bytes) = serde_json::to_vec(&prices) {
                let _ = std::fs::write(cache, bytes);
            }
            Ok(prices)
        }
        Err(error) => cached.ok_or(error),
    }
}

fn download_prices() -> Result<Vec<ModelPrice>, String> {
    let agent = ureq::AgentBuilder::new().timeout(PRICES_TIMEOUT).build();
    let response = agent
        .get(OPENROUTER_MODELS_URL)
        .call()
        .map_err(|error| format!("Could not download model prices: {error}"))?;
    let body: Value = serde_json::from_reader(response.into_reader())
        .map_err(|error| format!("Model prices were not JSON: {error}"))?;
    let models = parse_openrouter_prices(&body);
    if models.is_empty() {
        return Err("Model price list was empty".into());
    }
    Ok(models)
}

/// Keeps Anthropic and OpenAI models with a usable price. OpenRouter sends
/// prices as decimal strings; "-1" and missing values mean unknown.
fn parse_openrouter_prices(body: &Value) -> Vec<ModelPrice> {
    let price = |pricing: &Value, key: &str| -> Option<f64> {
        let value = match pricing.get(key)? {
            Value::String(text) => text.parse::<f64>().ok()?,
            Value::Number(number) => number.as_f64()?,
            _ => return None,
        };
        (value >= 0.0 && value.is_finite()).then_some(value)
    };
    body.get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("id")?.as_str()?;
            // Variants such as `:free` or `:thinking` are not what the CLIs bill.
            let wanted =
                (id.starts_with("anthropic/") || id.starts_with("openai/")) && !id.contains(':');
            if !wanted {
                return None;
            }
            let pricing = model.get("pricing")?;
            Some(ModelPrice {
                id: id.to_string(),
                input: price(pricing, "prompt")?,
                output: price(pricing, "completion")?,
                cache_read: price(pricing, "input_cache_read"),
                cache_write: price(pricing, "input_cache_write"),
                cache_write_1h: price(pricing, "input_cache_write_1h"),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let path = dir.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("bycoda-usage-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_utc_and_offset_timestamps() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_timestamp("2026-09-29T06:38:45.123Z"),
            Some(1_790_663_925)
        );
        assert_eq!(
            parse_timestamp("2026-09-29T12:08:45+05:30"),
            Some(1_790_663_925)
        );
        assert_eq!(parse_timestamp("2024-02-29T00:00:00Z"), Some(1_709_164_800));
        assert_eq!(parse_timestamp("not a time"), None);
        assert_eq!(parse_timestamp("2026-13-01T00:00:00Z"), None);
    }

    #[test]
    fn claude_counts_each_request_once_and_splits_cache_writes() {
        let dir = temp_dir("claude");
        let usage = r#""usage":{"input_tokens":2,"cache_creation_input_tokens":300,"cache_read_input_tokens":4000,"output_tokens":50,"cache_creation":{"ephemeral_5m_input_tokens":100,"ephemeral_1h_input_tokens":200}}"#;
        let block = |ts: &str| {
            format!(
                r#"{{"type":"assistant","timestamp":"{ts}","cwd":"/work/app","requestId":"req_1","message":{{"id":"msg_1","model":"claude-opus-5-5",{usage}}}}}"#
            )
        };
        let first = block("2026-09-29T06:01:00Z");
        let second = block("2026-09-29T06:01:01Z");
        let synthetic = r#"{"type":"assistant","timestamp":"2026-09-29T06:02:00Z","message":{"id":"x","model":"<synthetic>","usage":{"input_tokens":9,"output_tokens":9}}}"#;
        let old = r#"{"type":"assistant","timestamp":"2020-01-01T00:00:00Z","requestId":"r0","message":{"id":"m0","model":"claude-opus-5-5","usage":{"input_tokens":9,"output_tokens":9}}}"#;
        write(
            &dir,
            "p/session.jsonl",
            &[&first, &second, synthetic, old, "{broken"],
        );
        // A resumed session repeats the same request in a second transcript.
        write(&dir, "p/resumed/subagents/agent.jsonl", &[&first]);

        let report = scan(
            std::slice::from_ref(&dir),
            parse_timestamp("2026-09-01T00:00:00Z").unwrap(),
            Provider::Claude,
            None,
        );
        assert!(report.found);
        assert_eq!(report.files_scanned, 2);
        assert_eq!(
            report.rows,
            vec![UsageRow {
                slot: parse_timestamp("2026-09-29T06:00:00Z").unwrap(),
                model: "claude-opus-5-5".into(),
                project: "/work/app".into(),
                input: 2,
                cache_read: 4000,
                cache_write_5m: 100,
                cache_write_1h: 200,
                output: 50,
            }]
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn codex_uses_per_response_usage_and_skips_repeats() {
        let dir = temp_dir("codex");
        let count = |ts: &str, total: u64, input: u64| {
            format!(
                r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"total_tokens":{total}}},"last_token_usage":{{"input_tokens":{input},"cached_input_tokens":800,"output_tokens":40,"total_tokens":{}}}}}}}}}"#,
                input + 40
            )
        };
        write(
            &dir,
            "2026/09/29/rollout-a.jsonl",
            &[
                r#"{"timestamp":"2026-09-29T06:00:00Z","type":"session_meta","payload":{"cwd":"/work/api"}}"#,
                r#"{"timestamp":"2026-09-29T06:00:01Z","type":"turn_context","payload":{"cwd":"/work/api","model":"gpt-5.5-codex"}}"#,
                r#"{"timestamp":"2026-09-29T06:00:02Z","type":"event_msg","payload":{"type":"token_count","info":null}}"#,
                &count("2026-09-29T06:00:03Z", 1040, 1000),
                &count("2026-09-29T06:00:04Z", 1040, 1000),
                &count("2026-09-29T06:20:00Z", 2080, 1000),
            ],
        );

        let report = scan(std::slice::from_ref(&dir), 0, Provider::Codex, None);
        let rows: Vec<(i64, u64, u64, u64)> = report
            .rows
            .iter()
            .map(|row| (row.slot, row.input, row.cache_read, row.output))
            .collect();
        let six = parse_timestamp("2026-09-29T06:00:00Z").unwrap();
        assert_eq!(rows, vec![(six, 200, 800, 40), (six + 900, 200, 800, 40)]);
        assert!(report
            .rows
            .iter()
            .all(|row| row.model == "gpt-5.5-codex" && row.project == "/work/api"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn claude_keeps_the_final_snapshot_of_a_request() {
        let dir = temp_dir("claude-snapshot");
        let line = |ts: &str, output: u64| {
            format!(
                r#"{{"type":"assistant","timestamp":"{ts}","requestId":"req_1","message":{{"id":"msg_1","model":"claude-opus-5-5","usage":{{"input_tokens":5,"cache_read_input_tokens":100,"output_tokens":{output}}}}}}}"#
            )
        };
        write(
            &dir,
            "p/session.jsonl",
            &[
                &line("2026-09-29T06:01:00Z", 1),
                &line("2026-09-29T06:01:09Z", 420),
            ],
        );
        let report = scan(std::slice::from_ref(&dir), 0, Provider::Claude, None);
        let rows: Vec<(u64, u64, u64)> = report
            .rows
            .iter()
            .map(|row| (row.input, row.cache_read, row.output))
            .collect();
        assert_eq!(rows, vec![(5, 100, 420)]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn codex_reads_archived_and_compressed_sessions() {
        let dir = temp_dir("codex-archive");
        // Each session's response lands at its own moment.
        let session = |model: &str, second: u32| {
            [
                format!(
                    r#"{{"timestamp":"2026-09-29T06:00:00Z","type":"turn_context","payload":{{"cwd":"/work/api","model":"{model}"}}}}"#
                ),
                format!(
                    r#"{{"timestamp":"2026-09-29T06:00:{second:02}Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"total_tokens":110}},"last_token_usage":{{"input_tokens":100,"output_tokens":10}}}}}}}}"#
                ),
            ]
            .join("\n")
        };
        let sessions = dir.join("sessions");
        let archived = dir.join("archived_sessions");
        write(
            &sessions,
            "2026/09/29/rollout-live.jsonl",
            &[&session("gpt-live", 1)],
        );
        write(
            &archived,
            "rollout-archived.jsonl",
            &[&session("gpt-archived", 2)],
        );
        std::fs::write(
            archived.join("rollout-packed.jsonl.zst"),
            ruzstd::encoding::compress_to_vec(
                session("gpt-packed", 3).as_bytes(),
                ruzstd::encoding::CompressionLevel::Fastest,
            ),
        )
        .unwrap();
        // Caught mid-move: the same rollout under both roots counts once.
        write(
            &sessions,
            "2026/09/29/rollout-moved.jsonl",
            &[&session("gpt-moved", 4)],
        );
        write(
            &archived,
            "rollout-moved.jsonl",
            &[&session("gpt-moved", 4)],
        );

        let report = scan(&[sessions, archived], 0, Provider::Codex, None);
        let mut models: Vec<(&str, u64)> = report
            .rows
            .iter()
            .map(|row| (row.model.as_str(), row.input))
            .collect();
        models.sort();
        assert_eq!(
            models,
            vec![
                ("gpt-archived", 100),
                ("gpt-live", 100),
                ("gpt-moved", 100),
                ("gpt-packed", 100),
            ]
        );
        assert_eq!(report.files_scanned, 4);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn codex_counts_a_replayed_response_once() {
        let dir = temp_dir("codex-replay");
        let meta = r#"{"timestamp":"2026-09-29T06:00:00Z","type":"turn_context","payload":{"cwd":"/work/api","model":"gpt-5.5"}}"#;
        let response = |ts: &str, total: u64| {
            format!(
                r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"total_tokens":{total}}},"last_token_usage":{{"input_tokens":100,"output_tokens":10}}}}}}}}"#
            )
        };
        let first = response("2026-09-29T06:00:01Z", 110);
        write(&dir, "2026/09/29/rollout-a.jsonl", &[meta, &first]);
        // A resumed session copies the earlier response, then adds its own.
        write(
            &dir,
            "2026/09/29/rollout-b.jsonl",
            &[meta, &first, &response("2026-09-29T06:05:00Z", 220)],
        );
        let report = scan(std::slice::from_ref(&dir), 0, Provider::Codex, None);
        let input: u64 = report.rows.iter().map(|row| row.input).sum();
        assert_eq!(input, 200);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reads_every_frame_of_a_compressed_log() {
        let dir = temp_dir("zstd-frames");
        let compress = |text: &str| {
            ruzstd::encoding::compress_to_vec(
                text.as_bytes(),
                ruzstd::encoding::CompressionLevel::Fastest,
            )
        };
        let mut bytes = compress("one\ntwo\n");
        bytes.extend(compress("three\n"));
        let path = dir.join("log.jsonl.zst");
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(lines(&path).collect::<Vec<_>>(), ["one", "two", "three"]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn missing_log_directory_is_not_found() {
        let report = scan(
            &[PathBuf::from("/definitely/not/here")],
            0,
            Provider::Codex,
            None,
        );
        assert!(!report.found);
        assert!(report.rows.is_empty());
    }

    #[test]
    fn keeps_priced_anthropic_and_openai_models() {
        let body = serde_json::json!({"data": [
            {"id": "anthropic/claude-opus-5.5", "pricing": {"prompt": "0.000004", "completion": "0.00002", "input_cache_read": "0.0000002", "input_cache_write": "0.000005"}},
            {"id": "openai/gpt-5.5", "pricing": {"prompt": "0.000005", "completion": "0.00003"}},
            {"id": "anthropic/claude-opus-5.5:thinking", "pricing": {"prompt": "1", "completion": "1"}},
            {"id": "google/gemini-3-pro", "pricing": {"prompt": "0.000002", "completion": "0.00001"}},
            {"id": "openai/auto", "pricing": {"prompt": "-1", "completion": "-1"}}
        ]});
        let models = parse_openrouter_prices(&body);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["anthropic/claude-opus-5.5", "openai/gpt-5.5"]
        );
        assert_eq!(models[0].cache_write, Some(0.000005));
        assert_eq!(models[0].cache_write_1h, None);
        assert_eq!(models[1].cache_read, None);
    }

    #[test]
    fn prices_come_from_cache_until_stale_then_fall_back_to_it() {
        let dir = temp_dir("prices");
        let cache = dir.join("nested").join(PRICES_FILE);
        let price = |id: &str| ModelPrice {
            id: id.into(),
            input: 1.0,
            output: 2.0,
            cache_read: None,
            cache_write: None,
            cache_write_1h: None,
        };
        fn fresh() -> Result<Vec<ModelPrice>, String> {
            Ok(vec![ModelPrice {
                id: "openai/fresh".into(),
                input: 1.0,
                output: 2.0,
                cache_read: None,
                cache_write: None,
                cache_write_1h: None,
            }])
        }
        fn offline() -> Result<Vec<ModelPrice>, String> {
            Err("offline".into())
        }

        assert_eq!(model_prices(&cache, 1_000, offline).unwrap_err(), "offline");
        let first = model_prices(&cache, 1_000, fresh).unwrap();
        assert_eq!(
            (first.models[0].id.as_str(), first.fetched_at),
            ("openai/fresh", 1_000)
        );

        std::fs::write(
            &cache,
            serde_json::to_vec(&ModelPrices {
                models: vec![price("openai/cached")],
                fetched_at: 1_000,
            })
            .unwrap(),
        )
        .unwrap();
        // Within a day the cached copy is used without downloading.
        assert_eq!(
            model_prices(&cache, 2_000, fresh).unwrap().models[0].id,
            "openai/cached"
        );
        // Once stale, a failed download still returns the old copy.
        let stale = 1_000 + PRICES_MAX_AGE_SECS;
        assert_eq!(
            model_prices(&cache, stale, offline).unwrap().models[0].id,
            "openai/cached"
        );
        assert_eq!(
            model_prices(&cache, stale, fresh).unwrap().models[0].id,
            "openai/fresh"
        );
        std::fs::remove_dir_all(dir).ok();
    }

    fn claude_line(ts: &str, project: &str, request: &str, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","cwd":"{project}","requestId":"{request}","message":{{"id":"m_{request}","model":"claude-opus-5-5","usage":{{"input_tokens":1,"output_tokens":{output}}}}}}}"#
        )
    }

    fn total_output(report: &UsageReport) -> u64 {
        report.rows.iter().map(|row| row.output).sum()
    }

    #[test]
    fn fnv_hash_is_stable_across_runs() {
        assert_eq!(fnv1a(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a("a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn cached_scan_matches_an_uncached_one_and_skips_unchanged_files() {
        let dir = temp_dir("cache-hit");
        let cache = dir.join("cache/usage.json");
        let logs = dir.join("logs");
        let first = claude_line("2026-09-29T06:01:00Z", "/work/app", "r1", 10);
        let second = claude_line("2026-09-29T07:01:00Z", "/work/site", "r2", 20);
        write(&logs, "p/a.jsonl", &[&first, &second]);
        // A resumed transcript repeats r1; it still counts once.
        write(&logs, "p/b.jsonl", &[&first]);

        let roots = [logs.clone()];
        let plain = scan(&roots, 0, Provider::Claude, None);
        let cold = scan(&roots, 0, Provider::Claude, Some(&cache));
        let warm = scan(&roots, 0, Provider::Claude, Some(&cache));
        assert_eq!((plain.files_parsed, cold.files_parsed), (2, 2));
        assert_eq!(warm.files_parsed, 0);
        assert_eq!(total_output(&plain), 30);
        assert_eq!(plain.rows, cold.rows);
        assert_eq!(plain.rows, warm.rows);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_changed_file_is_reparsed_and_others_are_not() {
        let dir = temp_dir("cache-change");
        let cache = dir.join("usage.json");
        let logs = dir.join("logs");
        let one = claude_line("2026-09-29T06:01:00Z", "/work/app", "r1", 10);
        let path = write(&logs, "p/a.jsonl", &[&one]);
        write(
            &logs,
            "p/b.jsonl",
            &[&claude_line("2026-09-29T06:05:00Z", "/work/app", "r2", 5)],
        );
        let roots = [logs.clone()];
        scan(&roots, 0, Provider::Claude, Some(&cache));

        // The session keeps running: the file grows.
        let more = claude_line("2026-09-29T06:09:00Z", "/work/app", "r3", 7);
        std::fs::write(&path, format!("{one}\n{more}")).unwrap();
        let report = scan(&roots, 0, Provider::Claude, Some(&cache));
        assert_eq!(report.files_parsed, 1);
        assert_eq!(total_output(&report), 22);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_longer_range_reuses_the_cache_and_keeps_older_files() {
        let dir = temp_dir("cache-range");
        let cache = dir.join("usage.json");
        let logs = dir.join("logs");
        let old = write(
            &logs,
            "p/old.jsonl",
            &[&claude_line("2026-01-01T00:00:00Z", "/work/app", "old", 3)],
        );
        write(
            &logs,
            "p/new.jsonl",
            &[&claude_line("2026-09-29T06:00:00Z", "/work/app", "new", 4)],
        );
        // Make the old transcript look old on disk so a short range skips it.
        let long_ago = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_767_225_600);
        std::fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();

        let roots = [logs.clone()];
        let since = parse_timestamp("2026-09-01T00:00:00Z").unwrap();
        let short = scan(&roots, since, Provider::Claude, Some(&cache));
        assert_eq!((short.files_scanned, total_output(&short)), (1, 4));
        let all = scan(&roots, 0, Provider::Claude, Some(&cache));
        // Only the older file is new to the cache.
        assert_eq!(all.files_parsed, 1);
        assert_eq!((all.files_scanned, total_output(&all)), (2, 7));
        let again = scan(&roots, since, Provider::Claude, Some(&cache));
        assert_eq!((again.files_parsed, total_output(&again)), (0, 4));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_damaged_or_outdated_cache_is_rebuilt() {
        let dir = temp_dir("cache-bad");
        let cache = dir.join("usage.json");
        let logs = dir.join("logs");
        write(
            &logs,
            "p/a.jsonl",
            &[&claude_line("2026-09-29T06:00:00Z", "/work/app", "r1", 4)],
        );
        let roots = [logs.clone()];
        std::fs::write(&cache, b"{not json").unwrap();
        assert_eq!(
            scan(&roots, 0, Provider::Claude, Some(&cache)).files_parsed,
            1
        );
        let outdated =
            std::fs::read_to_string(&cache)
                .unwrap()
                .replacen("\"version\":1", "\"version\":0", 1);
        std::fs::write(&cache, outdated).unwrap();
        let rebuilt = scan(&roots, 0, Provider::Claude, Some(&cache));
        assert_eq!((rebuilt.files_parsed, total_output(&rebuilt)), (1, 4));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn codex_cache_keeps_cross_file_dedupe() {
        let dir = temp_dir("cache-codex");
        let cache = dir.join("usage.json");
        let sessions = dir.join("sessions");
        let meta = r#"{"type":"session_meta","timestamp":"2026-09-29T06:00:00Z","payload":{"cwd":"/work/app"}}"#;
        let turn = r#"{"type":"turn_context","timestamp":"2026-09-29T06:00:01Z","payload":{"model":"gpt-5.5"}}"#;
        let count = r#"{"type":"event_msg","timestamp":"2026-09-29T06:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":150},"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":50}}}}"#;
        write(&sessions, "2026/09/29/a.jsonl", &[meta, turn, count]);
        write(&sessions, "2026/09/29/b.jsonl", &[meta, turn, count]);
        let roots = [sessions.clone()];
        let cold = scan(&roots, 0, Provider::Codex, Some(&cache));
        let warm = scan(&roots, 0, Provider::Codex, Some(&cache));
        assert_eq!(warm.files_parsed, 0);
        assert_eq!(cold.rows, warm.rows);
        assert_eq!(total_output(&warm), 50);
        assert_eq!(warm.rows[0].project, "/work/app");
        std::fs::remove_dir_all(dir).ok();
    }

    /// Dry run on this machine's real logs. Reads the transcripts, prints only
    /// aggregate numbers, and keeps its cache in a temp directory.
    /// `cargo test -p bycoda --lib -- --ignored --nocapture real_logs_dry_run`
    #[test]
    #[ignore = "reads the real ~/.claude and ~/.codex logs"]
    fn real_logs_dry_run() {
        let Some(home) = crate::dirs_home().map(PathBuf::from) else {
            return;
        };
        let cache_dir = temp_dir("dry-run");
        let runs: [(&str, Provider, Vec<PathBuf>); 2] = [
            (
                "claude",
                Provider::Claude,
                vec![home.join(".claude/projects")],
            ),
            (
                "codex",
                Provider::Codex,
                vec![
                    home.join(".codex/sessions"),
                    home.join(".codex/archived_sessions"),
                ],
            ),
        ];
        for (name, provider, roots) in runs {
            let cache = cache_dir.join(format!("{name}.json"));
            let started = std::time::Instant::now();
            let cold = scan(&roots, 0, provider, Some(&cache));
            let cold_time = started.elapsed();
            let started = std::time::Instant::now();
            let warm = scan(&roots, 0, provider, Some(&cache));
            let warm_time = started.elapsed();
            let days: HashSet<i64> = warm
                .rows
                .iter()
                .map(|r| r.slot.div_euclid(86_400))
                .collect();
            let projects: HashSet<&str> = warm.rows.iter().map(|r| r.project.as_str()).collect();
            let tokens: u64 = warm
                .rows
                .iter()
                .map(|r| r.input + r.cache_read + r.cache_write_5m + r.cache_write_1h + r.output)
                .sum();
            let size = std::fs::metadata(&cache).map(|m| m.len()).unwrap_or(0);
            println!(
                "{name}: files={} parsed_cold={} parsed_warm={} rows={} days={} projects={} tokens={} cold={:.2}s warm={:.2}s cache={:.1}MB same={}",
                warm.files_scanned,
                cold.files_parsed,
                warm.files_parsed,
                warm.rows.len(),
                days.len(),
                projects.len(),
                tokens,
                cold_time.as_secs_f64(),
                warm_time.as_secs_f64(),
                size as f64 / 1e6,
                cold.rows == warm.rows,
            );
        }
        std::fs::remove_dir_all(cache_dir).ok();
    }
}
