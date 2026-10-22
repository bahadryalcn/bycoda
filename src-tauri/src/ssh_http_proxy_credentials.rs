//! One-use, operation-bound HTTP Basic credentials. No persistence or endpoint fields.
use crate::{ssh_http_proxy::BasicCredentials, ssh_security::SshEndpoint};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};

const TTL: Duration = Duration::from_secs(30);
const RUNBOOK_TTL: Duration = Duration::from_secs(120);
const MAX_TICKETS: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ProxyOperation {
    Runbook {
        run_id: String,
        automation_id: String,
        revision: u64,
        review_digest: String,
        server_id: String,
    },
    Terminal {
        id: String,
        shell_integration: Option<String>,
    },
    Forward {
        id: String,
        forward_kind: String,
        local_port: u16,
        target_host: String,
        target_port: u16,
    },
    SftpList {
        operation_id: String,
        path: String,
    },
    SftpDownload {
        operation_id: String,
        remote_path: String,
        local_path: String,
    },
    SftpUpload {
        operation_id: String,
        local_path: String,
        remote_path: String,
        overwrite_confirmed: bool,
    },
    SftpResume {
        operation_id: String,
        recovery_id: String,
        overwrite_confirmed: bool,
    },
    SftpDiscard {
        operation_id: String,
        recovery_id: String,
    },
}
fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_:/.".contains(&byte))
}
impl ProxyOperation {
    fn is_runbook(&self) -> bool {
        matches!(self, Self::Runbook { .. })
    }
    fn validate(&self) -> Result<(), String> {
        let valid = match self {
            Self::Runbook {
                run_id,
                automation_id,
                revision,
                review_digest,
                server_id,
            } => {
                [run_id, automation_id, server_id]
                    .into_iter()
                    .all(|id| valid_id(id))
                    && *revision > 0
                    && *revision <= i64::MAX as u64
                    && review_digest.len() == 64
                    && review_digest
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            }
            Self::Terminal {
                id,
                shell_integration,
            } => {
                valid_text(id, 200)
                    && shell_integration
                        .as_deref()
                        .is_none_or(|mode| matches!(mode, "bash" | "zsh" | "powershell"))
            }
            Self::Forward {
                id,
                forward_kind,
                local_port,
                target_host,
                target_port,
            } => {
                valid_text(id, 200)
                    && matches!(forward_kind.as_str(), "local" | "remote" | "dynamic")
                    && *local_port > 0
                    && (forward_kind == "dynamic"
                        || (*target_port > 0 && valid_text(target_host, 253)))
            }
            Self::SftpList { operation_id, path } => {
                valid_text(operation_id, 200) && valid_text(path, 4096)
            }
            Self::SftpDownload {
                operation_id,
                remote_path,
                local_path,
            }
            | Self::SftpUpload {
                operation_id,
                remote_path,
                local_path,
                ..
            } => {
                valid_text(operation_id, 200)
                    && valid_text(remote_path, 4096)
                    && valid_text(local_path, 4096)
            }
            Self::SftpResume {
                operation_id,
                recovery_id,
                ..
            }
            | Self::SftpDiscard {
                operation_id,
                recovery_id,
            } => valid_text(operation_id, 200) && valid_text(recovery_id, 200),
        };
        if valid {
            Ok(())
        } else {
            Err("Invalid HTTP proxy credential operation".into())
        }
    }
}
fn endpoint_digest(endpoint: &SshEndpoint) -> Result<String, String> {
    crate::ssh_security::validate_endpoint(endpoint)?;
    endpoint
        .http_proxy
        .as_ref()
        .ok_or("This SSH target has no HTTP upstream proxy")?
        .validate()?;
    let value = serde_json::to_vec(&(endpoint, endpoint.runtime_configuration.as_deref()))
        .map_err(|_| "Could not bind HTTP proxy target")?;
    Ok(format!("{:x}", Sha256::digest(value)))
}
fn operation_digest(
    connection_id: Option<&str>,
    endpoint: &SshEndpoint,
    operation: &ProxyOperation,
) -> Result<(String, String), String> {
    operation.validate()?;
    if connection_id.is_some_and(|id| !valid_text(id, 200)) {
        return Err("Invalid canonical connection identifier".into());
    }
    let endpoint = endpoint_digest(endpoint)?;
    let bytes = serde_json::to_vec(&(connection_id, &endpoint, operation))
        .map_err(|_| "Could not bind HTTP proxy operation")?;
    Ok((endpoint, format!("{:x}", Sha256::digest(bytes))))
}
struct Ticket {
    runbook: bool,
    owner: String,
    operation_digest: String,
    endpoint_digest: String,
    credentials: BasicCredentials,
    expires: Instant,
    alive: crate::ssh_window_lifecycle::Lease,
}
#[derive(Default)]
struct Registry {
    tickets: HashMap<String, Ticket>,
}
#[derive(Default)]
pub(crate) struct HttpProxyCredentials {
    state: Arc<Mutex<Registry>>,
    cleaner_running: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Approval {
    pub ticket_id: String,
    pub expires_in_seconds: u64,
}

/// An operation retains this capability through its own fresh child leases.
/// It cannot be cloned, serialized or attached to a public connection record.
pub(crate) struct HttpProxyGrant {
    endpoint_digest: String,
    credentials: BasicCredentials,
    alive: crate::ssh_window_lifecycle::Lease,
    stopped: Arc<AtomicBool>,
}
impl std::fmt::Debug for HttpProxyGrant {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("HttpProxyGrant { credentials: [REDACTED] }")
    }
}
impl HttpProxyGrant {
    pub(crate) fn credentials_for(
        &self,
        endpoint: &SshEndpoint,
    ) -> Result<BasicCredentials, String> {
        if !self.alive.is_alive()
            || self.stopped.load(Ordering::Acquire)
            || endpoint_digest(endpoint)? != self.endpoint_digest
        {
            return Err("HTTP proxy approval no longer matches this operation".into());
        }
        Ok(self.credentials.duplicate_approved())
    }
}
impl HttpProxyCredentials {
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn approve(
        &self,
        owner: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        expected_endpoint: &SshEndpoint,
        operation: &ProxyOperation,
        credentials: BasicCredentials,
    ) -> Result<Approval, String> {
        let lease = crate::ssh_window_lifecycle::capture(owner)?;
        self.approve_with_lease(
            owner,
            connection_id,
            endpoint,
            expected_endpoint,
            operation,
            credentials,
            lease,
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn approve_with_lease(
        &self,
        owner: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        expected_endpoint: &SshEndpoint,
        operation: &ProxyOperation,
        credentials: BasicCredentials,
        lease: crate::ssh_window_lifecycle::Lease,
    ) -> Result<Approval, String> {
        if lease.owner() != owner {
            return Err("HTTP proxy window generation changed".into());
        }
        lease.with_live(|| {
            verify_expected_route(endpoint, expected_endpoint)?;
            self.approve_at_lease(
                owner,
                connection_id,
                endpoint,
                operation,
                credentials,
                lease.clone(),
                Instant::now(),
            )
        })
    }
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    fn approve_at(
        &self,
        owner: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        operation: &ProxyOperation,
        credentials: BasicCredentials,
        now: Instant,
    ) -> Result<Approval, String> {
        let lease = crate::ssh_window_lifecycle::capture(owner)?;
        lease.with_live(|| {
            self.approve_at_lease(
                owner,
                connection_id,
                endpoint,
                operation,
                credentials,
                lease.clone(),
                now,
            )
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn approve_at_lease(
        &self,
        owner: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        operation: &ProxyOperation,
        credentials: BasicCredentials,
        alive: crate::ssh_window_lifecycle::Lease,
        now: Instant,
    ) -> Result<Approval, String> {
        if !valid_text(owner, 200) || self.stopped.load(Ordering::Acquire) {
            return Err("Invalid native window owner".into());
        }
        let (endpoint_digest, operation_digest) =
            operation_digest(connection_id, endpoint, operation)?;
        let runbook = operation.is_runbook();
        let ttl = if runbook { RUNBOOK_TTL } else { TTL };
        let mut state = self
            .state
            .lock()
            .map_err(|_| "HTTP proxy credential store unavailable")?;
        state
            .tickets
            .retain(|_, ticket| ticket.expires > now && ticket.alive.is_alive());
        if state.tickets.len() >= MAX_TICKETS
            || state
                .tickets
                .values()
                .filter(|ticket| ticket.owner == owner && ticket.runbook == runbook)
                .count()
                >= if runbook { 16 } else { 8 }
        {
            return Err("Too many pending HTTP proxy credential approvals".into());
        }
        let ticket_id = uuid::Uuid::new_v4().to_string();
        state.tickets.insert(
            ticket_id.clone(),
            Ticket {
                runbook,
                owner: owner.into(),
                operation_digest,
                endpoint_digest,
                credentials,
                expires: now + ttl,
                alive,
            },
        );
        drop(state);
        self.start_expiry_cleanup();
        Ok(Approval {
            ticket_id,
            expires_in_seconds: ttl.as_secs(),
        })
    }
    fn start_expiry_cleanup(&self) {
        if self.cleaner_running.swap(true, Ordering::AcqRel) {
            return;
        }
        let state = Arc::downgrade(&self.state);
        let running = self.cleaner_running.clone();
        // At most one short-lived cleaner, only while credentials are pending.
        // Weak ownership lets broker destruction wipe tickets immediately.
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let Some(state) = state.upgrade() else {
                break;
            };
            let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            state
                .tickets
                .retain(|_, ticket| ticket.expires > now && ticket.alive.is_alive());
            if state.tickets.is_empty() {
                running.store(false, Ordering::Release);
                break;
            }
        });
    }
    pub(crate) fn consume(
        &self,
        owner: &str,
        ticket_id: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        operation: &ProxyOperation,
    ) -> Result<HttpProxyGrant, String> {
        self.consume_at(
            owner,
            ticket_id,
            connection_id,
            endpoint,
            operation,
            Instant::now(),
        )
    }
    fn consume_at(
        &self,
        owner: &str,
        ticket_id: &str,
        connection_id: Option<&str>,
        endpoint: &SshEndpoint,
        operation: &ProxyOperation,
        now: Instant,
    ) -> Result<HttpProxyGrant, String> {
        let ticket = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "HTTP proxy credential store unavailable")?;
            let ticket = state
                .tickets
                .get(ticket_id)
                .ok_or("HTTP proxy credential approval expired or already used")?;
            if ticket.owner != owner {
                return Err(
                    "HTTP proxy credential approval belongs to another native window".into(),
                );
            }
            // Consume before target/operation validation. Every failed use by its
            // owner needs fresh explicit approval; another window cannot burn it.
            state.tickets.remove(ticket_id).unwrap()
        };
        let (endpoint_digest, operation_digest) =
            operation_digest(connection_id, endpoint, operation)?;
        if now >= ticket.expires
            || !ticket.alive.is_alive()
            || ticket.operation_digest != operation_digest
            || ticket.endpoint_digest != endpoint_digest
        {
            return Err("HTTP proxy target, operation or approval changed; approve again".into());
        }
        Ok(HttpProxyGrant {
            endpoint_digest,
            credentials: ticket.credentials,
            alive: ticket.alive,
            stopped: self.stopped.clone(),
        })
    }
    pub(crate) fn revoke(&self, owner: &str, ticket_id: &str) -> Result<(), String> {
        if !valid_id(ticket_id) {
            return Err("Invalid HTTP proxy approval identifier".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "HTTP proxy credential store unavailable")?;
        if state
            .tickets
            .get(ticket_id)
            .is_some_and(|ticket| ticket.owner != owner)
        {
            return Err("HTTP proxy approval belongs to another native window".into());
        }
        state.tickets.remove(ticket_id);
        Ok(())
    }
    pub(crate) fn close_window(&self, owner: &str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.tickets.retain(|_, ticket| ticket.owner != owner);
    }
    pub(crate) fn shutdown(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.stopped.store(true, Ordering::Release);
        state.tickets.clear();
    }
}

#[tauri::command(async)]
pub(crate) fn ssh_http_proxy_credentials_revoke(
    window: tauri::Window,
    credentials: State<'_, HttpProxyCredentials>,
    ticket_id: String,
) -> Result<(), String> {
    let lease = crate::ssh_window_lifecycle::capture(window.label())?;
    lease.with_live(|| credentials.revoke(window.label(), &ticket_id))
}
impl Drop for HttpProxyCredentials {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn ssh_http_proxy_credentials_approve(
    app: AppHandle,
    window: tauri::Window,
    credentials: State<'_, HttpProxyCredentials>,
    connection_id: Option<String>,
    endpoint: Option<SshEndpoint>,
    expected_endpoint: SshEndpoint,
    operation: ProxyOperation,
    username: String,
    password: String,
    allow_plain_http: bool,
) -> Result<Approval, String> {
    let lease = crate::ssh_window_lifecycle::capture(window.label());
    // Wipe the IPC-owned input copies on every path after forming the native
    // secret. This does not promise erasure of independent WebView/OS copies.
    let mut username = username.into_bytes();
    let mut password = password.into_bytes();
    let secret = BasicCredentials::approved_plain_http(
        std::str::from_utf8(&username).unwrap_or(""),
        std::str::from_utf8(&password).unwrap_or(""),
        allow_plain_http
            || expected_endpoint
                .http_proxy
                .as_ref()
                .is_some_and(|proxy| proxy.scheme == crate::ssh_http_proxy::HttpProxyScheme::Https),
    );
    username.fill(0);
    password.fill(0);
    let lease = lease?;
    let secret = secret?;
    let endpoint = match (&connection_id, endpoint) {
        (Some(id), None) => crate::server_inventory::resolve_ssh_endpoint(&app, id)?,
        (None, Some(endpoint)) => crate::ssh_security::prepare_endpoint(endpoint)?,
        _ => return Err("Choose exactly one saved or quick SSH target".into()),
    };
    credentials.approve_with_lease(
        window.label(),
        connection_id.as_deref(),
        &endpoint,
        &expected_endpoint,
        &operation,
        secret,
        lease,
    )
}

fn verify_expected_route(actual: &SshEndpoint, expected: &SshEndpoint) -> Result<(), String> {
    crate::ssh_security::validate_endpoint(expected)?;
    if serde_json::to_value(actual).map_err(|_| "Invalid HTTP proxy target")?
        != serde_json::to_value(expected).map_err(|_| "Invalid reviewed HTTP proxy target")?
    {
        return Err("SSH target or HTTP proxy changed. Review the current route before entering credentials".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn runbook() -> ProxyOperation {
        ProxyOperation::Runbook {
            run_id: "run-one".into(),
            automation_id: "book-one".into(),
            revision: 1,
            review_digest: "a".repeat(64),
            server_id: "server-one".into(),
        }
    }
    #[test]
    fn runbook_scope_changes_burn_ticket_and_ids_match_execution_grammar() {
        let owner = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner).unwrap();
        let target = endpoint();
        let now = Instant::now();
        for change in 0..5 {
            let broker = HttpProxyCredentials::default();
            let original = runbook();
            let approved = broker
                .approve_at(
                    &owner,
                    Some("server-one"),
                    &target,
                    &original,
                    secret(),
                    now,
                )
                .unwrap();
            let mut changed = original.clone();
            if let ProxyOperation::Runbook {
                run_id,
                automation_id,
                revision,
                review_digest,
                server_id,
            } = &mut changed
            {
                match change {
                    0 => run_id.push('2'),
                    1 => automation_id.push('2'),
                    2 => *revision += 1,
                    3 => *review_digest = "b".repeat(64),
                    _ => server_id.push('2'),
                }
            }
            assert!(broker
                .consume_at(
                    &owner,
                    &approved.ticket_id,
                    Some("server-one"),
                    &target,
                    &changed,
                    now
                )
                .is_err());
            assert!(broker
                .consume_at(
                    &owner,
                    &approved.ticket_id,
                    Some("server-one"),
                    &target,
                    &original,
                    now
                )
                .is_err());
        }
        for invalid in ["bad id", "İ", "bad?", "", "bad\\id"] {
            let mut op = runbook();
            if let ProxyOperation::Runbook { run_id, .. } = &mut op {
                *run_id = invalid.into();
            }
            assert!(op.validate().is_err());
        }
    }
    #[test]
    fn runbook_approval_lives_120_seconds_other_operations_30_seconds() {
        let owner = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner).unwrap();
        let broker = HttpProxyCredentials::default();
        let target = endpoint();
        let now = Instant::now();
        let book = runbook();
        let other = operation();
        let first = broker
            .approve_at(&owner, Some("server-one"), &target, &book, secret(), now)
            .unwrap();
        let expired = broker
            .approve_at(&owner, Some("server-one"), &target, &book, secret(), now)
            .unwrap();
        let terminal = broker
            .approve_at(&owner, Some("server-one"), &target, &other, secret(), now)
            .unwrap();
        assert_eq!(first.expires_in_seconds, 120);
        assert_eq!(terminal.expires_in_seconds, 30);
        assert!(broker
            .consume_at(
                &owner,
                &terminal.ticket_id,
                Some("server-one"),
                &target,
                &other,
                now + Duration::from_secs(30)
            )
            .is_err());
        assert!(broker
            .consume_at(
                &owner,
                &first.ticket_id,
                Some("server-one"),
                &target,
                &book,
                now + Duration::from_secs(119)
            )
            .is_ok());
        assert!(broker
            .consume_at(
                &owner,
                &expired.ticket_id,
                Some("server-one"),
                &target,
                &book,
                now + Duration::from_secs(120)
            )
            .is_err());
    }
    #[test]
    fn separate_capacity_and_owner_revoke_free_slots_without_burning_foreign_approvals() {
        let owner = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner).unwrap();
        let broker = HttpProxyCredentials::default();
        let target = endpoint();
        let now = Instant::now();
        let book = runbook();
        let other = operation();
        let mut ids = Vec::new();
        for _ in 0..16 {
            ids.push(
                broker
                    .approve_at(&owner, Some("server-one"), &target, &book, secret(), now)
                    .unwrap()
                    .ticket_id,
            );
        }
        assert!(broker
            .approve_at(&owner, Some("server-one"), &target, &book, secret(), now)
            .is_err());
        for _ in 0..8 {
            broker
                .approve_at(&owner, Some("server-one"), &target, &other, secret(), now)
                .unwrap();
        }
        assert!(broker
            .approve_at(&owner, Some("server-one"), &target, &other, secret(), now)
            .is_err());
        assert!(broker.revoke("foreign-window", &ids[0]).is_err());
        assert!(broker
            .consume_at(&owner, &ids[0], Some("server-one"), &target, &book, now)
            .is_ok());
        broker.revoke(&owner, &ids[1]).unwrap();
        broker.revoke(&owner, &ids[1]).unwrap();
        assert!(broker
            .consume_at(&owner, &ids[1], Some("server-one"), &target, &book, now)
            .is_err());
        for _ in 0..2 {
            broker
                .approve_at(&owner, Some("server-one"), &target, &book, secret(), now)
                .unwrap();
        }
        assert!(broker
            .approve_at(&owner, Some("server-one"), &target, &book, secret(), now)
            .is_err());
    }
    fn endpoint() -> SshEndpoint {
        SshEndpoint {
            host: "target.example".into(),
            user: Some("deploy".into()),
            port: 22,
            http_proxy: Some(crate::ssh_http_proxy::HttpProxyEndpoint {
                scheme: Default::default(),
                host: "proxy.example".into(),
                port: 8080,
            }),
            ..Default::default()
        }
    }
    fn operation() -> ProxyOperation {
        ProxyOperation::Terminal {
            id: "owned-terminal".into(),
            shell_integration: Some("bash".into()),
        }
    }
    fn secret() -> BasicCredentials {
        BasicCredentials::approved_plain_http("synthetic-user", "synthetic-password", true).unwrap()
    }
    #[test]
    fn one_use_owner_binding_and_redacted_operation_grant() {
        let owner_id = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner_id).unwrap();
        let owner = owner_id.as_str();
        let broker = HttpProxyCredentials::default();
        let target = endpoint();
        let operation = operation();
        let now = Instant::now();
        let approved = broker
            .approve_at(
                owner,
                Some("server-one"),
                &target,
                &operation,
                secret(),
                now,
            )
            .unwrap();
        assert_eq!(approved.expires_in_seconds, 30);
        assert!(!serde_json::to_string(&approved)
            .unwrap()
            .contains("synthetic"));
        assert!(broker
            .consume_at(
                "other-window",
                &approved.ticket_id,
                Some("server-one"),
                &target,
                &operation,
                now
            )
            .is_err());
        let grant = broker
            .consume_at(
                owner,
                &approved.ticket_id,
                Some("server-one"),
                &target,
                &operation,
                now,
            )
            .unwrap();
        assert!(grant.credentials_for(&target).is_ok());
        assert!(!format!("{grant:?}").contains("synthetic"));
        assert!(broker
            .consume_at(
                owner,
                &approved.ticket_id,
                Some("server-one"),
                &target,
                &operation,
                now
            )
            .is_err());
    }
    #[test]
    fn operation_payload_endpoint_scope_and_expiry_are_bound_and_fail_consumed() {
        let owner_id = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner_id).unwrap();
        let owner = owner_id.as_str();
        for change in 0..5 {
            let broker = HttpProxyCredentials::default();
            let mut target = endpoint();
            let mut op = operation();
            let now = Instant::now();
            let approved = broker
                .approve_at(owner, Some("server-one"), &target, &op, secret(), now)
                .unwrap();
            let mut id = Some("server-one");
            let mut when = now;
            match change {
                0 => target.port = 2222,
                1 => {
                    op = ProxyOperation::Terminal {
                        id: "different".into(),
                        shell_integration: Some("bash".into()),
                    }
                }
                2 => id = None,
                3 => when += TTL,
                4 => target.http_proxy.as_mut().unwrap().host = "another.example".into(),
                _ => unreachable!(),
            };
            assert!(broker
                .consume_at(owner, &approved.ticket_id, id, &target, &op, when)
                .is_err());
            assert!(broker
                .consume_at(
                    owner,
                    &approved.ticket_id,
                    Some("server-one"),
                    &endpoint(),
                    &operation(),
                    now
                )
                .is_err());
        }
    }
    #[test]
    fn window_close_and_shutdown_revoke_pending_and_consumed_future_leases() {
        let owner_id = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner_id).unwrap();
        let owner = owner_id.as_str();
        let broker = HttpProxyCredentials::default();
        let target = endpoint();
        let op = operation();
        let now = Instant::now();
        let approved = broker
            .approve_at(owner, None, &target, &op, secret(), now)
            .unwrap();
        let grant = broker
            .consume_at(owner, &approved.ticket_id, None, &target, &op, now)
            .unwrap();
        let pending = broker
            .approve_at(owner, None, &target, &op, secret(), now)
            .unwrap();
        crate::ssh_window_lifecycle::close(owner);
        broker.close_window(owner);
        assert!(grant.credentials_for(&target).is_err());
        assert!(broker
            .consume_at(owner, &pending.ticket_id, None, &target, &op, now)
            .is_err());
        crate::ssh_window_lifecycle::register(owner).unwrap();
        let approved = broker
            .approve_at(owner, None, &target, &op, secret(), now)
            .unwrap();
        let new = broker
            .consume_at(owner, &approved.ticket_id, None, &target, &op, now)
            .unwrap();
        assert!(new.credentials_for(&target).is_ok());
        broker.shutdown();
        assert!(new.credentials_for(&target).is_err());
    }
    #[test]
    fn sftp_variants_bind_paths_overwrite_recovery_and_cannot_authorize_other_operation() {
        let owner_id = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner_id).unwrap();
        let owner = owner_id.as_str();
        let target = endpoint();
        let now = Instant::now();
        let upload = ProxyOperation::SftpUpload {
            operation_id: "upload-1".into(),
            local_path: "C:/owned/file".into(),
            remote_path: "/owned/file".into(),
            overwrite_confirmed: false,
        };
        let variants = [
            ProxyOperation::SftpUpload {
                operation_id: "upload-1".into(),
                local_path: "C:/owned/file".into(),
                remote_path: "/owned/file".into(),
                overwrite_confirmed: true,
            },
            ProxyOperation::SftpList {
                operation_id: "upload-1".into(),
                path: "/owned/file".into(),
            },
            ProxyOperation::SftpResume {
                operation_id: "upload-1".into(),
                recovery_id: "recovery-1".into(),
                overwrite_confirmed: false,
            },
        ];
        for different in variants {
            let broker = HttpProxyCredentials::default();
            let approved = broker
                .approve_at(owner, Some("saved"), &target, &upload, secret(), now)
                .unwrap();
            assert!(broker
                .consume_at(
                    owner,
                    &approved.ticket_id,
                    Some("saved"),
                    &target,
                    &different,
                    now
                )
                .is_err());
        }
    }
    #[test]
    fn explicit_plain_transport_consent_bounds_and_strict_enum_schema() {
        let owner_id = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner_id).unwrap();
        let owner = owner_id.as_str();
        assert!(BasicCredentials::approved_plain_http("synthetic", "secret", false).is_err());
        assert!(serde_json::from_value::<ProxyOperation>(
            serde_json::json!({"kind":"terminal","id":"x","command":"arbitrary"})
        )
        .is_err());
        let broker = HttpProxyCredentials::default();
        let now = Instant::now();
        let mut no_proxy = endpoint();
        no_proxy.http_proxy = None;
        assert!(broker
            .approve_at(owner, None, &no_proxy, &operation(), secret(), now)
            .is_err());
        for _ in 0..8 {
            broker
                .approve_at(owner, None, &endpoint(), &operation(), secret(), now)
                .unwrap();
        }
        assert!(broker
            .approve_at(owner, None, &endpoint(), &operation(), secret(), now)
            .is_err());
        broker
            .approve_at(owner, None, &endpoint(), &operation(), secret(), now + TTL)
            .unwrap();
    }

    #[test]
    fn stale_public_route_is_rejected_before_any_secret_can_reach_a_new_proxy() {
        let reviewed = endpoint();
        verify_expected_route(&reviewed, &reviewed).unwrap();
        for change in 0..4 {
            let mut current = reviewed.clone();
            match change {
                0 => current.http_proxy.as_mut().unwrap().host = "different-proxy.example".into(),
                1 => current.host = "different-target.example".into(),
                2 => current.user = Some("different-os-user".into()),
                3 => current.identity_file = Some("/different/key-ref".into()),
                _ => unreachable!(),
            }
            assert!(verify_expected_route(&current, &reviewed).is_err());
        }
    }

    #[test]
    fn consumed_operation_reuses_only_its_exact_configuration_for_fresh_child_copies() {
        let owner_id = format!("proxy-test-{}", uuid::Uuid::new_v4());
        crate::ssh_window_lifecycle::register(&owner_id).unwrap();
        let owner = owner_id.as_str();
        let broker = HttpProxyCredentials::default();
        let mut target = endpoint();
        target.runtime_configuration = Some(Arc::new(crate::ssh_security::RuntimeConfiguration {
            digest: "reviewed-group-digest".into(),
            environment: Vec::new(),
            shell_kind: None,
            provenance: Default::default(),
        }));
        let operation = ProxyOperation::SftpDownload {
            operation_id: "download-1".into(),
            local_path: "C:/owned/result".into(),
            remote_path: "/owned/file".into(),
        };
        let now = Instant::now();
        let approved = broker
            .approve_at(
                owner,
                Some("server-one"),
                &target,
                &operation,
                secret(),
                now,
            )
            .unwrap();
        let grant = broker
            .consume_at(
                owner,
                &approved.ticket_id,
                Some("server-one"),
                &target,
                &operation,
                now,
            )
            .unwrap();
        // Separate copies are permitted for batches of the same native operation.
        drop(grant.credentials_for(&target).unwrap());
        drop(grant.credentials_for(&target).unwrap());
        Arc::make_mut(target.runtime_configuration.as_mut().unwrap()).digest =
            "changed-group-digest".into();
        assert!(grant.credentials_for(&target).is_err());
    }
}
