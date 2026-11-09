//! Native disclosure grants. Only validated Host frames create them; a renderer
//! descriptor is a lookup key, never authority to start an HTTP transfer.
use super::{bulk, schema::Contracts};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    time::{Duration, Instant},
};

const MAX_GRANTS: usize = 256;
const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_RETENTION: Duration = Duration::from_secs(120);
// Private service result reconstruction has a separate, finite budget. Keeping
// every real chunk guard must not consume the general unary/subscription pool.
const MAX_SERVICE_RESULT_GROUPS: usize = 4;
const SERVICE_RESULT_CHUNK_BYTES: u64 = 65_536;
const MAX_SERVICE_RESULT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SERVICE_RESULT_SCOPES: usize =
    (MAX_SERVICE_RESULT_BYTES / SERVICE_RESULT_CHUNK_BYTES) as usize;

#[derive(Clone, PartialEq, Eq, Hash)]
struct ServiceResult {
    owner: String,
    original_id: String,
    payload_sha256: String,
    payload_bytes: u64,
    target: String,
    result_sha256: String,
    result_bytes: u64,
}

#[derive(Clone, PartialEq, Eq)]
enum Source {
    Stream { logical: String, stream: String },
    Unary(String),
}

#[derive(Clone, Default)]
struct Resource {
    project: Option<String>,
    session: Option<String>,
}
impl Resource {
    fn params(params: &Value) -> Self {
        Self {
            project: params["projectId"]
                .as_str()
                .or_else(|| params["target"]["projectId"].as_str())
                .map(str::to_owned),
            session: params["sessionId"]
                .as_str()
                .or_else(|| params["target"]["sessionId"].as_str())
                .map(str::to_owned),
        }
    }
    fn affected_by(&self, target: &Value) -> bool {
        let global = self.project.is_none() && self.session.is_none();
        match target["kind"].as_str() {
            Some("environment") => true,
            Some("project") => global || self.project.as_deref() == target["projectId"].as_str(),
            Some("session") => global || self.session.as_deref() == target["sessionId"].as_str(),
            _ => false,
        }
    }
}
pub(super) struct ResourceScope {
    pub(super) commit: Mutex<()>,
    owner: String,
    request_id: String,
    resource: Resource,
    revoked: AtomicBool,
    service_result: Option<ServiceResult>,
}
impl ResourceScope {
    fn new(owner: &str, request_id: &str, resource: Resource) -> Self {
        Self {
            commit: Mutex::new(()),
            owner: owner.into(),
            request_id: request_id.into(),
            resource,
            revoked: AtomicBool::new(false),
            service_result: None,
        }
    }
    pub fn live(&self) -> bool {
        !self.revoked.load(Ordering::Acquire)
    }
    fn revoke(&self) {
        let _commit = self
            .commit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.revoked.store(true, Ordering::Release);
    }
}

pub(super) struct Grant {
    pub(super) commit: Mutex<()>,
    owner: String,
    generation: u64,
    source: Source,
    descriptor: Value,
    expires_at: u64,
    retained_until: Instant,
    revoked: AtomicBool,
    claimed: AtomicBool,
    metadata_bytes: usize,
    resource: Arc<ResourceScope>,
}
impl Grant {
    pub fn revoke(&self) {
        let _commit = self
            .commit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.revoked.store(true, Ordering::Release);
    }
    pub(super) fn live(&self) -> bool {
        !self.revoked.load(Ordering::Acquire)
            && self.resource.live()
            && self.expires_at > bulk::millis()
            && Instant::now() < self.retained_until
    }
    pub(super) fn resource(&self) -> Arc<ResourceScope> {
        self.resource.clone()
    }
}

struct Member {
    token: String,
    stream: Option<String>,
    active: bool,
    suspended: bool,
    retained_until: Instant,
    target: Value,
    resource: Arc<ResourceScope>,
}
#[derive(Default)]
struct State {
    generation: u64,
    ready: bool,
    grants: HashMap<String, Arc<Grant>>,
    members: HashMap<(String, String), Member>,
    scopes: Vec<Weak<ResourceScope>>,
}
pub(super) struct Permits {
    environment_id: String,
    state: Mutex<State>,
}

