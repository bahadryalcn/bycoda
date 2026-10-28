//! Native-only epoch/challenge lifetime over an already kernel-verified pipe.
//!
//! This is not actor enrollment, executable qualification, a Complete writer
//! inventory, or an AuthenticatedHostDecisionPort. No migration operation or IPC
//! is installed. An environment is selected by trusted native composition; the
//! store identity is captured from the actual retained SessionStore, never a DTO.
#![allow(dead_code)] // Qualified coordinator composition remains a separate slice.

use crate::native_authority_pipe::{AuthorityPipeConnection, PipeBudget, PipeError};
use crate::session_store::{
    authority::{SourceSnapshot, StoreIdentity},
    SessionStore,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_CHALLENGES: usize = 64;
const MAX_ACCEPTED_OPERATIONS: usize = 64;
const MAX_CHALLENGE_LIFETIME: Duration = Duration::from_secs(30);
const MAX_SAFE_GENERATION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChannelError {
    Unsupported,
    InvalidScope,
    InvalidLifetime,
    SourceUnavailable,
    SourceChanged,
    StateUnavailable,
    Closed,
    Capacity,
    Malformed,
    WrongEpoch,
    WrongScope,
    WrongStep,
    Expired,
    UnknownChallenge,
    Transport(PipeError),
}
impl std::fmt::Display for ChannelError {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "NATIVE_AUTHORITY_CHANNEL_{self:?}")
    }
}
impl std::error::Error for ChannelError {}

/// Exact step names used by the Host coordinator; a step is not operation authority.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AuthorityStep {
    CancelQuiesce,
    ReadSnapshot,
    Fence,
    Prepare,
    Stage,
    Activate,
    Abort,
    VerifyDecision,
    ApplyDecision,
    ReadNativeAck,
    HostAck,
}

/// Native-selected expected scope, not an authenticated serialized request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AuthorityScope {
    environment_id: String,
    session_id: String,
    migration_id: String,
    generation: u64,
}
impl AuthorityScope {
    pub(crate) fn new(
        environment_id: &str,
        session_id: &str,
        migration_id: &str,
        generation: u64,
    ) -> Result<Self, ChannelError> {
        if ![environment_id, session_id, migration_id]
            .into_iter()
            .all(identifier)
            || generation > MAX_SAFE_GENERATION
        {
            return Err(ChannelError::InvalidScope);
        }
        Ok(Self {
            environment_id: environment_id.into(),
            session_id: session_id.into(),
            migration_id: migration_id.into(),
            generation,
        })
    }
}

/// Private capture factory. No constructor accepts a serialized StoreIdentity.
pub(crate) struct CapturedSourceBinding {
    store: CapturedStore,
    identity: StoreIdentity,
    environment_id: String,
    #[cfg(not(windows))]
    _unsupported: std::convert::Infallible,
}

enum CapturedStore {
    Owned(Arc<SessionStore>),
    Managed {
        app: tauri::AppHandle,
        instance: uuid::Uuid,
    },
}
impl CapturedStore {
    fn identity_and_instance(&self) -> Result<(StoreIdentity, uuid::Uuid), ChannelError> {
        match self {
            Self::Owned(store) => store
                .authority_identity()
                .map(|identity| (identity, store.native_instance_id()))
                .map_err(|_| ChannelError::SourceUnavailable),
            Self::Managed { app, instance } => {
                use tauri::Manager;
                let store = app
                    .try_state::<SessionStore>()
                    .ok_or(ChannelError::SourceUnavailable)?;
                managed_store_identity(store.inner(), *instance)
                    .map(|identity| (identity, store.native_instance_id()))
            }
        }
    }
}

/// Native observation only. No Deserialize/Serialize or qualification capability.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NativeCapturedSource {
    pub(crate) identity: StoreIdentity,
    pub(crate) environment_id: String,
    pub(crate) native_instance_id: uuid::Uuid,
}

fn managed_store_identity(
    store: &SessionStore,
    expected: uuid::Uuid,
) -> Result<StoreIdentity, ChannelError> {
    if store.native_instance_id() != expected {
        return Err(ChannelError::SourceChanged);
    }
    store
        .authority_identity()
        .map_err(|_| ChannelError::SourceUnavailable)
}

