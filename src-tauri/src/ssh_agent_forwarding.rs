//! Explicit, short-lived authorization for one final interactive SSH session.
//! No saved approval, private key material, alternate transport or config writes.
use crate::ssh_security::{self, SshEndpoint};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const REVIEW_TTL: Duration = Duration::from_secs(30);
const MAX_TICKETS: usize = 64;
const MAX_PER_OWNER: usize = 8;
const MAX_OWNERS: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentForwardingSummary {
    pub configuration: Option<crate::ssh_security::RuntimeConfiguration>,
    pub host: String,
    pub user: Option<String>,
    pub port: u16,
    pub jump_hosts: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentForwardingReview {
    pub review_id: String,
    /// Canonical endpoint configuration binding, not a host-key fingerprint.
    pub endpoint_fingerprint: String,
    pub expires_at: u64,
    pub agent_available: bool,
    pub summary: AgentForwardingSummary,
}
struct Ticket {
    owner: String,
    connection_id: Option<String>,
    fingerprint: String,
    expires: Instant,
}
#[derive(Default)]
struct Reviews {
    tickets: HashMap<String, Ticket>,
    owners: HashMap<String, Arc<AtomicBool>>,
    pending: HashMap<usize, usize>,
}
#[derive(Default)]
pub struct AgentForwardingReviews {
    state: Mutex<Reviews>,
}
struct PendingReview<'a> {
    store: &'a AgentForwardingReviews,
    key: usize,
}
impl Drop for PendingReview<'_> {
    fn drop(&mut self) {
        let mut state = self
            .store
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(count) = state.pending.get_mut(&self.key) {
            *count -= 1;
            if *count == 0 {
                state.pending.remove(&self.key);
            }
        }
    }
}

fn validate_scope(
    owner: &str,
    connection_id: Option<&str>,
    endpoint: &SshEndpoint,
) -> Result<(), String> {
    if owner.is_empty()
        || owner.len() > 200
        || owner.chars().any(char::is_control)
        || connection_id
            .is_some_and(|id| id.is_empty() || id.len() > 200 || id.chars().any(char::is_control))
    {
        return Err("Invalid native window or SSH target".into());
    }
    ssh_security::validate_endpoint(endpoint)?;
    // ProxyJump child policy is independent of the destination's command-line
    // options. Do not imply that enabling a final session authorizes its hops.
    if endpoint.jump_host.is_some()
        || !endpoint.jump_hosts.is_empty()
        || !endpoint.jump_policies.is_empty()
    {
        return Err(
            "Agent forwarding through jump hosts is not supported by this reviewed policy".into(),
        );
    }
    Ok(())
}
fn fingerprint(endpoint: &SshEndpoint) -> Result<String, String> {
    let encoded = serde_json::to_vec(&(
        endpoint,
        endpoint
            .runtime_configuration
            .as_ref()
            .map(|configuration| &configuration.digest),
    ))
    .map_err(|_| "Cannot bind SSH target")?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}
fn agent_available() -> bool {
    // Existing timeout/output bounds and read-only public metadata probe. No
    // service startup, key loading or authentication success is inferred here.
    ssh_security::ssh_agent_identities().status == "available"
}