impl Permits {
    pub fn new(environment_id: &str) -> Self {
        Self {
            environment_id: environment_id.into(),
            state: Mutex::new(State::default()),
        }
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    #[cfg(test)]
    pub(super) fn with_state_lock_for_test<T>(
        &self,
        action: impl FnOnce(&mut dyn FnMut(&Value)) -> T,
    ) -> T {
        let mut state = self.lock();
        action(&mut |target| Self::revoke_resource(&mut state, target))
    }
    fn prune(state: &mut State) {
        state.grants.retain(|_, grant| grant.live());
        state
            .members
            .retain(|_, member| member.active || Instant::now() < member.retained_until);
        state.scopes.retain(|scope| scope.strong_count() > 0);
    }
    pub fn phase(&self, generation: u64, ready: bool) {
        let mut state = self.lock();
        if !ready || state.generation != generation {
            for grant in state.grants.values() {
                grant.revoke();
            }
            state.grants.clear();
            state.members.retain(|_, member| !member.active);
        }
        state.generation = generation;
        state.ready = ready;
    }
    pub fn revoke_all(&self) {
        let mut state = self.lock();
        state.ready = false;
        for grant in state.grants.values() {
            grant.revoke();
        }
        state.grants.clear();
        state.members.clear();
        for scope in state.scopes.drain(..).filter_map(|scope| scope.upgrade()) {
            scope.revoke();
        }
    }
    pub fn revoke_owner(&self, owner: &str) {
        let mut state = self.lock();
        for ((current, _), member) in &state.members {
            if current == owner {
                member.resource.revoke();
            }
        }
        state.members.retain(|(current, _), _| current != owner);
        for scope in state
            .scopes
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|scope| scope.owner == owner)
        {
            scope.revoke();
        }
        for grant in state.grants.values().filter(|grant| grant.owner == owner) {
            grant.revoke();
        }
        Self::prune(&mut state);
    }
    pub fn revoke_member(&self, owner: &str, logical: &str) {
        let mut state = self.lock();
        if let Some(member) = state.members.remove(&(owner.into(), logical.into())) {
            member.resource.revoke();
        }
        for grant in state.grants.values().filter(|grant| {
            grant.owner == owner
                && matches!(&grant.source,Source::Stream{logical:current,..} if current==logical)
        }) {
            grant.revoke();
        }
        Self::prune(&mut state);
    }
    pub fn revoke_attempt(&self, owner: &str, logical: &str, token: &str) {
        let mut state = self.lock();
        let key = (owner.into(), logical.into());
        if state
            .members
            .get(&key)
            .is_some_and(|member| member.token == token)
        {
            if let Some(member) = state.members.remove(&key) {
                member.resource.revoke();
            }
        }
        Self::prune(&mut state);
    }
    pub fn begin_open(
        &self,
        owner: &str,
        logical: &str,
        token: &str,
        target: &Value,
    ) -> Result<(), &'static str> {
        self.revoke_member(owner, logical);
        let mut state = self.lock();
        Self::prune(&mut state);
        if state.members.len() >= MAX_GRANTS {
            return Err("overload");
        }
        state.members.insert(
            (owner.into(), logical.into()),
            Member {
                token: token.into(),
                stream: None,
                active: false,
                suspended: false,
                retained_until: Instant::now() + MAX_RETENTION,
                target: target.clone(),
                resource: Arc::new(ResourceScope::new(owner, token, Resource::params(target))),
            },
        );
        Ok(())
    }
    pub fn opened(&self, owner: &str, logical: &str, token: &str, stream: &str) -> bool {
        let mut state = self.lock();
        let Some(member) = state.members.get_mut(&(owner.into(), logical.into())) else {
            return false;
        };
        if member.token != token {
            return false;
        }
        member.active = true;
        member.suspended = false;
        member.stream = Some(stream.into());
        member.resource.revoke();
        member.resource = Arc::new(ResourceScope::new(
            owner,
            token,
            Resource::params(&member.target),
        ));
        true
    }
    pub fn revoke_unary(&self, owner: &str, request_id: &str) {
        let mut state = self.lock();
        for scope in state
            .scopes
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|scope| scope.owner == owner && scope.request_id == request_id)
        {
            scope.revoke();
        }
        for grant in state.grants.values().filter(|grant| {
            grant.owner == owner
                && matches!(&grant.source,Source::Unary(current) if current==request_id)
        }) {
            grant.revoke();
        }
        Self::prune(&mut state);
    }
    pub fn scope(
        &self,
        owner: &str,
        request_id: &str,
        params: &Value,
    ) -> Result<Arc<ResourceScope>, &'static str> {
        let mut state = self.lock();
        Self::prune(&mut state);
        if state
            .scopes
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|scope| scope.service_result.is_none())
            .count()
            >= MAX_GRANTS
        {
            return Err("overload");
        }
        let scope = Arc::new(ResourceScope::new(
            owner,
            request_id,
            Resource::params(params),
        ));
        state.scopes.push(Arc::downgrade(&scope));
        Ok(scope)
    }
    /// Called only for the validated private NativeService result.read route.
    /// Each chunk keeps its own request/revocation gate; only admission accounting
    /// is grouped by the complete immutable original and result identity.
    pub(super) fn service_result_scope(
        &self,
        owner: &str,
        request_id: &str,
        params: &Value,
    ) -> Result<Arc<ResourceScope>, &'static str> {
        let text = |value: &Value, max: usize| {
            value
                .as_str()
                .filter(|text| !text.is_empty() && text.len() <= max)
                .map(str::to_owned)
                .ok_or("identity")
        };
        let result_bytes = params["resultSource"]["byteLength"]
            .as_u64()
            .filter(|bytes| *bytes > 0 && *bytes <= MAX_SERVICE_RESULT_BYTES)
            .ok_or("identity")?;
        let offset = params["offset"].as_u64().ok_or("identity")?;
        if owner.is_empty()
            || owner.len() > 512
            || offset >= result_bytes
            || offset % SERVICE_RESULT_CHUNK_BYTES != 0
            || params["limit"].as_u64()
                != Some((result_bytes - offset).min(SERVICE_RESULT_CHUNK_BYTES))
        {
            return Err("identity");
        }
        let key = ServiceResult {
            owner: owner.into(),
            original_id: text(&params["originalId"], 128)?,
            payload_sha256: text(&params["sha256"], 64)?,
            payload_bytes: params["byteLength"].as_u64().ok_or("identity")?,
            target: text(&params["target"], 128)?,
            result_sha256: text(&params["resultSource"]["sha256"], 64)?,
            result_bytes,
        };
        let mut state = self.lock();
        Self::prune(&mut state);
        let scopes = state
            .scopes
            .iter()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        let groups = scopes
            .iter()
            .filter_map(|scope| scope.service_result.as_ref())
            .collect::<HashSet<_>>();
        if (!groups.contains(&key) && groups.len() >= MAX_SERVICE_RESULT_GROUPS)
            || scopes
                .iter()
                .filter(|scope| scope.service_result.as_ref() == Some(&key))
                .count()
                >= MAX_SERVICE_RESULT_SCOPES
        {
            return Err("overload");
        }
        let mut scope = ResourceScope::new(owner, request_id, Resource::params(params));
        scope.service_result = Some(key);
        let scope = Arc::new(scope);
        state.scopes.push(Arc::downgrade(&scope));
        Ok(scope)
    }
    fn revoke_resource(state: &mut State, target: &Value) {
        for scope in state
            .scopes
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|scope| scope.resource.affected_by(target))
        {
            scope.revoke();
        }
        for grant in state
            .grants
            .values()
            .filter(|grant| grant.resource.resource.affected_by(target))
        {
            grant.revoke();
        }
        for member in state
            .members
            .values_mut()
            .filter(|member| member.target == *target)
        {
            member.suspended = true;
            member.resource.revoke();
        }
        Self::prune(state);
    }
    fn register(
        &self,
        contracts: &Contracts,
        owner: &str,
        generation: u64,
        source: Source,
        descriptor: &Value,
        resource: Arc<ResourceScope>,
    ) -> Result<Arc<Grant>, &'static str> {
        if owner.is_empty()
            || descriptor["environmentId"].as_str() != Some(self.environment_id.as_str())
        {
            return Err("identity");
        }
        if !contracts
            .bulk_descriptor
            .as_ref()
            .is_some_and(|validator| validator.is_valid(descriptor))
            || descriptor["totalBytes"]
                .as_u64()
                .is_none_or(|bytes| bytes == 0 || bytes > 32 * 1024 * 1024)
            || descriptor["expiresAt"]
                .as_u64()
                .is_none_or(|expiry| expiry <= bulk::millis())
        {
            return Err("schema");
        }
        let mut state = self.lock();
        Self::prune(&mut state);
        if !state.ready || state.generation != generation || !resource.live() {
            return Err("retired");
        }
        if let Some(grant) = state.grants.values().find(|grant| {
            grant.owner == owner && grant.source == source && grant.descriptor == *descriptor
        }) {
            return Ok(grant.clone());
        }
        let metadata_bytes = descriptor.to_string().len()
            + owner.len()
            + match &source {
                Source::Stream { logical, stream } => logical.len() + stream.len(),
                Source::Unary(id) => id.len(),
            };
        if state.grants.len() >= MAX_GRANTS
            || state
                .grants
                .values()
                .map(|grant| grant.metadata_bytes)
                .sum::<usize>()
                + metadata_bytes
                > MAX_METADATA_BYTES
        {
            return Err("overload");
        }
        let grant = Arc::new(Grant {
            commit: Mutex::new(()),
            owner: owner.into(),
            generation,
            source,
            descriptor: descriptor.clone(),
            expires_at: descriptor["expiresAt"].as_u64().unwrap(),
            retained_until: Instant::now() + MAX_RETENTION,
            revoked: AtomicBool::new(false),
            claimed: AtomicBool::new(false),
            metadata_bytes,
            resource,
        });
        state
            .grants
            .insert(uuid::Uuid::new_v4().to_string(), grant.clone());
        Ok(grant)
    }
    #[cfg(test)]
    pub fn stream(
        &self,
        contracts: &Contracts,
        owner: &str,
        generation: u64,
        event: &Value,
    ) -> Result<(), &'static str> {
        let binding = self
            .lock()
            .members
            .get(&(
                owner.into(),
                event["params"]["subscriptionId"]
                    .as_str()
                    .unwrap_or("")
                    .into(),
            ))
            .map(|member| (member.token.clone(), member.target.clone()))
            .ok_or("retired")?;
        self.stream_bound(contracts, owner, generation, event, &binding.0, &binding.1)
    }
    pub fn retire_resource(&self, target: &Value, closed: bool) {
        let mut state = self.lock();
        Self::revoke_resource(&mut state, target);
        if closed {
            state.members.retain(|_, member| member.target != *target);
        }
    }
    pub fn stream_bound(
        &self,
        contracts: &Contracts,
        owner: &str,
        generation: u64,
        event: &Value,
        token: &str,
        target: &Value,
    ) -> Result<(), &'static str> {
        let params = &event["params"];
        let logical = params["subscriptionId"].as_str().ok_or("identity")?;
        let mut state = self.lock();
        let key = (owner.into(), logical.into());
        if matches!(params["kind"].as_str(), Some("closed" | "resync-required")) {
            Self::revoke_resource(&mut state, target);
            if params["kind"] == "closed" {
                state.members.retain(|_, member| member.target != *target);
            }
            return Ok(());
        }
        let Some(member) = state.members.get_mut(&key) else {
            return Err("retired");
        };
        if member.token != token
            || member.target != *target
            || !member.active
            || member.stream.as_deref() != params["streamId"].as_str()
        {
            return Err("retired");
        }
        if member.suspended {
            if params["kind"] != "snapshot" {
                return Err("retired");
            }
            member.suspended = false;
            member.resource = Arc::new(ResourceScope::new(
                owner,
                &member.token,
                Resource::params(&member.target),
            ));
        }
        let resource = member.resource.clone();
        drop(state);
        if params["data"]["kind"] != "bulk" {
            return Ok(());
        }
        self.register(
            contracts,
            owner,
            generation,
            Source::Stream {
                logical: logical.into(),
                stream: params["streamId"].as_str().ok_or("identity")?.into(),
            },
            &params["data"],
            resource,
        )?;
        Ok(())
    }
    pub fn unary(
        self: &Arc<Self>,
        contracts: &Contracts,
        owner: &str,
        generation: u64,
        request_id: &str,
        descriptor: &Value,
        resource: Arc<ResourceScope>,
    ) -> Result<Lease, &'static str> {
        let grant = self.register(
            contracts,
            owner,
            generation,
            Source::Unary(request_id.into()),
            descriptor,
            resource,
        )?;
        Self::claim(self, grant)
    }
    pub fn fetch(self: &Arc<Self>, owner: &str, descriptor: &Value) -> Result<Lease, &'static str> {
        let mut state = self.lock();
        Self::prune(&mut state);
        if !state.ready {
            return Err("retired");
        }
        let grant = state
            .grants
            .values()
            .find(|grant| {
                grant.owner == owner
                    && grant.generation == state.generation
                    && matches!(grant.source, Source::Stream { .. })
                    && grant.descriptor == *descriptor
                    && !grant.claimed.load(Ordering::Acquire)
            })
            .cloned()
            .ok_or("ungranted")?;
        Self::claim(self, grant)
    }
    fn claim(this: &Arc<Self>, grant: Arc<Grant>) -> Result<Lease, &'static str> {
        if !grant.live()
            || grant
                .claimed
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return Err("ungranted");
        }
        Ok(Lease {
            permits: this.clone(),
            grant,
        })
    }
}

