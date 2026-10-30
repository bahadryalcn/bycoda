//! Selected-profile, private on-demand projection observations. This coordinator
//! never stops a provider, changes a writer floor or grants migration authority.
use crate::native_authority_channel::CapturedSourceBinding;
use crate::native_authority_checkpoint::{
    NativeCheckpointRound, NativeCheckpointScope, NativeProjectionReceipt,
    NativeRendererCheckpoints,
};
use crate::native_authority_pipe::PipeCancellation;
use crate::native_window_lifecycle::{self, NativeCheckpointWindow};
use crate::session_store::host_notes_fence::{
    CapturedHostNotesStore, FenceGeneration, HostNotesFenceOwner,
};
use crate::session_store::native_raw_capture::{
    RawCaptureArtifact, RawCaptureDescriptor, RawCaptureReceipt,
};
use crate::session_store::window_barrier::target::ClosedTargetAdmission;
use crate::session_store::window_barrier::WindowBarrier;
use crate::session_store::write_receipts::NativeProjectionWriteClaim;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const LIFETIME: Duration = Duration::from_secs(30);
const MAX_PREPARES: usize = 4;
const MAX_RETAINED: usize = 256;
const MISSING: [&str; 5] = [
    "raw-editor-buffers",
    "multi-input-provenance",
    "provider-closure",
    "producer-coverage",
    "host-notes-writer-closure",
];

fn error(code: &str) -> String {
    format!("NATIVE_PROJECTION_{code}")
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
}
fn raw_digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

#[derive(Clone)]
struct Recipient {
    window: tauri::Window,
    owner: Arc<NativeCheckpointWindow>,
    prepared: Option<Prepared>,
    nonce: Option<String>,
    verifying: bool,
    result: Option<Result<NativeProjectionReceipt, String>>,
    raw_recovery: Option<RawCaptureReceipt>,
}
#[derive(Clone)]
struct Prepared {
    comparison: String,
    raw: Option<RawCaptureArtifact>,
    raw_descriptor: RawCaptureDescriptor,
    missing: Vec<String>,
}
struct PreparedCaptureJson {
    comparison: Option<String>,
    raw_capture_json: Option<String>,
}
struct State {
    recipients: HashMap<String, Recipient>,
    cancelled: bool,
    reason: Option<String>,
    challenging: bool,
    in_flight: usize,
    round: Option<Arc<NativeCheckpointRound>>,
    release_ready: bool,
}
struct Preparation {
    id: String,
    scope: NativeCheckpointScope,
    deadline: Instant,
    state: Mutex<State>,
    changed: Condvar,
    host_notes: Arc<HostNotesFenceOwner>,
    host_generation: FenceGeneration,
}

