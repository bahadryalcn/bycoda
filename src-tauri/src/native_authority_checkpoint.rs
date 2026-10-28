//! Native-created, exact-Window receipts for already committed SQL rows.
//! This does not attest renderer application, mounted producers, provider output,
//! supported actors or a complete cohort. There is deliberately no promotion API.
#![allow(dead_code)] // Private coordinator begins rounds; IPC only consumes them.

use crate::native_authority_channel::CapturedSourceBinding;
use crate::native_window_lifecycle::{self, NativeCheckpointWindow};
use crate::session_store::window_barrier::target::ClosedTargetAdmission;
use crate::session_store::window_barrier::{NativeLane, WindowBarrier};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, ResourceTable};

const MAX_ROUNDS: usize = 4;
const MAX_WINDOWS: usize = 64;
const MAX_CHALLENGES: usize = 256;
const MAX_LIFETIME: Duration = Duration::from_secs(30);
const MAX_SAFE: u64 = 9_007_199_254_740_991;
static ACTIVE_CALLS: AtomicUsize = AtomicUsize::new(0);
struct CallPermit<'a>(&'a AtomicUsize);
impl Drop for CallPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
        ACTIVE_CALLS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn failure(code: &str) -> String {
    format!("NATIVE_CHECKPOINT_{code}")
}
fn identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}
fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn valid_nonce(value: &str) -> bool {
    value.len() == 36
        && uuid::Uuid::parse_str(value)
            .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
}