impl AgentForwardingReviews {
    pub fn review(
        &self,
        owner: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
    ) -> Result<AgentForwardingReview, String> {
        self.review_with_probe(owner, connection_id, endpoint, agent_available)
    }
    fn review_with_probe(
        &self,
        owner: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        probe: impl FnOnce() -> bool,
    ) -> Result<AgentForwardingReview, String> {
        validate_scope(owner, connection_id, endpoint)?;
        let alive = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Agent review store unavailable")?;
            if !state.owners.contains_key(owner) && state.owners.len() >= MAX_OWNERS {
                return Err("Too many native agent review owners".into());
            }
            let alive = state
                .owners
                .entry(owner.into())
                .or_insert_with(|| Arc::new(AtomicBool::new(true)))
                .clone();
            state
                .tickets
                .retain(|_, ticket| ticket.expires > Instant::now());
            let key = Arc::as_ptr(&alive) as usize;
            if state.tickets.len() + state.pending.values().sum::<usize>() >= MAX_TICKETS
                || state
                    .tickets
                    .values()
                    .filter(|ticket| ticket.owner == owner)
                    .count()
                    + state.pending.get(&key).copied().unwrap_or(0)
                    >= MAX_PER_OWNER
            {
                return Err("Too many pending agent forwarding reviews".into());
            }
            *state.pending.entry(key).or_default() += 1;
            alive
        };
        let pending = PendingReview {
            store: self,
            key: Arc::as_ptr(&alive) as usize,
        };
        if !probe() {
            return Err(
                "No available SSH agent identities; enable or unlock your agent separately".into(),
            );
        }
        let now = Instant::now();
        let digest = fingerprint(endpoint)?;
        drop(pending);
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Agent review store unavailable")?;
        if !alive.load(Ordering::SeqCst)
            || !state
                .owners
                .get(owner)
                .is_some_and(|current| Arc::ptr_eq(current, &alive))
        {
            return Err("Native review window closed".into());
        }
        state.tickets.retain(|_, ticket| ticket.expires > now);
        if state.tickets.len() >= MAX_TICKETS
            || state
                .tickets
                .values()
                .filter(|ticket| ticket.owner == owner)
                .count()
                >= MAX_PER_OWNER
        {
            return Err("Too many pending agent forwarding reviews".into());
        }
        let review_id = uuid::Uuid::new_v4().to_string();
        let wall_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "System clock unavailable")?
            .as_millis();
        let expires_at = u64::try_from(wall_time + REVIEW_TTL.as_millis())
            .map_err(|_| "System clock out of range")?;
        state.tickets.insert(
            review_id.clone(),
            Ticket {
                owner: owner.into(),
                connection_id: connection_id.map(str::to_owned),
                fingerprint: digest.clone(),
                expires: now + REVIEW_TTL,
            },
        );
        Ok(AgentForwardingReview {
            review_id,
            endpoint_fingerprint: digest,
            expires_at,
            agent_available: true,
            summary: AgentForwardingSummary {
                configuration: endpoint.runtime_configuration.as_deref().cloned(),
                host: endpoint.host.clone(),
                user: endpoint.user.clone(),
                port: endpoint.port,
                jump_hosts: vec![],
            },
        })
    }

    pub fn consume(
        &self,
        owner: &str,
        review_id: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
    ) -> Result<AgentForwardingGrant, String> {
        self.consume_with_probe(owner, review_id, connection_id, endpoint, agent_available)
    }
    fn consume_with_probe(
        &self,
        owner: &str,
        review_id: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        probe: impl FnOnce() -> bool,
    ) -> Result<AgentForwardingGrant, String> {
        let (ticket, alive) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Agent review store unavailable")?;
            let ticket = state
                .tickets
                .get(review_id)
                .ok_or("Agent forwarding review expired or already used")?;
            if ticket.owner != owner {
                return Err("Agent forwarding review belongs to another native window".into());
            }
            let alive = state
                .owners
                .get(owner)
                .cloned()
                .ok_or("Native review window closed")?;
            // Consume before validating/spawning. Every failed attempt requires
            // a new explicit review; another window cannot consume this ticket.
            (state.tickets.remove(review_id).unwrap(), alive)
        };
        validate_scope(owner, connection_id, endpoint)?;
        if !alive.load(Ordering::SeqCst)
            || ticket.expires <= Instant::now()
            || ticket.connection_id.as_deref() != connection_id
            || ticket.fingerprint != fingerprint(endpoint)?
        {
            return Err("SSH target changed or forwarding review expired".into());
        }
        if !probe() {
            return Err("SSH agent is no longer available; review again after unlocking it".into());
        }
        if !alive.load(Ordering::SeqCst) || ticket.expires <= Instant::now() {
            return Err("Native review window closed or approval expired".into());
        }
        Ok(AgentForwardingGrant {
            fingerprint: ticket.fingerprint,
            alive,
            expires: ticket.expires,
        })
    }
    pub fn kill_window(&self, owner: &str) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(alive) = state.owners.remove(owner) {
            alive.store(false, Ordering::SeqCst);
        }
        state.tickets.retain(|_, ticket| ticket.owner != owner);
    }
    pub fn kill_all(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        for alive in state.owners.values() {
            alive.store(false, Ordering::SeqCst);
        }
        state.owners.clear();
        state.tickets.clear();
    }
}
impl Drop for AgentForwardingReviews {
    fn drop(&mut self) {
        self.kill_all();
    }
}