impl CapturedSourceBinding {
    pub(crate) fn capture(
        store: Arc<SessionStore>,
        native_environment_id: &str,
    ) -> Result<Self, ChannelError> {
        #[cfg(windows)]
        {
            if !identifier(native_environment_id) {
                return Err(ChannelError::InvalidScope);
            }
            let identity = store
                .authority_identity()
                .map_err(|_| ChannelError::SourceUnavailable)?;
            if !identifier(&identity.source_store_id) || !identifier(&identity.source_profile_id) {
                return Err(ChannelError::SourceUnavailable);
            }
            Ok(Self {
                store: CapturedStore::Owned(store),
                identity,
                environment_id: native_environment_id.into(),
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (store, native_environment_id);
            Err(ChannelError::Unsupported)
        }
    }

    /// Capture today's actual managed Store without reopening its database or
    /// cloning a synthetic Store. AppHandle retains the native manager; a native
    /// construction UUID rejects unmanage/replacement even with equal durable IDs.
    pub(crate) fn capture_managed_store(
        app: tauri::AppHandle,
        native_environment_id: &str,
    ) -> Result<Self, ChannelError> {
        #[cfg(windows)]
        {
            use tauri::Manager;
            if !identifier(native_environment_id) {
                return Err(ChannelError::InvalidScope);
            }
            let (identity, instance) = {
                let store = app
                    .try_state::<SessionStore>()
                    .ok_or(ChannelError::SourceUnavailable)?;
                let instance = store.native_instance_id();
                (managed_store_identity(store.inner(), instance)?, instance)
            };
            if !identifier(&identity.source_store_id) || !identifier(&identity.source_profile_id) {
                return Err(ChannelError::SourceUnavailable);
            }
            Ok(Self {
                store: CapturedStore::Managed { app, instance },
                identity,
                environment_id: native_environment_id.into(),
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (app, native_environment_id);
            Err(ChannelError::Unsupported)
        }
    }

    pub(crate) fn checked_source(&self) -> Result<NativeCapturedSource, ChannelError> {
        let (current, native_instance_id) = self.store.identity_and_instance()?;
        if current != self.identity {
            return Err(ChannelError::SourceChanged);
        }
        Ok(NativeCapturedSource {
            identity: current,
            environment_id: self.environment_id.clone(),
            native_instance_id,
        })
    }

    /// Read only from the actually captured manager/Store; never reopen a path.
    pub(crate) fn read_retained_snapshot(
        &self,
        session_id: &str,
        migration_id: &str,
    ) -> Result<Option<SourceSnapshot>, ChannelError> {
        if !identifier(session_id) || !identifier(migration_id) {
            return Err(ChannelError::InvalidScope);
        }
        let before = self.checked_source()?;
        let read = |store: &SessionStore| {
            store
                .authority_retained_snapshot(
                    &self.environment_id,
                    session_id,
                    migration_id,
                    &self.identity,
                )
                .map_err(|_| ChannelError::SourceUnavailable)
        };
        let result = match &self.store {
            CapturedStore::Owned(store) => read(store),
            CapturedStore::Managed { app, instance } => {
                use tauri::Manager;
                let store = app
                    .try_state::<SessionStore>()
                    .ok_or(ChannelError::SourceUnavailable)?;
                managed_store_identity(store.inner(), *instance)?;
                read(store.inner())
            }
        }?;
        if self.checked_source()? != before {
            return Err(ChannelError::SourceChanged);
        }
        Ok(result)
    }

    fn check(&self) -> Result<(), ChannelError> {
        self.checked_source().map(|_| ())
    }
}

/// Wire claims/locators only. Deserializing this object never creates admission.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChallengeContext {
    channel_epoch: String,
    native_actor_epoch: String,
    challenge: String,
    environment_id: String,
    source_store_id: String,
    source_profile_id: String,
    session_id: String,
    migration_id: String,
    generation: u64,
    step: AuthorityStep,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StepRequest {
    context: ChallengeContext,
    payload: Value,
}
struct PendingChallenge {
    context: ChallengeContext,
    expires: Instant,
}
#[derive(Default)]
struct Ledger {
    closed: bool,
    pending: HashMap<String, PendingChallenge>,
    accepted: HashSet<String>,
    abandoned: HashSet<String>,
}
struct ChannelState {
    source: CapturedSourceBinding,
    channel_epoch: String,
    native_actor_epoch: String,
    ledger: Mutex<Ledger>,
}

/// This observation never qualifies a native actor or a migration drain.
pub(crate) struct ChannelObservation {
    pub qualified: bool,
    pub closed: bool,
    pub pending_challenges: usize,
    pub accepted_operations: usize,
    pub abandoned_operations: usize,
}

/// Non-Clone physical endpoint owner. A new connection always gets new epochs.
pub(crate) struct NativeAuthorityChannel {
    connection: AuthorityPipeConnection,
    state: Arc<ChannelState>,
}
impl NativeAuthorityChannel {
    pub(crate) fn open(
        connection: AuthorityPipeConnection,
        source: CapturedSourceBinding,
    ) -> Result<Self, ChannelError> {
        #[cfg(windows)]
        {
            source.check()?;
            Ok(Self {
                connection,
                state: Arc::new(ChannelState {
                    source,
                    channel_epoch: uuid::Uuid::new_v4().to_string(),
                    native_actor_epoch: uuid::Uuid::new_v4().to_string(),
                    ledger: Mutex::new(Ledger::default()),
                }),
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (connection, source);
            Err(ChannelError::Unsupported)
        }
    }

    /// Send through the real peer-checked pipe before exposing a usable context.
    pub(crate) fn issue_challenge(
        &mut self,
        step: AuthorityStep,
        scope: &AuthorityScope,
        lifetime: Duration,
        budget: &PipeBudget,
    ) -> Result<ChallengeContext, ChannelError> {
        let result = self.issue_inner(step, scope, lifetime, budget);
        if result.is_err() {
            self.revoke();
        }
        result
    }

    fn issue_inner(
        &mut self,
        step: AuthorityStep,
        scope: &AuthorityScope,
        lifetime: Duration,
        budget: &PipeBudget,
    ) -> Result<ChallengeContext, ChannelError> {
        self.state.source.check()?;
        if scope.environment_id != self.state.source.environment_id {
            return Err(ChannelError::WrongScope);
        }
        if lifetime.is_zero() || lifetime > MAX_CHALLENGE_LIFETIME {
            return Err(ChannelError::InvalidLifetime);
        }
        let context = ChallengeContext {
            channel_epoch: self.state.channel_epoch.clone(),
            native_actor_epoch: self.state.native_actor_epoch.clone(),
            challenge: uuid::Uuid::new_v4().to_string(),
            environment_id: scope.environment_id.clone(),
            source_store_id: self.state.source.identity.source_store_id.clone(),
            source_profile_id: self.state.source.identity.source_profile_id.clone(),
            session_id: scope.session_id.clone(),
            migration_id: scope.migration_id.clone(),
            generation: scope.generation,
            step,
        };
        {
            let mut ledger = self
                .state
                .ledger
                .lock()
                .map_err(|_| ChannelError::StateUnavailable)?;
            if ledger.closed {
                return Err(ChannelError::Closed);
            }
            let now = Instant::now();
            ledger.pending.retain(|_, entry| entry.expires > now);
            if ledger.pending.len() >= MAX_CHALLENGES
                || ledger.pending.contains_key(&context.challenge)
            {
                return Err(ChannelError::Capacity);
            }
            ledger.pending.insert(
                context.challenge.clone(),
                PendingChallenge {
                    context: context.clone(),
                    expires: now + lifetime,
                },
            );
        }
        let wire = serde_json::to_value(&context).map_err(|_| ChannelError::Malformed)?;
        self.connection
            .send_json(&wire, budget)
            .map_err(ChannelError::Transport)?;
        Ok(context)
    }

    /// No public DTO-to-handle path: read and kernel peer validation come first.
    /// Payload permissions, writer inventory and source-floor CAS remain the
    /// actual domain owner's responsibility. This is not a decision verifier.
    pub(crate) fn admit_next(
        &mut self,
        expected_step: AuthorityStep,
        expected_scope: &AuthorityScope,
        budget: &PipeBudget,
    ) -> Result<(AcceptedOperation, Value), ChannelError> {
        let result = self.admit_inner(expected_step, expected_scope, budget);
        if result.is_err() {
            self.revoke();
        }
        result
    }

    fn admit_inner(
        &mut self,
        expected_step: AuthorityStep,
        expected_scope: &AuthorityScope,
        budget: &PipeBudget,
    ) -> Result<(AcceptedOperation, Value), ChannelError> {
        self.assert_open()?;
        let wire = self
            .connection
            .read_json(budget)
            .map_err(ChannelError::Transport)?;
        self.state.source.check()?;
        let request: StepRequest =
            serde_json::from_value(wire).map_err(|_| ChannelError::Malformed)?;
        let context = request.context;
        let mut ledger = self
            .state
            .ledger
            .lock()
            .map_err(|_| ChannelError::StateUnavailable)?;
        if ledger.closed {
            return Err(ChannelError::Closed);
        }
        if context.channel_epoch != self.state.channel_epoch
            || context.native_actor_epoch != self.state.native_actor_epoch
        {
            return Err(ChannelError::WrongEpoch);
        }
        let pending = ledger
            .pending
            .remove(&context.challenge)
            .ok_or(ChannelError::UnknownChallenge)?;
        if pending.expires <= Instant::now() {
            return Err(ChannelError::Expired);
        }
        if context.step != expected_step || pending.context.step != expected_step {
            return Err(ChannelError::WrongStep);
        }
        if context != pending.context
            || context.environment_id != expected_scope.environment_id
            || context.session_id != expected_scope.session_id
            || context.migration_id != expected_scope.migration_id
            || context.generation != expected_scope.generation
        {
            return Err(ChannelError::WrongScope);
        }
        if ledger.accepted.len() >= MAX_ACCEPTED_OPERATIONS {
            return Err(ChannelError::Capacity);
        }
        let id = uuid::Uuid::new_v4().to_string();
        if !ledger.accepted.insert(id.clone()) {
            return Err(ChannelError::Capacity);
        }
        Ok((
            AcceptedOperation {
                state: self.state.clone(),
                id,
                step: expected_step,
                scope: expected_scope.clone(),
                settled: false,
            },
            request.payload,
        ))
    }

    pub(crate) fn send_reply(
        &mut self,
        value: &Value,
        budget: &PipeBudget,
    ) -> Result<(), ChannelError> {
        let result = self.assert_open().and_then(|()| {
            self.connection
                .send_json(value, budget)
                .map_err(ChannelError::Transport)
        });
        if result.is_err() {
            self.revoke();
        }
        result
    }

    fn assert_open(&self) -> Result<(), ChannelError> {
        let ledger = self
            .state
            .ledger
            .lock()
            .map_err(|_| ChannelError::StateUnavailable)?;
        if ledger.closed {
            Err(ChannelError::Closed)
        } else {
            Ok(())
        }
    }

    pub(crate) fn revoke(&mut self) {
        // Retain already accepted accounting; transport closure is not rollback,
        // cancellation, a durable ACK or evidence of non-admission.
        if let Ok(mut ledger) = self.state.ledger.lock() {
            ledger.closed = true;
            ledger.pending.clear();
        }
        self.connection.close();
    }

    pub(crate) fn observation(&self) -> Result<ChannelObservation, ChannelError> {
        let ledger = self
            .state
            .ledger
            .lock()
            .map_err(|_| ChannelError::StateUnavailable)?;
        Ok(ChannelObservation {
            qualified: false,
            closed: ledger.closed,
            pending_challenges: ledger.pending.len(),
            accepted_operations: ledger.accepted.len(),
            abandoned_operations: ledger.abandoned.len(),
        })
    }
}
impl Drop for NativeAuthorityChannel {
    fn drop(&mut self) {
        self.revoke();
    }
}

/// Opaque, non-Clone, non-serializable accounting handle. Move this into the
/// actual accepted owner, not a cancellable UI waiter. It grants no domain rights.
/// Dropping without settlement remains unknown rather than reporting idle.
pub(crate) struct AcceptedOperation {
    state: Arc<ChannelState>,
    id: String,
    step: AuthorityStep,
    scope: AuthorityScope,
    settled: bool,
}
impl AcceptedOperation {
    /// Synchronous work only: do not return a Future or detach a spawned job.
    /// Move this handle into that actual owner instead. The actual return/error
    /// is preserved even if local accounting is unavailable.
    pub(crate) fn run_sync<T>(mut self, operation: impl FnOnce() -> T) -> T {
        let result = operation();
        self.complete();
        result
    }

    /// Await actual owned work, not a detachable waiter for a different job.
    /// Dropping this future, even before its first poll, leaves unknown retained
    /// accounting. If a spawned job outlives its waiter, move this handle into
    /// the job and await its actual work there instead of wrapping the waiter.
    pub(crate) async fn run_async<T>(
        mut self,
        actual_work: impl std::future::Future<Output = T>,
    ) -> T {
        let result = actual_work.await;
        self.complete();
        result
    }

    /// Call only from the actual settled owner; caller cancellation is not settlement.
    pub(crate) fn settle<T>(mut self, actual_result: T) -> T {
        self.complete();
        actual_result
    }

    fn complete(&mut self) {
        if let Ok(mut ledger) = self.state.ledger.lock() {
            ledger.accepted.remove(&self.id);
            ledger.abandoned.remove(&self.id);
            self.settled = true;
        }
    }
}
impl Drop for AcceptedOperation {
    fn drop(&mut self) {
        if !self.settled {
            if let Ok(mut ledger) = self.state.ledger.lock() {
                ledger.abandoned.insert(self.id.clone());
            }
        }
    }
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || b"._:@/-".contains(&value))
}

#[cfg(all(test, windows))]
#[path = "native_authority_channel_tests.rs"]
mod tests;

#[cfg(all(test, not(windows)))]
mod unsupported_tests {
    use super::*;

    #[test]
    fn unsupported_cannot_capture_a_native_channel_source() {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        assert!(matches!(
            CapturedSourceBinding::capture(store, "native-environment"),
            Err(ChannelError::Unsupported)
        ));
    }
}