#[derive(Clone)]
pub(crate) struct NativeCheckpointScope {
    pub(crate) environment_id: String,
    pub(crate) session_id: String,
    pub(crate) migration_id: String,
    pub(crate) generation: u64,
}
impl NativeCheckpointScope {
    pub(crate) fn new(
        environment: &str,
        session: &str,
        migration: &str,
        generation: u64,
    ) -> Result<Self, String> {
        if ![environment, session, migration]
            .into_iter()
            .all(identifier)
            || generation > MAX_SAFE
        {
            return Err(failure("INVALID_SCOPE"));
        }
        Ok(Self {
            environment_id: environment.into(),
            session_id: session.into(),
            migration_id: migration.into(),
            generation,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ExpectedSqlBlob {
    Absent,
    Present { sha256: String },
}
impl ExpectedSqlBlob {
    fn valid(&self) -> bool {
        match self {
            Self::Absent => true,
            Self::Present { sha256 } => digest(sha256),
        }
    }
    pub(crate) fn matches(&self, value: &Option<String>) -> bool {
        match (self, value) {
            (Self::Absent, None) => true,
            (Self::Present { sha256 }, Some(value)) => sha256 == value,
            _ => false,
        }
    }
}

/// Caller comparisons only, never an applied-output or producer-complete proof.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeCheckpointExpectation {
    pub(crate) revision: i64,
    pub(crate) updated_at: i64,
    pub(crate) transcript_sha256: String,
    pub(crate) draft: ExpectedSqlBlob,
    pub(crate) queue: ExpectedSqlBlob,
}
impl NativeCheckpointExpectation {
    pub(crate) fn fingerprint(&self) -> Result<String, String> {
        if self.revision < 0
            || self.revision as u64 > MAX_SAFE
            || self.updated_at < 0
            || self.updated_at as u64 > MAX_SAFE
            || !digest(&self.transcript_sha256)
            || !self.draft.valid()
            || !self.queue.valid()
        {
            return Err(failure("INVALID_EXPECTATION"));
        }
        serde_json::to_vec(self)
            .map(|bytes| hash(&bytes))
            .map_err(|_| failure("INVALID_EXPECTATION"))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeRendererChallenge {
    version: u8,
    qualified: bool,
    pub(crate) nonce: String,
    round_id: String,
    environment_id: String,
    session_id: String,
    migration_id: String,
    generation: u64,
    window_epoch: String,
    expires_in_ms: u64,
}

/// Structural lack of a provider seal: there is no Sealed/Qualified variant.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderOutputCheckpoint {
    Unsealed,
}

/// Literal false on the wire, including when reading a retained SQL receipt.
/// A corrupt or supplied `qualified:true` value cannot instantiate this type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CheckpointUnqualified;
impl Serialize for CheckpointUnqualified {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(false)
    }
}
impl<'de> Deserialize<'de> for CheckpointUnqualified {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if bool::deserialize(deserializer)? {
            return Err(serde::de::Error::custom(
                "Native checkpoint qualification is unavailable",
            ));
        }
        Ok(Self)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeSqlCheckpointReceipt {
    pub(crate) version: u8,
    pub(crate) qualified: CheckpointUnqualified,
    pub(crate) provider_output: ProviderOutputCheckpoint,
    pub(crate) nonce: String,
    pub(crate) service_epoch: String,
    pub(crate) round_id: String,
    pub(crate) window_epoch: String,
    pub(crate) native_store_instance: String,
    pub(crate) environment_id: String,
    pub(crate) source_store_id: String,
    pub(crate) source_profile_id: String,
    pub(crate) session_id: String,
    pub(crate) migration_id: String,
    pub(crate) generation: u64,
    pub(crate) revision: i64,
    pub(crate) updated_at: i64,
    pub(crate) transcript_sha256: String,
    pub(crate) draft_sha256: Option<String>,
    pub(crate) queue_sha256: Option<String>,
}

pub(crate) struct NativeCheckpointCommit<'a> {
    pub(crate) nonce: &'a str,
    pub(crate) service_epoch: &'a str,
    pub(crate) round_id: &'a str,
    pub(crate) window_epoch: &'a str,
    pub(crate) scope: &'a NativeCheckpointScope,
    pub(crate) expected: &'a NativeCheckpointExpectation,
    pub(crate) fingerprint: &'a str,
}

/// Not Deserialize: only the Native owner can attach a receipt to this round.
#[derive(Debug)]
pub(crate) struct NativeCheckpointRound {
    id: String,
}
pub(crate) struct NativeCheckpointStartError {
    pub(crate) message: String,
    pub(crate) closed: ClosedTargetAdmission,
}
impl std::fmt::Debug for NativeCheckpointStartError {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.message.fmt(output)
    }
}
struct Round {
    id: String,
    scope: NativeCheckpointScope,
    closed: ClosedTargetAdmission,
}
enum Outcome {
    Pending,
    Running {
        fingerprint: String,
    },
    Committed {
        fingerprint: String,
        receipt: NativeSqlCheckpointReceipt,
    },
    Failed {
        fingerprint: String,
        candidate: NativeSqlCheckpointReceipt,
    },
}
struct Entry {
    round_id: String,
    window: Arc<NativeCheckpointWindow>,
    expires: Instant,
    outcome: Outcome,
}
#[derive(Default)]
struct Ledger {
    closed: bool,
    rounds: HashMap<String, Arc<Round>>,
    entries: HashMap<String, Entry>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum NativeCheckpointStatus {
    Unknown,
    Pending,
    Expired,
    Failed,
    Committed {
        receipt: Box<NativeSqlCheckpointReceipt>,
    },
}

pub(crate) struct NativeRendererCheckpoints {
    source: CapturedSourceBinding,
    barrier: WindowBarrier,
    epoch: String,
    ledger: Mutex<Ledger>,
    calls: AtomicUsize,
}
impl NativeRendererCheckpoints {
    pub(crate) fn capture_managed(
        app: &tauri::AppHandle,
        environment: &str,
    ) -> Result<Self, String> {
        let source = CapturedSourceBinding::capture_managed_store(app.clone(), environment)
            .map_err(|error| error.to_string())?;
        let barrier = app
            .try_state::<WindowBarrier>()
            .ok_or_else(|| failure("BARRIER_UNAVAILABLE"))?
            .inner()
            .clone();
        Self::new(source, barrier)
    }
    pub(crate) fn new(
        source: CapturedSourceBinding,
        barrier: WindowBarrier,
    ) -> Result<Self, String> {
        source.checked_source().map_err(|error| error.to_string())?;
        Ok(Self {
            source,
            barrier,
            epoch: uuid::Uuid::new_v4().to_string(),
            ledger: Mutex::new(Ledger::default()),
            calls: AtomicUsize::new(0),
        })
    }
    fn admit_call(&self) -> Result<CallPermit<'_>, String> {
        if ACTIVE_CALLS
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < 32).then_some(value + 1)
            })
            .is_err()
        {
            return Err(failure("CALL_CAPACITY"));
        }
        if self
            .calls
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < 8).then_some(value + 1)
            })
            .is_err()
        {
            ACTIVE_CALLS.fetch_sub(1, Ordering::AcqRel);
            return Err(failure("CALL_CAPACITY"));
        }
        Ok(CallPermit(&self.calls))
    }

    /// No IPC begin: an actual native coordinator must already own this exact
    /// closure. This method never closes ordinary work or changes a source floor.
    fn validate_new_round(
        &self,
        closed: &ClosedTargetAdmission,
        scope: &NativeCheckpointScope,
    ) -> Result<(), String> {
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        if captured.environment_id != scope.environment_id
            || closed.session_id() != scope.session_id
            || closed.windows().is_empty()
            || closed.windows().len() > MAX_WINDOWS
        {
            return Err(failure("WRONG_SCOPE"));
        }
        self.barrier
            .with_target_checkpoint_scope(closed, &closed.windows()[0], |_| {
                self.source
                    .with_checked_store(|store| store.renderer_checkpoint_validate_scope(scope))
            })
            .map_err(|error| error.to_string())??;
        Ok(())
    }
    pub(crate) fn start_round(
        &self,
        closed: ClosedTargetAdmission,
        scope: NativeCheckpointScope,
    ) -> Result<NativeCheckpointRound, NativeCheckpointStartError> {
        if let Err(message) = self.validate_new_round(&closed, &scope) {
            return Err(NativeCheckpointStartError { message, closed });
        }
        let mut ledger = match self.ledger.lock() {
            Ok(ledger) => ledger,
            Err(_) => {
                return Err(NativeCheckpointStartError {
                    message: failure("UNAVAILABLE"),
                    closed,
                })
            }
        };
        if ledger.closed || ledger.rounds.len() >= MAX_ROUNDS {
            return Err(NativeCheckpointStartError {
                message: failure(if ledger.closed { "CLOSED" } else { "CAPACITY" }),
                closed,
            });
        }
        let id = uuid::Uuid::new_v4().to_string();
        ledger.rounds.insert(
            id.clone(),
            Arc::new(Round {
                id: id.clone(),
                scope,
                closed,
            }),
        );
        Ok(NativeCheckpointRound { id })
    }

    pub(crate) fn issue(
        &self,
        round: &NativeCheckpointRound,
        window: &tauri::Window,
        lifetime: Duration,
    ) -> Result<NativeRendererChallenge, String> {
        self.issue_resources(round, &window.resources_table(), lifetime)
    }
    fn issue_resources(
        &self,
        round: &NativeCheckpointRound,
        resources: &ResourceTable,
        lifetime: Duration,
    ) -> Result<NativeRendererChallenge, String> {
        if lifetime.is_zero() || lifetime > MAX_LIFETIME {
            return Err(failure("INVALID_DEADLINE"));
        }
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let owner = native_window_lifecycle::capture_checkpoint_resources(
            resources,
            captured.native_instance_id,
        )?;
        let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        if ledger.closed {
            return Err(failure("CLOSED"));
        }
        let actual = ledger
            .rounds
            .get(&round.id)
            .ok_or_else(|| failure("WRONG_ROUND"))?;
        native_window_lifecycle::with_checkpoint_resources(
            &owner,
            resources,
            captured.native_instance_id,
            |barrier, token| {
                barrier
                    .with_target_checkpoint_scope(&actual.closed, token, |_| ())
                    .map_err(|error| error.to_string())
            },
        )?;
        if ledger.entries.len() >= MAX_CHALLENGES {
            return Err(failure("CAPACITY"));
        }
        let challenge = NativeRendererChallenge {
            version: 1,
            qualified: false,
            nonce: uuid::Uuid::new_v4().to_string(),
            round_id: round.id.clone(),
            environment_id: actual.scope.environment_id.clone(),
            session_id: actual.scope.session_id.clone(),
            migration_id: actual.scope.migration_id.clone(),
            generation: actual.scope.generation,
            window_epoch: owner.incarnation().to_string(),
            expires_in_ms: lifetime.as_millis() as u64,
        };
        ledger.entries.insert(
            challenge.nonce.clone(),
            Entry {
                round_id: round.id.clone(),
                window: Arc::new(owner),
                expires: Instant::now() + lifetime,
                outcome: Outcome::Pending,
            },
        );
        Ok(challenge)
    }

    pub(crate) fn checkpoint(
        &self,
        window: &tauri::Window,
        nonce: &str,
        expected: NativeCheckpointExpectation,
    ) -> Result<NativeSqlCheckpointReceipt, String> {
        self.checkpoint_resources(&window.resources_table(), nonce, expected)
    }
    fn checkpoint_resources(
        &self,
        resources: &ResourceTable,
        nonce: &str,
        expected: NativeCheckpointExpectation,
    ) -> Result<NativeSqlCheckpointReceipt, String> {
        let _call = self.admit_call()?;
        if !valid_nonce(nonce) {
            return Err(failure("INVALID_CHALLENGE"));
        }
        let fingerprint = expected.fingerprint()?;
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let (round, owner, operation) = {
            let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
            if ledger.closed {
                return Err(failure("CLOSED"));
            }
            let entry = ledger
                .entries
                .get(nonce)
                .ok_or_else(|| failure("UNKNOWN_CHALLENGE"))?;
            let round = ledger
                .rounds
                .get(&entry.round_id)
                .cloned()
                .ok_or_else(|| failure("WRONG_ROUND"))?;
            let admission = native_window_lifecycle::with_checkpoint_resources(
                &entry.window,
                resources,
                captured.native_instance_id,
                |barrier, token| {
                    barrier
                        .with_target_checkpoint_scope(&round.closed, token, |_| ())
                        .map_err(|error| error.to_string())?;
                    match &entry.outcome {
                        Outcome::Committed {
                            fingerprint: prior,
                            receipt,
                        } => {
                            if prior != &fingerprint {
                                return Err(failure("CONFLICT"));
                            }
                            let recovered = barrier
                                .with_target_checkpoint_scope(&round.closed, token, |_| {
                                    self.recover_committed(nonce, &fingerprint, receipt.clone())
                                })
                                .map_err(|error| error.to_string())??;
                            return Ok(Err(recovered));
                        }
                        Outcome::Running { fingerprint: prior }
                        | Outcome::Failed {
                            fingerprint: prior, ..
                        } => {
                            return Err(failure(if prior != &fingerprint {
                                "CONFLICT"
                            } else {
                                "ALREADY_CONSUMED"
                            }));
                        }
                        Outcome::Pending => {}
                    }
                    if Instant::now() >= entry.expires {
                        return Err(failure("EXPIRED"));
                    }
                    barrier
                        .begin_target_checkpoint(&round.closed, token, NativeLane::Persistence)
                        .map(Ok)
                        .map_err(|error| error.to_string())
                },
            )?;
            let operation = match admission {
                Err(receipt) => return Ok(receipt),
                Ok(operation) => operation,
            };
            let owner = entry.window.clone();
            ledger.entries.get_mut(nonce).unwrap().outcome = Outcome::Running {
                fingerprint: fingerprint.clone(),
            };
            (round, owner, operation)
        };
        // Accepted ownership is retained until this actual local SQL transaction
        // settles. Cancellation/shutdown never releases it on a waiter deadline.
        let result = native_window_lifecycle::with_checkpoint_resources(
            &owner,
            resources,
            captured.native_instance_id,
            |barrier, token| {
                barrier
                    .with_target_checkpoint_scope(&round.closed, token, |_| {
                        self.source.with_checked_store(|store| {
                            store.renderer_checkpoint_commit(NativeCheckpointCommit {
                                nonce,
                                service_epoch: &self.epoch,
                                round_id: &round.id,
                                window_epoch: &owner.incarnation().to_string(),
                                scope: &round.scope,
                                expected: &expected,
                                fingerprint: &fingerprint,
                            })
                        })
                    })
                    .map_err(|error| error.to_string())?
            },
        );
        let result = operation.finish(result).map_err(|error| error.to_string());
        let candidate = NativeSqlCheckpointReceipt {
            version: 1,
            qualified: CheckpointUnqualified,
            provider_output: ProviderOutputCheckpoint::Unsealed,
            nonce: nonce.into(),
            service_epoch: self.epoch.clone(),
            round_id: round.id.clone(),
            window_epoch: owner.incarnation().to_string(),
            native_store_instance: captured.native_instance_id.to_string(),
            environment_id: round.scope.environment_id.clone(),
            source_store_id: captured.identity.source_store_id.clone(),
            source_profile_id: captured.identity.source_profile_id.clone(),
            session_id: round.scope.session_id.clone(),
            migration_id: round.scope.migration_id.clone(),
            generation: round.scope.generation,
            revision: expected.revision,
            updated_at: expected.updated_at,
            transcript_sha256: expected.transcript_sha256.clone(),
            draft_sha256: match &expected.draft {
                ExpectedSqlBlob::Absent => None,
                ExpectedSqlBlob::Present { sha256 } => Some(sha256.clone()),
            },
            queue_sha256: match &expected.queue {
                ExpectedSqlBlob::Absent => None,
                ExpectedSqlBlob::Present { sha256 } => Some(sha256.clone()),
            },
        };
        let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        if let Some(entry) = ledger.entries.get_mut(nonce) {
            entry.outcome = match &result {
                Ok(receipt) => Outcome::Committed {
                    fingerprint,
                    receipt: receipt.clone(),
                },
                Err(_) => Outcome::Failed {
                    fingerprint,
                    candidate,
                },
            };
        }
        result
    }

    fn recover_committed(
        &self,
        nonce: &str,
        fingerprint: &str,
        expected: NativeSqlCheckpointReceipt,
    ) -> Result<NativeSqlCheckpointReceipt, String> {
        self.source.with_checked_store(|store| {
            store.renderer_checkpoint_read(nonce, fingerprint, &expected)
        })
    }

    pub(crate) fn status(
        &self,
        window: &tauri::Window,
        nonce: &str,
    ) -> Result<NativeCheckpointStatus, String> {
        self.status_resources(&window.resources_table(), nonce)
    }
    fn status_resources(
        &self,
        resources: &ResourceTable,
        nonce: &str,
    ) -> Result<NativeCheckpointStatus, String> {
        let _call = self.admit_call()?;
        if !valid_nonce(nonce) {
            return Err(failure("INVALID_CHALLENGE"));
        }
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        let Some(entry) = ledger.entries.get(nonce) else {
            return Ok(NativeCheckpointStatus::Unknown);
        };
        let round = ledger
            .rounds
            .get(&entry.round_id)
            .ok_or_else(|| failure("WRONG_ROUND"))?;
        native_window_lifecycle::with_checkpoint_resources(
            &entry.window,
            resources,
            captured.native_instance_id,
            |barrier, token| {
                barrier
                    .with_target_checkpoint_scope(&round.closed, token, |_| match &entry.outcome {
                        Outcome::Committed {
                            fingerprint,
                            receipt,
                        } => self
                            .recover_committed(nonce, fingerprint, receipt.clone())
                            .map(|receipt| NativeCheckpointStatus::Committed {
                                receipt: Box::new(receipt),
                            }),
                        Outcome::Failed {
                            fingerprint,
                            candidate,
                        } => match self.recover_committed(nonce, fingerprint, candidate.clone()) {
                            Ok(receipt) => Ok(NativeCheckpointStatus::Committed {
                                receipt: Box::new(receipt),
                            }),
                            Err(error) if error == "NATIVE_CHECKPOINT_RECEIPT_MISSING" => {
                                Ok(NativeCheckpointStatus::Failed)
                            }
                            Err(error) => Err(error),
                        },
                        Outcome::Running { .. } => Ok(NativeCheckpointStatus::Pending),
                        Outcome::Pending if Instant::now() >= entry.expires => {
                            Ok(NativeCheckpointStatus::Expired)
                        }
                        Outcome::Pending => Ok(NativeCheckpointStatus::Pending),
                    })
                    .map_err(|error| error.to_string())?
            },
        )
    }

    pub(crate) fn retire_round(
        &self,
        round: &NativeCheckpointRound,
    ) -> Result<ClosedTargetAdmission, String> {
        let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        if ledger.entries.values().any(|entry| {
            entry.round_id == round.id && matches!(entry.outcome, Outcome::Running { .. })
        }) {
            return Err(failure("PENDING"));
        }
        let actual = ledger
            .rounds
            .get(&round.id)
            .ok_or_else(|| failure("WRONG_ROUND"))?;
        if Arc::strong_count(actual) != 1 {
            return Err(failure("PENDING"));
        }
        let actual = ledger.rounds.remove(&round.id).unwrap();
        ledger.entries.retain(|_, entry| entry.round_id != round.id);
        Arc::try_unwrap(actual)
            .map(|round| round.closed)
            .map_err(|_| failure("PENDING"))
    }
    pub(crate) fn shutdown(&self) {
        if let Ok(mut ledger) = self.ledger.lock() {
            ledger.closed = true;
        }
        // Actual admitted SQL work and exact closure owners stay retained.
    }
}

#[tauri::command(async)]
pub(crate) fn native_renderer_checkpoint(
    window: tauri::Window,
    nonce: String,
    expected: NativeCheckpointExpectation,
) -> Result<NativeSqlCheckpointReceipt, String> {
    crate::native_authority_runtime::renderer_checkpoints(window.app_handle())?
        .checkpoint(&window, &nonce, expected)
}
#[tauri::command(async)]
pub(crate) fn native_renderer_checkpoint_status(
    window: tauri::Window,
    nonce: String,
) -> Result<NativeCheckpointStatus, String> {
    crate::native_authority_runtime::renderer_checkpoints(window.app_handle())?
        .status(&window, &nonce)
}

#[cfg(all(test, windows))]
#[path = "native_authority_checkpoint_tests.rs"]
mod tests;