/// Non-cloneable, non-deserializable capability consumed by argument creation.
pub struct AgentForwardingGrant {
    fingerprint: String,
    alive: Arc<AtomicBool>,
    expires: Instant,
}
impl AgentForwardingGrant {
    pub fn interactive_args(self, endpoint: &SshEndpoint) -> Result<Vec<String>, String> {
        validate_scope("reviewed-launch", None, endpoint)?;
        if !self.alive.load(Ordering::SeqCst)
            || self.expires <= Instant::now()
            || self.fingerprint != fingerprint(endpoint)?
        {
            return Err("Agent forwarding grant no longer matches this launch".into());
        }
        let mut args = ssh_security::interactive_args(endpoint)?;
        let policy = args
            .iter_mut()
            .find(|arg| arg.as_str() == "ForwardAgent=no")
            .ok_or("Shared SSH agent policy unavailable")?;
        *policy = "ForwardAgent=yes".into();
        Ok(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn endpoint() -> SshEndpoint {
        SshEndpoint {
            host: "server.test".into(),
            user: Some("alice".into()),
            port: 22,
            ..Default::default()
        }
    }
    fn review(store: &AgentForwardingReviews) -> AgentForwardingReview {
        store
            .review_with_probe("owner", Some("canonical-record"), &endpoint(), || true)
            .unwrap()
    }
    #[test]
    fn approval_is_owner_target_bound_single_use_and_final_interactive_only() {
        let store = AgentForwardingReviews::default();
        let ticket = review(&store);
        assert!(store
            .consume_with_probe(
                "other-window",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true
            )
            .is_err());
        let grant = store
            .consume_with_probe(
                "owner",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true,
            )
            .unwrap();
        assert!(store
            .consume_with_probe(
                "owner",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true
            )
            .is_err());
        let args = grant.interactive_args(&endpoint()).unwrap();
        assert!(args.contains(&"ForwardAgent=yes".into()));
        assert!(ssh_security::connection_args(&endpoint())
            .unwrap()
            .contains(&"ForwardAgent=no".into()));
        assert!(ssh_security::interactive_args(&endpoint())
            .unwrap()
            .contains(&"ForwardAgent=no".into()));
        let encoded = serde_json::to_string(&ticket).unwrap();
        assert!(!encoded.contains("identityFile"));
        assert!(!encoded.contains("certificateFile"));
    }
    #[test]
    fn changed_record_credentials_scope_or_expiry_consumes_without_grant() {
        let store = AgentForwardingReviews::default();
        for mode in 0..5 {
            let ticket = review(&store);
            let mut changed = endpoint();
            let scope = if mode == 0 {
                Some("another-record")
            } else {
                Some("canonical-record")
            };
            if mode == 1 {
                changed.user = Some("bob".into());
            }
            if mode == 2 {
                changed.identity_file = Some("/different/key-reference".into());
            }
            if mode == 3 {
                changed.certificate_file = Some("/different/public-cert".into());
            }
            if mode == 4 {
                store
                    .state
                    .lock()
                    .unwrap()
                    .tickets
                    .get_mut(&ticket.review_id)
                    .unwrap()
                    .expires = Instant::now() - Duration::from_secs(1);
            }
            assert!(store
                .consume_with_probe("owner", &ticket.review_id, scope, &changed, || true)
                .is_err());
            assert!(!store
                .state
                .lock()
                .unwrap()
                .tickets
                .contains_key(&ticket.review_id));
        }
    }
    #[test]
    fn absent_agent_and_jump_hops_fail_closed_without_ticket_or_shared_policy_changes() {
        let store = AgentForwardingReviews::default();
        assert!(store
            .review_with_probe("owner", None, &endpoint(), || false)
            .is_err());
        let mut jump = endpoint();
        jump.jump_hosts = vec!["bastion.test".into()];
        assert!(store
            .review_with_probe("owner", None, &jump, || panic!("must reject before probe"))
            .is_err());
        jump.jump_hosts.clear();
        jump.jump_host = Some("legacy.test".into());
        assert!(store
            .review_with_probe("owner", None, &jump, || true)
            .is_err());
        assert!(store.state.lock().unwrap().tickets.is_empty());
        let ticket = review(&store);
        assert!(store
            .consume_with_probe(
                "owner",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || false
            )
            .is_err());
        assert!(store.state.lock().unwrap().tickets.is_empty());
    }
    #[test]
    fn closed_window_invalidates_pending_review_and_grant_but_reopen_is_fresh() {
        let store = AgentForwardingReviews::default();
        let ticket = review(&store);
        let grant = store
            .consume_with_probe(
                "owner",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true,
            )
            .unwrap();
        store.kill_window("owner");
        assert!(grant.interactive_args(&endpoint()).is_err());
        assert!(store
            .review_with_probe("owner", None, &endpoint(), || {
                store.kill_window("owner");
                true
            })
            .is_err());
        let fresh = review(&store);
        assert!(store
            .consume_with_probe(
                "owner",
                &fresh.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true
            )
            .is_ok());
    }
    #[test]
    fn ticket_counts_are_bounded_and_expired_capacity_is_reclaimed() {
        let store = AgentForwardingReviews::default();
        for _ in 0..MAX_PER_OWNER {
            review(&store);
        }
        assert!(store
            .review_with_probe("owner", None, &endpoint(), || true)
            .is_err());
        {
            let mut state = store.state.lock().unwrap();
            for ticket in state.tickets.values_mut() {
                ticket.expires = Instant::now() - Duration::from_secs(1);
            }
        }
        assert!(store
            .review_with_probe("owner", None, &endpoint(), || true)
            .is_ok());
        store.kill_window("owner");
        for index in 0..MAX_TICKETS {
            store
                .review_with_probe(&format!("owner-{index}"), None, &endpoint(), || true)
                .unwrap();
        }
        assert!(store
            .review_with_probe("owner-0", None, &endpoint(), || true)
            .is_err());
        assert!(store
            .review_with_probe("new-owner", None, &endpoint(), || true)
            .is_err());
    }
    #[test]
    fn concurrent_probe_reservations_are_bounded_before_starting_more_processes() {
        let store = AgentForwardingReviews::default();
        store
            .review_with_probe("owner", None, &endpoint(), || {
                for _ in 0..MAX_PER_OWNER - 1 {
                    review(&store);
                }
                assert!(store
                    .review_with_probe("owner", None, &endpoint(), || panic!(
                        "capacity must be checked before probe"
                    ))
                    .is_err());
                true
            })
            .unwrap();
        assert_eq!(store.state.lock().unwrap().tickets.len(), MAX_PER_OWNER);
        assert!(store.state.lock().unwrap().pending.is_empty());
    }
    #[test]
    fn grant_rechecks_endpoint_and_shutdown_before_argument_creation() {
        let store = AgentForwardingReviews::default();
        let ticket = review(&store);
        let grant = store
            .consume_with_probe(
                "owner",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true,
            )
            .unwrap();
        let mut changed = endpoint();
        changed.port = 2222;
        assert!(grant.interactive_args(&changed).is_err());
        let ticket = review(&store);
        let grant = store
            .consume_with_probe(
                "owner",
                &ticket.review_id,
                Some("canonical-record"),
                &endpoint(),
                || true,
            )
            .unwrap();
        store.kill_all();
        assert!(grant.interactive_args(&endpoint()).is_err());
    }
}
