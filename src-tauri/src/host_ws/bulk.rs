//! Bounded authenticated HTTP transfer after a WS result reference. Never sends RPC.
use super::{permits::Lease, schema::Contracts, NativeRoute};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

pub(super) fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

static DOWNLOADS: AtomicUsize = AtomicUsize::new(0);
static DOWNLOAD_BYTES: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
pub(super) fn in_flight() -> (usize, usize) {
    (
        DOWNLOADS.load(Ordering::Acquire),
        DOWNLOAD_BYTES.load(Ordering::Acquire),
    )
}
struct DownloadPermit {
    bytes: usize,
}
impl Drop for DownloadPermit {
    fn drop(&mut self) {
        DOWNLOAD_BYTES.fetch_sub(self.bytes, Ordering::AcqRel);
        DOWNLOADS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) struct Resolved {
    value: Value,
    held: std::sync::Arc<Held>,
}
pub(super) struct Held {
    _budget: DownloadPermit,
    disclosure: Lease,
}
impl std::fmt::Debug for Held {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("NativeBulkDisclosure")
    }
}
impl Held {
    pub(super) fn commit_grant(&self) -> std::sync::Arc<super::permits::Grant> {
        self.disclosure.grant()
    }
    pub fn check(&self) -> Result<(), &'static str> {
        self.disclosure.disclose(())
    }
}
impl Resolved {
    pub fn disclose(self) -> Result<Value, &'static str> {
        self.held.check()?;
        Ok(self.value)
    }
    pub fn parts(self) -> Result<(Value, std::sync::Arc<Held>), &'static str> {
        self.held.check()?;
        Ok((self.value, self.held))
    }
}

pub(super) fn reference<'a>(
    contracts: &Contracts,
    result: &'a Value,
) -> Result<Option<&'a Value>, ()> {
    if result.get("$bulk").is_none() {
        return Ok(None);
    }
    let Some(validator) = contracts.bulk_result.as_ref() else {
        return Err(());
    };
    if !validator.is_valid(result) {
        return Err(());
    }
    Ok(Some(&result["$bulk"]))
}

pub(super) fn resolve(
    route: &NativeRoute,
    descriptor: &Value,
    deadline: Instant,
    cancelled: &AtomicBool,
    disclosure: Lease,
) -> Result<Resolved, &'static str> {
    if !disclosure.live() {
        return Err("retired");
    }
    if descriptor["environmentId"].as_str() != Some(route.environment_id.as_str()) {
        return Err("identity");
    }
    let transfer_id = descriptor["transferId"].as_str().ok_or("schema")?;
    let total = descriptor["totalBytes"].as_u64().ok_or("schema")?;
    let chunk = descriptor["chunkBytes"].as_u64().ok_or("schema")?;
    let expires = descriptor["expiresAt"].as_u64().ok_or("schema")?;
    let expected_hash = descriptor["sha256"].as_str().ok_or("schema")?;
    if total == 0 || total > 32 * 1024 * 1024 || chunk == 0 || chunk > 65_536 || expires <= millis()
    {
        return Err("schema");
    }
    if !super::reserve(&DOWNLOADS, 1, 2) {
        return Err("overload");
    }
    let mut budget = DownloadPermit { bytes: 0 };
    if !super::reserve(&DOWNLOAD_BYTES, total as usize, 64 * 1024 * 1024) {
        return Err("overload");
    }
    budget.bytes = total as usize;
    let mut endpoint = Url::parse(&route.endpoint).map_err(|_| "identity")?;
    let secure = endpoint.scheme() == "wss";
    endpoint
        .set_scheme(if secure { "https" } else { "http" })
        .map_err(|_| "identity")?;
    endpoint.set_path("/ws-bulk/");
    endpoint
        .path_segments_mut()
        .map_err(|_| "identity")?
        .pop_if_empty()
        .push(transfer_id);
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    let agent = AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .redirects(0)
            .max_idle_connections(4)
            .max_idle_connections_per_host(2)
            .timeout_connect(Duration::from_secs(5))
            .build()
    });
    let mut output = Vec::with_capacity(total as usize);
    while output.len() < total as usize {
        if cancelled.load(Ordering::Acquire) || !disclosure.live() {
            return Err("cancelled");
        }
        if Instant::now() >= deadline || expires <= millis() {
            return Err("deadline");
        }
        endpoint.set_query(Some(&format!("offset={}", output.len())));
        let remaining = deadline.saturating_duration_since(Instant::now());
        let response = agent
            .get(endpoint.as_str())
            .set("Authorization", &format!("Bearer {}", route.token.as_str()))
            .set("Accept-Encoding", "identity")
            .timeout(remaining.min(Duration::from_secs(12)))
            .call()
            .map_err(|_| "unavailable")?;
        let expected = (total as usize - output.len()).min(chunk as usize);
        if response.status() != 200
            || response.header("Content-Type") != Some("application/octet-stream")
            || response
                .header("Content-Length")
                .and_then(|value| value.parse::<usize>().ok())
                != Some(expected)
        {
            return Err("schema");
        }
        let mut buffer = Vec::with_capacity(expected + 1);
        response
            .into_reader()
            .take(expected as u64 + 1)
            .read_to_end(&mut buffer)
            .map_err(|_| "unavailable")?;
        if buffer.len() != expected {
            return Err("schema");
        }
        output.extend_from_slice(&buffer);
    }
    if cancelled.load(Ordering::Acquire) || !disclosure.live() {
        return Err("cancelled");
    }
    if Instant::now() >= deadline || expires <= millis() {
        return Err("deadline");
    }
    if format!("{:x}", Sha256::digest(&output)) != expected_hash {
        return Err("schema");
    }
    let value = serde_json::from_slice(&output).map_err(|_| "schema")?;
    Ok(Resolved {
        value,
        held: std::sync::Arc::new(Held {
            _budget: budget,
            disclosure,
        }),
    })
}