pub(super) struct Lease {
    permits: Arc<Permits>,
    grant: Arc<Grant>,
}
impl Lease {
    pub fn grant(&self) -> Arc<Grant> {
        self.grant.clone()
    }
    pub fn live(&self) -> bool {
        self.grant.live()
    }
    pub fn disclose<T>(&self, value: T) -> Result<T, &'static str> {
        // This lock linearizes disclosure with tombstone/detach/route retirement.
        let state = self.permits.lock();
        if !state.ready
            || state.generation != self.grant.generation
            || !self.live()
            || !state
                .grants
                .values()
                .any(|grant| Arc::ptr_eq(grant, &self.grant))
        {
            return Err("retired");
        }
        Ok(value)
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.grant.revoke();
        let mut state = self.permits.lock();
        Permits::prune(&mut state);
    }
}

#[cfg(test)]
#[path = "permits_tests.rs"]
mod tests;

#[cfg(test)]
mod commit_tests {
    use super::*;

    #[test]
    fn native_commit_bulk_grant_revoke_waits_for_commit_gate() {
        let grant = Arc::new(Grant {
            commit: Mutex::new(()),
            owner: "native".into(),
            generation: 1,
            source: Source::Unary("request".into()),
            descriptor: serde_json::json!({}),
            expires_at: bulk::millis() + 60_000,
            retained_until: Instant::now() + MAX_RETENTION,
            revoked: AtomicBool::new(false),
            claimed: AtomicBool::new(true),
            metadata_bytes: 0,
            resource: Arc::new(ResourceScope::new("native", "request", Resource::default())),
        });
        let gate = grant.commit.lock().unwrap();
        let retired = grant.clone();
        let (done_tx, done_rx) = std::sync::mpsc::sync_channel(1);
        let task = std::thread::spawn(move || {
            retired.revoke();
            done_tx.send(()).unwrap();
        });
        let blocked = done_rx.recv_timeout(Duration::from_millis(40)).is_err();
        assert!(grant.live());
        drop(gate);
        task.join().unwrap();
        assert!(blocked);
        assert!(!grant.live());
    }
}