impl Preparation {
    fn try_retire_host_notes(&self) -> Result<bool, String> {
        {
            let state = self.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            if !state.cancelled || state.in_flight != 0 || state.round.is_some() {
                return Ok(false);
            }
        }
        self.host_notes.retire_if_drained(self.host_generation)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectionObservation {
    version: u8,
    qualified: bool,
    prepare_id: String,
    status: &'static str,
    receipt_count: usize,
    missing_coverage: Vec<String>,
}

pub(crate) struct NativeProjectionCoordinator {
    app: tauri::AppHandle,
    source: CapturedSourceBinding,
    barrier: WindowBarrier,
    checkpoints: Arc<NativeRendererCheckpoints>,
    preparations: Mutex<HashMap<String, Arc<Preparation>>>,
    stopping: AtomicBool,
}

/// The actual source/SQL idle read may wait. Recheck the deadline/cancellation
/// after it, then atomically enforce both at the barrier's admission point.
/// Keep closure outside with_checked_store: failed post-binding validation must
/// not drop a closure owner after mutating admission.
pub(crate) fn close_idle_source_admission(
    source: &CapturedSourceBinding,
    barrier: &WindowBarrier,
    session: &str,
    deadline: Instant,
    cancellation: &PipeCancellation,
    stopping: &AtomicBool,
) -> Result<ClosedTargetAdmission, String> {
    let check = || {
        if cancellation.is_cancelled() || stopping.load(Ordering::Acquire) {
            return Err(error("CANCELLED"));
        }
        if Instant::now() >= deadline {
            return Err(error("EXPIRED"));
        }
        Ok(())
    };
    check()?;
    source.with_checked_store(|store| store.assert_native_execution_idle(session))?;
    check()?;
    barrier
        .try_close_idle_target_admission_before(session, deadline, || {
            cancellation.is_cancelled() || stopping.load(Ordering::Acquire)
        })
        .map_err(|error| error.to_string())
}

impl NativeProjectionCoordinator {
    pub(crate) fn new(
        app: tauri::AppHandle,
        environment: &str,
        checkpoints: Arc<NativeRendererCheckpoints>,
    ) -> Result<Self, String> {
        let source = CapturedSourceBinding::capture_managed_store(app.clone(), environment)
            .map_err(|error| error.to_string())?;
        let barrier = app
            .try_state::<WindowBarrier>()
            .ok_or_else(|| error("BARRIER_UNAVAILABLE"))?
            .inner()
            .clone();
        Ok(Self {
            app,
            source,
            barrier,
            checkpoints,
            preparations: Mutex::new(HashMap::new()),
            stopping: AtomicBool::new(false),
        })
    }

    fn idle(&self, session: &str) -> Result<(), String> {
        self.harness_idle(session)?;
        self.source
            .with_checked_store(|store| store.assert_native_execution_idle(session))
    }

    fn harness_idle(&self, session: &str) -> Result<(), String> {
        self.app
            .try_state::<crate::harness::HarnessHost>()
            .ok_or_else(|| error("HARNESS_UNAVAILABLE"))?
            .authority_idle(session)
    }

    fn check_preparation_time(
        &self,
        preparation: &Preparation,
        cancellation: &PipeCancellation,
    ) -> Result<(), String> {
        if self.stopping.load(Ordering::Acquire) || cancellation.is_cancelled() {
            return Err(error("CANCELLED"));
        }
        if Instant::now() >= preparation.deadline {
            return Err(error("EXPIRED"));
        }
        let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        if state.cancelled {
            return Err(state.reason.clone().unwrap_or_else(|| error("CANCELLED")));
        }
        Ok(())
    }

    fn record(&self, id: &str) -> Result<Arc<Preparation>, String> {
        if !uuid(id) {
            return Err(error("INVALID_PREPARE"));
        }
        self.preparations
            .lock()
            .map_err(|_| error("UNAVAILABLE"))?
            .get(id)
            .cloned()
            .ok_or_else(|| error("UNKNOWN_PREPARE"))
    }

    fn validate_window(&self, recipient: &Recipient, window: &tauri::Window) -> Result<(), String> {
        if recipient.window.label() != window.label() {
            return Err(error("WRONG_WINDOW"));
        }
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        native_window_lifecycle::with_checkpoint_resources(
            &recipient.owner,
            &window.resources_table(),
            captured.native_instance_id,
            |_, _| Ok(()),
        )
    }

    fn validate_preparation_window(
        &self,
        preparation: &Preparation,
        window: &tauri::Window,
    ) -> Result<(), String> {
        let recipient = {
            let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            state
                .recipients
                .get(window.label())
                .cloned()
                .ok_or_else(|| error("WRONG_WINDOW"))?
        };
        // Physical-owner/source checks may take their own SQL/resource locks.
        // Never nest them under the preparation's ownership mutex.
        self.validate_window(&recipient, window)
    }

    /// Invoked only by the authenticated selected-Host private source endpoint.
    pub(crate) fn observe(
        &self,
        session: &str,
        migration: &str,
        generation: u64,
        cancellation: &PipeCancellation,
    ) -> Result<Value, String> {
        if self.stopping.load(Ordering::Acquire) || cancellation.is_cancelled() {
            return Err(error("STOPPING"));
        }
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let scope =
            NativeCheckpointScope::new(&captured.environment_id, session, migration, generation)?;
        self.source.with_checked_store(|store| {
            store.renderer_checkpoint_capture_scope(&scope).map(|_| ())
        })?;
        self.idle(session)?;
        // Only clone the actual SQLite-owned file under its short SQL borrow.
        // Capture/bind does not close ingress; no capability is issued by DTO.
        let host_notes = HostNotesFenceOwner::new(vec![self
            .source
            .with_checked_store(CapturedHostNotesStore::capture)?]);
        let host_generation = host_notes.generation();
        let windows = self.app.webview_windows();
        if windows.is_empty() || windows.len() > 64 {
            return Err(error("WINDOW_CAPACITY"));
        }
        let mut recipients = HashMap::new();
        for (label, webview) in windows {
            let window = webview.as_ref().window();
            let owner = native_window_lifecycle::capture_checkpoint_resources(
                &window.resources_table(),
                captured.native_instance_id,
            )?;
            recipients.insert(
                label,
                Recipient {
                    window,
                    owner: Arc::new(owner),
                    prepared: None,
                    nonce: None,
                    verifying: false,
                    result: None,
                    raw_recovery: None,
                },
            );
        }
        let preparation = Arc::new(Preparation {
            id: uuid::Uuid::new_v4().to_string(),
            scope,
            deadline: Instant::now() + LIFETIME,
            state: Mutex::new(State {
                recipients,
                cancelled: false,
                reason: None,
                challenging: false,
                in_flight: 0,
                round: None,
                release_ready: false,
            }),
            changed: Condvar::new(),
            host_notes,
            host_generation,
        });
        {
            let mut all = self.preparations.lock().map_err(|_| error("UNAVAILABLE"))?;
            let mut active = 0;
            for record in all.values() {
                let state = record.state.lock().map_err(|_| error("UNAVAILABLE"))?;
                if !state.release_ready {
                    active += 1;
                    if record.scope.session_id == session {
                        return Err(error("SESSION_BUSY"));
                    }
                }
            }
            if active >= MAX_PREPARES {
                return Err(error("CAPACITY"));
            }
            if all.len() >= MAX_RETAINED {
                let retired = all.iter().find_map(|(id, record)| {
                    record
                        .state
                        .lock()
                        .ok()
                        .filter(|state| state.release_ready)
                        .map(|_| id.clone())
                });
                if let Some(id) = retired {
                    all.remove(&id);
                } else {
                    return Err(error("CAPACITY"));
                }
            }
            all.insert(preparation.id.clone(), preparation.clone());
        }
        let work = self.prepare_and_challenge(&preparation, cancellation);
        self.finish(&preparation, work.err())
    }

    fn payload(&self, preparation: &Preparation, recipient: &Recipient) -> Value {
        json!({ "version":1, "qualified":false, "prepareId":preparation.id,
            "environmentId":preparation.scope.environment_id, "sessionId":preparation.scope.session_id,
            "migrationId":preparation.scope.migration_id, "generation":preparation.scope.generation,
            "windowEpoch":recipient.owner.incarnation().to_string(),
            "expiresInMs":preparation.deadline.saturating_duration_since(Instant::now()).as_millis().clamp(1, 30_000) as u64 })
    }

    fn prepare_and_challenge(
        &self,
        preparation: &Preparation,
        cancellation: &PipeCancellation,
    ) -> Result<(), String> {
        self.close_host_notes_before_prepare(preparation, cancellation)?;
        self.source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let prepare_events = {
            let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            state
                .recipients
                .values()
                .map(|recipient| {
                    (
                        recipient.window.clone(),
                        self.payload(preparation, recipient),
                    )
                })
                .collect::<Vec<_>>()
        };
        // No SQL, physical-owner or preparation mutex while emitting callbacks.
        for (window, payload) in prepare_events {
            window
                .emit_to(
                    tauri::EventTarget::webview_window(window.label()),
                    "native-projection-prepare",
                    payload,
                )
                .map_err(|error| error.to_string())?;
        }
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        loop {
            if state.cancelled {
                return Err(state.reason.clone().unwrap_or_else(|| error("CANCELLED")));
            }
            if cancellation.is_cancelled() || self.stopping.load(Ordering::Acquire) {
                return Err(error("CANCELLED"));
            }
            if Instant::now() >= preparation.deadline {
                return Err(error("EXPIRED"));
            }
            if state
                .recipients
                .values()
                .all(|recipient| recipient.prepared.is_some())
            {
                break;
            }
            state = preparation
                .changed
                .wait_timeout(state, Duration::from_millis(50))
                .map_err(|_| error("UNAVAILABLE"))?
                .0;
        }
        state.challenging = true;
        let recipients = state.recipients.values().cloned().collect::<Vec<_>>();
        drop(state);
        // Ordinary producers are still open until all actual renderer captures
        // have drained. Refuse busy work atomically rather than closing over it.
        self.harness_idle(&preparation.scope.session_id)?;
        self.check_preparation_time(preparation, cancellation)?;
        let closed = close_idle_source_admission(
            &self.source,
            &self.barrier,
            &preparation.scope.session_id,
            preparation.deadline,
            cancellation,
            &self.stopping,
        )?;
        let round = match self
            .checkpoints
            .start_round(closed, preparation.scope.clone())
        {
            Ok(round) => round,
            Err(failure) => {
                self.barrier
                    .reopen_target_admission(failure.closed)
                    .map_err(|error| error.to_string())?;
                return Err(failure.message);
            }
        };
        let round = Arc::new(round);
        match preparation.state.lock() {
            Ok(mut state) => state.round = Some(Arc::clone(&round)),
            Err(poisoned) => {
                // Keep the original retirement locator even on an owner error.
                poisoned.into_inner().round = Some(Arc::clone(&round));
                return Err(error("UNAVAILABLE"));
            }
        }
        // Install every nonce before emitting any challenge. No renderer can
        // create or substitute its own round, logical target or physical owner.
        let mut challenges = Vec::new();
        for recipient in &recipients {
            self.check_preparation_time(preparation, cancellation)?;
            self.validate_window(recipient, &recipient.window)?;
            let challenge = self.checkpoints.issue_projection(
                &round,
                &recipient.window,
                preparation.deadline,
                &recipient.prepared.as_ref().unwrap().comparison,
                recipient
                    .prepared
                    .as_ref()
                    .unwrap()
                    .raw
                    .as_ref()
                    .ok_or_else(|| error("RAW_REQUIRED"))?,
            )?;
            let nonce = challenge.nonce.clone();
            let mut payload = serde_json::to_value(challenge).map_err(|error| error.to_string())?;
            payload
                .as_object_mut()
                .ok_or_else(|| error("INVALID_CHALLENGE"))?
                .insert("prepareId".into(), preparation.id.clone().into());
            challenges.push((recipient.window.clone(), nonce, payload));
        }
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        if state.cancelled {
            return Err(error("CANCELLED"));
        }
        for (window, nonce, _) in &challenges {
            state.recipients.get_mut(window.label()).unwrap().nonce = Some(nonce.clone());
        }
        state.challenging = true;
        drop(state);
        for (window, _, payload) in challenges {
            self.check_preparation_time(preparation, cancellation)?;
            let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            if state.cancelled {
                return Err(error("CANCELLED"));
            }
            drop(state);
            window
                .emit_to(
                    tauri::EventTarget::webview_window(window.label()),
                    "native-projection-challenge",
                    payload,
                )
                .map_err(|error| error.to_string())?;
        }
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        loop {
            if state.cancelled {
                return Err(state.reason.clone().unwrap_or_else(|| error("CANCELLED")));
            }
            if cancellation.is_cancelled() || self.stopping.load(Ordering::Acquire) {
                return Err(error("CANCELLED"));
            }
            if state
                .recipients
                .values()
                .all(|recipient| recipient.result.is_some())
            {
                return Ok(());
            }
            if Instant::now() >= preparation.deadline {
                return Err(error("EXPIRED"));
            }
            state = preparation
                .changed
                .wait_timeout(state, Duration::from_millis(50))
                .map_err(|_| error("UNAVAILABLE"))?
                .0;
        }
    }

    fn close_host_notes_before_prepare(
        &self,
        preparation: &Preparation,
        cancellation: &PipeCancellation,
    ) -> Result<(), String> {
        self.check_preparation_time(preparation, cancellation)?;
        preparation
            .host_notes
            .close_ingress(preparation.host_generation)?;
        loop {
            self.check_preparation_time(preparation, cancellation)?;
            {
                let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
                if state.cancelled {
                    return Err(error("CANCELLED"));
                }
            }
            if preparation
                .host_notes
                .try_drained(preparation.host_generation)?
            {
                return self.check_preparation_time(preparation, cancellation);
            }
            // Only the observation thread parks. Original fences are in the
            // issued preparation; no SQL/resource/owner mutex is held here.
            std::thread::park_timeout(Duration::from_millis(25));
        }
    }

    fn finish(&self, preparation: &Preparation, failure: Option<String>) -> Result<Value, String> {
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        state.cancelled = true; // No new verification may start after this point.
        if state.reason.is_none() {
            state.reason = failure;
        }
        // A waiter timeout/cancellation cannot retire an accepted SQL job.
        while state.in_flight != 0 {
            state = preparation
                .changed
                .wait_timeout(state, Duration::from_millis(50))
                .map_err(|_| error("UNAVAILABLE"))?
                .0;
        }
        let round = state.round.take();
        drop(state);
        if let Some(round) = round {
            let closed = match self.checkpoints.retire_round(&round) {
                Ok(closed) => closed,
                Err(failure) => {
                    // A failed retirement must not lose its original locator.
                    let mut state = preparation
                        .state
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    state.round = Some(round);
                    return Err(failure);
                }
            };
            self.barrier
                .reopen_target_admission(closed)
                .map_err(|error| error.to_string())?;
        }
        let cooperative_only = preparation
            .host_notes
            .cooperative_only(preparation.host_generation)?;
        // Observer cancellation/timeout is NOT actual Host worker retirement.
        // Retain the exact ClosingFence until every accepted writer releases.
        // No SQL/FULL/resource/preparation mutex is held during this polling.
        while !preparation.try_retire_host_notes()? {
            std::thread::park_timeout(Duration::from_millis(25));
        }
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        // Accepted SQL is settled. Keep only its original recovery locator;
        // finished preparations must release their shared raw-byte charge.
        for recipient in state.recipients.values_mut() {
            if let Some(prepared) = &mut recipient.prepared {
                prepared.raw.take();
            }
        }
        state.release_ready = true;
        let receipt_count = state
            .recipients
            .values()
            .filter(|recipient| matches!(recipient.result, Some(Ok(_))))
            .count();
        let observed = state.reason.is_none() && receipt_count == state.recipients.len();
        let status = if observed { "observed" } else { "unverified" };
        let mut missing_coverage: Vec<String> = MISSING.into_iter().map(String::from).collect();
        if cooperative_only {
            missing_coverage.push("host-notes-connection-attestation".into());
        }
        for recipient in state.recipients.values() {
            if let Some(prepared) = &recipient.prepared {
                for missing in &prepared.missing {
                    if missing_coverage.len() < 30 && !missing_coverage.contains(missing) {
                        missing_coverage.push(missing.clone());
                    }
                }
            }
        }
        if let Some(reason) = &state.reason {
            missing_coverage.push(reason.chars().take(120).collect());
        }
        let windows = state
            .recipients
            .values()
            .map(|recipient| recipient.window.clone())
            .collect::<Vec<_>>();
        drop(state);
        for window in windows {
            let _ = window.emit_to(
                tauri::EventTarget::webview_window(window.label()),
                "native-projection-finished",
                json!({ "version":1,"qualified":false,"prepareId":preparation.id,"status":status }),
            );
        }
        serde_json::to_value(ProjectionObservation {
            version: 1,
            qualified: false,
            prepare_id: preparation.id.clone(),
            status,
            receipt_count,
            missing_coverage,
        })
        .map_err(|error| error.to_string())
    }

    fn prepared(
        &self,
        window: &tauri::Window,
        id: &str,
        epoch: &str,
        status: &str,
        capture: PreparedCaptureJson,
        missing: Vec<String>,
    ) -> Result<(), String> {
        let PreparedCaptureJson {
            comparison,
            raw_capture_json,
        } = capture;
        if missing.len() > 32
            || missing.iter().any(|value| {
                value.is_empty() || value.len() > 512 || value.chars().any(char::is_control)
            })
        {
            return Err(error("INVALID_COVERAGE"));
        }
        let preparation = self.record(id)?;
        self.validate_preparation_window(&preparation, window)?;
        // Validate the issued physical recipient before reserving/parsing raw
        // data, then repeat it after parsing without holding the state lock.
        {
            let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            if state.cancelled || state.challenging || Instant::now() >= preparation.deadline {
                return Err(error("PREPARATION_CLOSED"));
            }
            let recipient = state
                .recipients
                .get(window.label())
                .ok_or_else(|| error("WRONG_WINDOW"))?;
            if recipient.owner.incarnation().to_string() != epoch || recipient.prepared.is_some() {
                return Err(error("STALE_PREPARE"));
            }
        }
        let prepared = if status == "prepared" {
            let comparison = comparison.ok_or_else(|| error("COMPARISON_REQUIRED"))?;
            let claim = NativeProjectionWriteClaim::parse(&comparison)?;
            if claim.session_id() != preparation.scope.session_id {
                return Err(error("WRONG_SCOPE"));
            }
            let raw = RawCaptureArtifact::parse(
                raw_capture_json.ok_or_else(|| error("RAW_REQUIRED"))?,
                &preparation.scope.session_id,
            )?;
            let raw_descriptor = raw.descriptor(&raw_digest(comparison.as_bytes()))?;
            Some(Prepared {
                comparison,
                raw: Some(raw),
                raw_descriptor,
                missing,
            })
        } else {
            if !["busy", "unverified"].contains(&status)
                || comparison.is_some()
                || raw_capture_json.is_some()
            {
                return Err(error("INVALID_STATUS"));
            }
            None
        };
        self.validate_preparation_window(&preparation, window)?;
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        if state.cancelled || state.challenging || Instant::now() >= preparation.deadline {
            return Err(error("PREPARATION_CLOSED"));
        }
        let retained_bytes: usize = state
            .recipients
            .values()
            .filter_map(|recipient| recipient.prepared.as_ref())
            .filter_map(|prepared| prepared.raw.as_ref())
            .map(|raw| raw.raw().len())
            .sum();
        if prepared
            .as_ref()
            .and_then(|prepared| prepared.raw.as_ref())
            .is_some_and(|raw| retained_bytes.saturating_add(raw.raw().len()) > 32 * 1024 * 1024)
        {
            return Err(error("RAW_ROUND_CAPACITY"));
        }
        let recipient = state
            .recipients
            .get_mut(window.label())
            .ok_or_else(|| error("WRONG_WINDOW"))?;
        if recipient.owner.incarnation().to_string() != epoch || recipient.prepared.is_some() {
            return Err(error("STALE_PREPARE"));
        }
        if status != "prepared" {
            state.cancelled = true;
            state.reason = Some(error(if status == "busy" {
                "RENDERER_BUSY"
            } else {
                "RENDERER_UNVERIFIED"
            }));
        } else {
            recipient.prepared = prepared;
        }
        preparation.changed.notify_all();
        Ok(())
    }

    pub(crate) fn verify(
        &self,
        window: &tauri::Window,
        id: &str,
        nonce: &str,
        comparison: &str,
        raw_capture_json: &str,
    ) -> Result<NativeProjectionReceipt, String> {
        if comparison.len() > 2 * 1024 * 1024 {
            return Err(error("COMPARISON_CAPACITY"));
        }
        if raw_capture_json.len() > 16 * 1024 * 1024 {
            return Err(error("RAW_CAPACITY"));
        }
        let preparation = self.record(id)?;
        self.validate_preparation_window(&preparation, window)?;
        let raw = {
            let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            if state.cancelled || !state.challenging || Instant::now() >= preparation.deadline {
                return Err(error("PREPARATION_CLOSED"));
            }
            let recipient = state
                .recipients
                .get_mut(window.label())
                .ok_or_else(|| error("WRONG_WINDOW"))?;
            if recipient.nonce.as_deref() != Some(nonce)
                || recipient
                    .prepared
                    .as_ref()
                    .map(|prepared| prepared.comparison.as_str())
                    != Some(comparison)
            {
                return Err(error("CONFLICT"));
            }
            if recipient.verifying || recipient.result.is_some() {
                return Err(error("ALREADY_CONSUMED"));
            }
            let raw = recipient
                .prepared
                .as_ref()
                .and_then(|prepared| prepared.raw.as_ref())
                .ok_or_else(|| error("RAW_REQUIRED"))?;
            if raw.raw() != raw_capture_json {
                return Err(error("RAW_CONFLICT"));
            }
            let raw = raw.clone();
            recipient.verifying = true;
            state.in_flight += 1;
            raw
        };
        let result = self
            .checkpoints
            .projection_checkpoint(window, nonce, comparison, &raw);
        // Capture the original locator before waking finish/retire_round.
        // A recovery read never changes the projection's success/error result.
        let recovery = match &result {
            Ok(receipt) => receipt.raw_capture.clone(),
            Err(_) => self
                .checkpoints
                .projection_raw_recovery_binding(nonce)
                .ok()
                .flatten(),
        };
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        let recipient = state
            .recipients
            .get_mut(window.label())
            .ok_or_else(|| error("WRONG_WINDOW"))?;
        recipient.verifying = false;
        recipient.result = Some(result.clone());
        recipient.raw_recovery = recovery;
        state.in_flight -= 1;
        preparation.changed.notify_all();
        result
    }

    pub(crate) fn raw_status(
        &self,
        window: &tauri::Window,
        id: &str,
        nonce: &str,
        comparison: &str,
        raw_capture_json: &str,
    ) -> Result<Value, String> {
        if comparison.len() > 2 * 1024 * 1024 || raw_capture_json.len() > 16 * 1024 * 1024 {
            return Err(error("RAW_CAPACITY"));
        }
        let preparation = self.record(id)?;
        self.validate_preparation_window(&preparation, window)?;
        let (owner, expected) = {
            let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            let recipient = state
                .recipients
                .get(window.label())
                .ok_or_else(|| error("WRONG_WINDOW"))?;
            let prepared = recipient
                .prepared
                .as_ref()
                .ok_or_else(|| error("RAW_REQUIRED"))?;
            if recipient.nonce.as_deref() != Some(nonce)
                || prepared.comparison != comparison
                || prepared.raw_descriptor.sha256 != raw_digest(raw_capture_json.as_bytes())
                || prepared.raw_descriptor.byte_length != raw_capture_json.len() as u64
                || prepared.raw_descriptor.comparison_sha256 != raw_digest(comparison.as_bytes())
            {
                return Err(error("RAW_CONFLICT"));
            }
            if recipient.verifying {
                return Ok(json!({"version":1,"qualified":false,"status":"pending"}));
            }
            (recipient.owner.clone(), recipient.raw_recovery.clone())
        };
        let Some(expected) = expected else {
            return Ok(json!({"version":1,"qualified":false,"status":"unknown"}));
        };
        // No preparation lock while obtaining physical-owner and SQL guards.
        let receipt = self.checkpoints.read_projection_raw(&owner, &expected)?;
        self.validate_preparation_window(&preparation, window)?;
        {
            let state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
            let recipient = state
                .recipients
                .get(window.label())
                .ok_or_else(|| error("WRONG_WINDOW"))?;
            if recipient.nonce.as_deref() != Some(nonce)
                || recipient.raw_recovery.as_ref() != Some(&expected)
            {
                return Err(error("RAW_CONFLICT"));
            }
        }
        Ok(json!({"version":1,"qualified":false,"status":"retained","receipt":receipt}))
    }

    pub(crate) fn release(
        &self,
        window: &tauri::Window,
        id: &str,
        reason: &str,
    ) -> Result<bool, String> {
        if reason.len() > 4096 {
            return Err(error("INVALID_REASON"));
        }
        let preparation = self.record(id)?;
        self.validate_preparation_window(&preparation, window)?;
        let mut state = preparation.state.lock().map_err(|_| error("UNAVAILABLE"))?;
        state.cancelled = true;
        if state.reason.is_none() {
            state.reason = Some(error("RENDERER_RELEASE"));
        }
        preparation.changed.notify_all();
        Ok(state.release_ready)
    }

    pub(crate) fn shutdown(&self) {
        self.stopping.store(true, Ordering::Release);
        if let Ok(all) = self.preparations.lock() {
            for preparation in all.values() {
                if let Ok(mut state) = preparation.state.lock() {
                    state.cancelled = true;
                }
                preparation.changed.notify_all();
            }
        }
    }
}

#[tauri::command(async)]
pub(crate) fn native_projection_checkpoint_prepared(
    window: tauri::Window,
    prepare_id: String,
    window_epoch: String,
    status: String,
    comparison_json: Option<String>,
    raw_capture_json: Option<String>,
    missing_coverage: Vec<String>,
) -> Result<(), String> {
    crate::native_authority_runtime::projection_coordinator(window.app_handle())?.prepared(
        &window,
        &prepare_id,
        &window_epoch,
        &status,
        PreparedCaptureJson {
            comparison: comparison_json,
            raw_capture_json,
        },
        missing_coverage,
    )
}
#[tauri::command(async)]
pub(crate) fn native_projection_checkpoint_verify(
    window: tauri::Window,
    prepare_id: String,
    nonce: String,
    comparison_json: String,
    raw_capture_json: String,
) -> Result<NativeProjectionReceipt, String> {
    crate::native_authority_runtime::projection_coordinator(window.app_handle())?.verify(
        &window,
        &prepare_id,
        &nonce,
        &comparison_json,
        &raw_capture_json,
    )
}

#[tauri::command(async)]
pub(crate) fn native_projection_checkpoint_raw_status(
    window: tauri::Window,
    prepare_id: String,
    nonce: String,
    comparison_json: String,
    raw_capture_json: String,
) -> Result<Value, String> {
    crate::native_authority_runtime::projection_coordinator(window.app_handle())?.raw_status(
        &window,
        &prepare_id,
        &nonce,
        &comparison_json,
        &raw_capture_json,
    )
}
#[tauri::command(async)]
pub(crate) fn native_projection_checkpoint_release(
    window: tauri::Window,
    prepare_id: String,
    reason: String,
) -> Result<Value, String> {
    crate::native_authority_runtime::projection_coordinator(window.app_handle())?
        .release(&window, &prepare_id, &reason)
        .map(|ready| json!({"releaseReady":ready}))
}

#[cfg(all(test, windows))]
#[path = "native_projection_coordinator/host_notes_tests.rs"]
mod host_notes_tests;
