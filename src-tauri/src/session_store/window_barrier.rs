//! A native-owned barrier for one process's registered windows and native writes.
//!
//! This is deliberately not a complete writer inventory or a renderer flush proof.
//! Callers must register actual native window incarnations, instrument every native
//! write before taking database locks, and run native checkpoints after admission
//! closes. Renderer drafts that have not reached native code remain outside this
//! primitive. No type here is an IPC DTO or grants authority to migrate a store.
#![allow(dead_code)] // Native lifecycle integration is owned by the coordinator.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

#[path = "window_target_barrier.rs"]
pub(crate) mod target;

const MAX_WINDOWS: usize = 256;
const MAX_LABEL_BYTES: usize = 256;
const MAX_OPERATIONS: usize = 2048;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeLane {
    Persistence,
    Buffers,
}

impl NativeLane {
    fn index(self) -> usize {
        match self {
            Self::Persistence => 0,
            Self::Buffers => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BarrierError {
    Unavailable,
    InvalidWindowLabel,
    InvalidSessionScope,
    UnknownWindow,
    StaleWindow,
    ForeignToken,
    AdmissionClosed,
    AdmissionAlreadyClosed,
    StaleAdmission,
    CapacityExceeded,
    CounterExhausted,
    UnfinishedNativeOperation,
    FailedNativeOperation,
    PendingNativeOperations,
    MissingNativeCheckpoint,
    PendingNativeWindow,
    UnexpectedWindowAdmission,
    UnattributedWindowDestruction,
    UnattributedNativeOperation,
    EmptyWindowRoster,
    StaleProof,
}

impl fmt::Display for BarrierError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NATIVE_WINDOW_BARRIER_{self:?}")
    }
}

impl std::error::Error for BarrierError {}

#[derive(Debug)]
pub(crate) enum TrackedWriteError<E> {
    Operation(E),
    Barrier(BarrierError),
}

impl<E: fmt::Display> fmt::Display for TrackedWriteError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Operation(error) => error.fmt(f),
            Self::Barrier(error) => error.fmt(f),
        }
    }
}

/// Native-only handle for an exact window incarnation. A reused label is a new
/// incarnation. Tokens from another barrier cannot be used, even with equal IDs.
#[derive(Clone)]
pub(crate) struct WindowToken {
    owner: Weak<Mutex<State>>,
    label: String,
    incarnation: u64,
}

impl WindowToken {
    pub(crate) fn label(&self) -> &str {
        &self.label
    }
}

/// An unforgeable-in-IPC admission closure. A lifecycle change invalidates its
/// roster, but the owner can still cancel this exact closure before source fencing.
pub(crate) struct ClosedAdmission {
    owner: Weak<Mutex<State>>,
    round: u64,
    roster_epoch: u64,
    windows: Vec<WindowToken>,
}

impl ClosedAdmission {
    pub(crate) fn windows(&self) -> &[WindowToken] {
        &self.windows
    }
}

/// Evidence only of the registered native roster and instrumented native writes.
/// It is private, nonserializable, and must be revalidated while consuming it.
pub(crate) struct NativeIdleProof {
    owner: Weak<Mutex<State>>,
    round: u64,
    epoch: u64,
    roster: Vec<(String, u64)>,
}

#[derive(Clone)]
pub(crate) struct WindowBarrier {
    state: Arc<Mutex<State>>,
}

struct WindowState {
    incarnation: u64,
    created: bool,
    checkpoints: [Option<u64>; 2],
}

struct Operation {
    owner: OperationOwner,
    checkpoint: Option<(NativeLane, u64)>,
    /// None is shared/profile work, never an unknown session silently omitted.
    session_id: Option<String>,
    target_checkpoint: Option<(NativeLane, u64)>,
}

enum OperationOwner {
    Window { label: String, incarnation: u64 },
    Process,
}

#[derive(Default)]
struct State {
    epoch: u64,
    roster_epoch: u64,
    next_id: u64,
    closed_round: Option<u64>,
    /// Resource accounting failures deny admission because tracking is unsafe.
    fault: Option<BarrierError>,
    /// A missing/failed observation denies migration qualification forever, but
    /// must not disable ordinary native work while admission remains open.
    qualification_taint: Option<BarrierError>,
    windows: BTreeMap<String, WindowState>,
    operations: BTreeMap<u64, Operation>,
    targets: BTreeMap<String, target::TargetState>,
}

impl State {
    fn healthy(&self) -> Result<(), BarrierError> {
        self.fault.map_or(Ok(()), Err)
    }

    fn fault(&mut self, error: BarrierError) -> BarrierError {
        *self.fault.get_or_insert(error)
    }

    fn taint(&mut self, error: BarrierError) -> BarrierError {
        *self.qualification_taint.get_or_insert(error)
    }

    fn qualified(&self) -> Result<(), BarrierError> {
        self.healthy()?;
        self.qualification_taint.map_or(Ok(()), Err)
    }

    fn tick(&mut self) -> Result<u64, BarrierError> {
        let Some(next) = self.epoch.checked_add(1) else {
            return Err(self.fault(BarrierError::CounterExhausted));
        };
        self.epoch = next;
        Ok(next)
    }

    fn id(&mut self) -> Result<u64, BarrierError> {
        let Some(next) = self.next_id.checked_add(1) else {
            return Err(self.fault(BarrierError::CounterExhausted));
        };
        self.next_id = next;
        Ok(next)
    }

    fn roster(&self) -> Vec<(String, u64)> {
        self.windows
            .iter()
            .map(|(label, window)| (label.clone(), window.incarnation))
            .collect()
    }

    fn window(&self, token: &WindowToken) -> Result<(), BarrierError> {
        match self.windows.get(&token.label) {
            Some(window) if window.incarnation == token.incarnation => Ok(()),
            Some(_) => Err(BarrierError::StaleWindow),
            None => Err(BarrierError::UnknownWindow),
        }
    }

    fn closed(&self, token: &ClosedAdmission) -> Result<(), BarrierError> {
        if self.closed_round != Some(token.round) || self.roster_epoch != token.roster_epoch {
            return Err(BarrierError::StaleAdmission);
        }
        Ok(())
    }

    fn idle(&self, round: u64) -> Result<(), BarrierError> {
        self.qualified()?;
        if !self.operations.is_empty() {
            return Err(BarrierError::PendingNativeOperations);
        }
        if self.windows.is_empty() {
            return Err(BarrierError::EmptyWindowRoster);
        }
        if self.windows.values().any(|window| !window.created) {
            return Err(BarrierError::PendingNativeWindow);
        }
        if self
            .windows
            .values()
            .any(|window| window.checkpoints != [Some(round); 2])
        {
            return Err(BarrierError::MissingNativeCheckpoint);
        }
        Ok(())
    }
}

impl WindowBarrier {
    pub(crate) fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, State>, BarrierError> {
        self.state.lock().map_err(|_| BarrierError::Unavailable)
    }

    fn owns(&self, owner: &Weak<Mutex<State>>) -> Result<(), BarrierError> {
        if owner.ptr_eq(&Arc::downgrade(&self.state)) {
            Ok(())
        } else {
            Err(BarrierError::ForeignToken)
        }
    }

    /// Call before creating an expected native window. Registration itself keeps
    /// it unqualified until native checkpoint lanes complete. If creation fails,
    /// remove this exact token with `observe_destroyed`. Confirm a successful
    /// native build using `confirm_created`; admission alone is never readiness.
    pub(crate) fn admit_window(&self, label: &str) -> Result<WindowToken, BarrierError> {
        self.register_window(label, false)
    }

    /// Native observation of a newly created physical window or pending build
    /// confirmation. Page reloads must use `observe_reloaded` with the exact
    /// token retained by that physical native window's owner.
    pub(crate) fn observe_created(&self, label: &str) -> Result<WindowToken, BarrierError> {
        self.register_window(label, true)
    }

    /// Atomically replace only the native owner's exact current incarnation.
    /// A delayed page event from an old physical window cannot replace a newer
    /// same-label window. Return the new token even if a closed-admission reload
    /// taints qualification, so the native owner can still track its destruction.
    pub(crate) fn observe_reloaded(
        &self,
        window: &WindowToken,
    ) -> Result<WindowToken, BarrierError> {
        self.owns(&window.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        state.window(window)?;
        let incarnation = state.id()?;
        let epoch = state.tick()?;
        state.roster_epoch = epoch;
        state.windows.insert(
            window.label.clone(),
            WindowState {
                incarnation,
                created: true,
                checkpoints: [None; 2],
            },
        );
        if state.closed_round.is_some() {
            state.taint(BarrierError::UnexpectedWindowAdmission);
        }
        Ok(WindowToken {
            owner: Arc::downgrade(&self.state),
            label: window.label.clone(),
            incarnation,
        })
    }

    fn register_window(&self, label: &str, observed: bool) -> Result<WindowToken, BarrierError> {
        let mut state = self.lock()?;
        state.healthy()?;
        if label.is_empty() || label.len() > MAX_LABEL_BYTES || label.contains('\0') {
            return Err(state.taint(BarrierError::InvalidWindowLabel));
        }
        if !observed {
            if state.closed_round.is_some() {
                return Err(BarrierError::AdmissionClosed);
            }
            if state.windows.contains_key(label) {
                return Err(BarrierError::StaleWindow);
            }
        }
        if !state.windows.contains_key(label) && state.windows.len() >= MAX_WINDOWS {
            if observed {
                state.taint(BarrierError::CapacityExceeded);
            }
            return Err(BarrierError::CapacityExceeded);
        }
        let incarnation = state.id()?;
        let epoch = state.tick()?;
        state.roster_epoch = epoch;
        // The native page-load hook may observe the window before build()
        // returns. Complete that exact pending creation instead of replacing it.
        let incarnation = match state.windows.get(label) {
            Some(window) if observed && !window.created => window.incarnation,
            _ => incarnation,
        };
        state.windows.insert(
            label.into(),
            WindowState {
                incarnation,
                created: observed,
                checkpoints: [None; 2],
            },
        );
        if observed && state.closed_round.is_some() {
            return Err(state.taint(BarrierError::UnexpectedWindowAdmission));
        }
        Ok(WindowToken {
            owner: Arc::downgrade(&self.state),
            label: label.into(),
            incarnation,
        })
    }

    pub(crate) fn confirm_created(&self, window: &WindowToken) -> Result<(), BarrierError> {
        self.owns(&window.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        state.window(window)?;
        if state.windows.get(&window.label).unwrap().created {
            return Ok(());
        }
        let epoch = state.tick()?;
        state.roster_epoch = epoch;
        state.windows.get_mut(&window.label).unwrap().created = true;
        if state.closed_round.is_some() {
            return Err(state.taint(BarrierError::UnexpectedWindowAdmission));
        }
        Ok(())
    }

    /// A failed builder is evidence only that its still-pending admission can
    /// be cancelled. A native page-start observation may already have confirmed
    /// a real window despite the builder returning an error. Test and remove
    /// under one lock so cleanup cannot erase that created window or a label's
    /// newer incarnation; only an actual native Destroyed event removes those.
    pub(crate) fn cancel_creation(&self, window: &WindowToken) -> Result<(), BarrierError> {
        self.owns(&window.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        state.window(window)?;
        if state.windows.get(&window.label).unwrap().created {
            return Ok(());
        }
        let epoch = state.tick()?;
        state.roster_epoch = epoch;
        state.windows.remove(&window.label);
        Ok(())
    }

    /// Resolve only a label supplied by a native Tauri window object. This does
    /// not register or qualify an unknown window and must not accept IPC tokens.
    pub(crate) fn current_window(&self, label: &str) -> Result<WindowToken, BarrierError> {
        let state = self.lock()?;
        state.healthy()?;
        let window = state
            .windows
            .get(label)
            .ok_or(BarrierError::UnknownWindow)?;
        Ok(WindowToken {
            owner: Arc::downgrade(&self.state),
            label: label.into(),
            incarnation: window.incarnation,
        })
    }

    /// RunEvent::Destroyed provides only a label. Without a native hook retaining
    /// the incarnation, removing by label could remove an ABA replacement. Keep
    /// migration unqualified instead; a token-retaining window hook can use the
    /// exact `observe_destroyed` method.
    pub(crate) fn observe_unattributed_destruction(&self) -> Result<(), BarrierError> {
        let mut state = self.lock()?;
        let epoch = state.tick()?;
        state.roster_epoch = epoch;
        Err(state.taint(BarrierError::UnattributedWindowDestruction))
    }

    /// Use a token retained by the native window hook, not an untrusted label.
    /// Pending operations survive removal and still have to settle; failed or
    /// dropped operations permanently invalidate this barrier instance.
    pub(crate) fn observe_destroyed(&self, window: &WindowToken) -> Result<(), BarrierError> {
        self.owns(&window.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        let epoch = state.tick()?;
        state.roster_epoch = epoch;
        state.window(window)?;
        state.windows.remove(&window.label);
        Ok(())
    }

    pub(crate) fn close_admission(&self) -> Result<ClosedAdmission, BarrierError> {
        let mut state = self.lock()?;
        state.qualified()?;
        if state.closed_round.is_some() || !state.targets.is_empty() {
            return Err(BarrierError::AdmissionAlreadyClosed);
        }
        let round = state.id()?;
        state.tick()?;
        state.closed_round = Some(round);
        Ok(ClosedAdmission {
            owner: Arc::downgrade(&self.state),
            round,
            roster_epoch: state.roster_epoch,
            windows: state
                .windows
                .iter()
                .map(|(label, window)| WindowToken {
                    owner: Arc::downgrade(&self.state),
                    label: label.clone(),
                    incarnation: window.incarnation,
                })
                .collect(),
        })
    }

    /// Cancellation of this in-memory admission closure only. The coordinator
    /// must separately prove durable source authority allows cancellation.
    /// Qualification taint survives cancellation; it never prevents ordinary
    /// work from resuming under the exact native closure owner's cancellation.
    pub(crate) fn reopen_admission(&self, closed: ClosedAdmission) -> Result<(), BarrierError> {
        self.owns(&closed.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        if state.closed_round != Some(closed.round) {
            return Err(BarrierError::StaleAdmission);
        }
        state.tick()?;
        state.closed_round = None;
        Ok(())
    }

    /// New provider/writer activities and ordinary native writes both require
    /// open admission. Acquire before scheduling work or taking the store lock.
    pub(crate) fn begin_writer(
        &self,
        window: &WindowToken,
    ) -> Result<NativeOperation, BarrierError> {
        self.begin(window, None)
    }

    pub(crate) fn begin_native_write(
        &self,
        window: &WindowToken,
        _lane: NativeLane,
    ) -> Result<NativeOperation, BarrierError> {
        self.begin(window, None)
    }

    /// Native process work is independent of every renderer/window lifetime.
    pub(crate) fn begin_process_write(&self) -> Result<NativeOperation, BarrierError> {
        let mut state = self.lock()?;
        state.healthy()?;
        state.scope_open(None)?;
        if state.operations.len() >= MAX_OPERATIONS {
            return Err(BarrierError::CapacityExceeded);
        }
        let id = state.id()?;
        state.tick()?;
        for window in state.windows.values_mut() {
            window.checkpoints = [None; 2];
        }
        state.operations.insert(
            id,
            Operation {
                owner: OperationOwner::Process,
                checkpoint: None,
                session_id: None,
                target_checkpoint: None,
            },
        );
        Ok(NativeOperation {
            state: self.state.clone(),
            id: Some(id),
        })
    }

    /// Missing native attribution cannot newly disable ordinary persistence.
    /// Check closure and taint qualification in one critical section: this is
    /// deliberately NOT a lease or evidence of a drained operation.
    pub(crate) fn admit_unqualified_write(&self) -> Result<(), BarrierError> {
        let mut state = self.state.lock().unwrap_or_else(|poisoned| {
            let mut state = poisoned.into_inner();
            state.fault(BarrierError::Unavailable);
            state
        });
        state.taint(BarrierError::UnattributedNativeOperation);
        state.scope_open(None)?;
        Ok(())
    }

    /// Only the native owner of a closure can admit draining native work while
    /// closed. Complete this after the actual native SQL commit / buffer ACK.
    /// It does not certify that a renderer submitted all of its drafts.
    pub(crate) fn begin_native_checkpoint(
        &self,
        closed: &ClosedAdmission,
        window: &WindowToken,
        lane: NativeLane,
    ) -> Result<NativeOperation, BarrierError> {
        self.owns(&closed.owner)?;
        self.begin(window, Some((closed, lane)))
    }

    fn begin(
        &self,
        window: &WindowToken,
        checkpoint: Option<(&ClosedAdmission, NativeLane)>,
    ) -> Result<NativeOperation, BarrierError> {
        self.owns(&window.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        state.window(window)?;
        if !state.windows.get(&window.label).unwrap().created {
            return Err(BarrierError::PendingNativeWindow);
        }
        let checkpoint = match checkpoint {
            Some((closed, lane)) => {
                state.qualified()?;
                state.closed(closed)?;
                if state
                    .operations
                    .values()
                    .any(|operation| operation.checkpoint.is_none())
                {
                    return Err(BarrierError::PendingNativeOperations);
                }
                Some((lane, closed.round))
            }
            None => {
                state.scope_open(None)?;
                None
            }
        };
        if state.operations.len() >= MAX_OPERATIONS {
            return Err(BarrierError::CapacityExceeded);
        }
        let id = state.id()?;
        state.tick()?;
        let checkpoints = &mut state.windows.get_mut(&window.label).unwrap().checkpoints;
        match checkpoint {
            Some((lane, _)) => checkpoints[lane.index()] = None,
            None => *checkpoints = [None; 2],
        }
        state.operations.insert(
            id,
            Operation {
                owner: OperationOwner::Window {
                    label: window.label.clone(),
                    incarnation: window.incarnation,
                },
                checkpoint,
                session_id: None,
                target_checkpoint: None,
            },
        );
        Ok(NativeOperation {
            state: self.state.clone(),
            id: Some(id),
        })
    }

    pub(crate) fn prove_native_idle(
        &self,
        closed: &ClosedAdmission,
    ) -> Result<NativeIdleProof, BarrierError> {
        self.owns(&closed.owner)?;
        let state = self.lock()?;
        state.qualified()?;
        state.closed(closed)?;
        state.idle(closed.round)?;
        Ok(NativeIdleProof {
            owner: Arc::downgrade(&self.state),
            round: closed.round,
            epoch: state.epoch,
            roster: state.roster(),
        })
    }

    /// Keep the barrier lock while consuming the proof, closing the validation /
    /// admission race. The closure must not reenter this barrier or acquire a lock
    /// that an operation holder needs before completing its lease. Never await,
    /// invoke a renderer, or do external work here; use only the short native
    /// authority transaction with the documented barrier-before-store lock order.
    pub(crate) fn with_native_idle<T>(
        &self,
        proof: &NativeIdleProof,
        consume: impl FnOnce() -> T,
    ) -> Result<T, BarrierError> {
        self.owns(&proof.owner)?;
        let state = self.lock()?;
        state.qualified()?;
        if state.closed_round != Some(proof.round)
            || state.epoch != proof.epoch
            || state.roster() != proof.roster
        {
            return Err(BarrierError::StaleProof);
        }
        state.idle(proof.round)?;
        Ok(consume())
    }
}

/// RAII registration lasts through the actual native operation. Dropping it,
/// unwinding, or returning an error cannot accidentally turn pending into idle.
/// Tracking failure taints qualification without rewriting an actual native
/// operation result or disabling subsequent ordinary open-admission work.
pub(crate) struct NativeOperation {
    state: Arc<Mutex<State>>,
    id: Option<u64>,
}

impl NativeOperation {
    pub(crate) fn finish<T, E>(mut self, result: Result<T, E>) -> Result<T, TrackedWriteError<E>> {
        // The native commit result is authoritative. A concurrent failed lease,
        // replaced window or accounting failure changes migration qualification,
        // never turns an already committed write into a fabricated error/retry.
        let _ = self.settle(result.is_ok());
        result.map_err(TrackedWriteError::Operation)
    }

    fn settle(&mut self, success: bool) -> Result<(), BarrierError> {
        let mut state = self.state.lock().map_err(|_| BarrierError::Unavailable)?;
        let Some(id) = self.id.take() else {
            return Err(state.taint(BarrierError::UnfinishedNativeOperation));
        };
        let Some(operation) = state.operations.remove(&id) else {
            return Err(state.taint(BarrierError::UnfinishedNativeOperation));
        };
        let epoch = state.tick()?;
        if !success {
            return Err(state.taint(BarrierError::FailedNativeOperation));
        }
        state.healthy()?;
        state.finish_target_operation(&operation, epoch);
        let OperationOwner::Window { label, incarnation } = operation.owner else {
            for window in state.windows.values_mut() {
                window.checkpoints = [None; 2];
            }
            return Ok(());
        };
        let round = state.closed_round;
        let Some(window) = state.windows.get_mut(&label) else {
            return Err(state.taint(BarrierError::UnfinishedNativeOperation));
        };
        if window.incarnation != incarnation {
            return Err(state.taint(BarrierError::UnfinishedNativeOperation));
        }
        match operation.checkpoint {
            Some((lane, checkpoint_round)) if round == Some(checkpoint_round) => {
                window.checkpoints[lane.index()] = Some(checkpoint_round);
            }
            _ => window.checkpoints = [None; 2],
        }
        Ok(())
    }
}

impl Drop for NativeOperation {
    fn drop(&mut self) {
        if let Some(id) = self.id.take() {
            if let Ok(mut state) = self.state.lock() {
                state.operations.remove(&id);
                state.taint(BarrierError::UnfinishedNativeOperation);
                let _ = state.tick();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_process_writer_needs_no_window_and_is_accounted_until_actual_settlement() {
        let barrier = WindowBarrier::new();
        let work = barrier.begin_process_write().unwrap();
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        assert!(matches!(
            barrier.begin_process_write(),
            Err(BarrierError::AdmissionClosed)
        ));
        work.finish(Ok::<_, ()>(())).unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::EmptyWindowRoster)
        ));
        barrier.reopen_admission(closed).unwrap();
        barrier
            .begin_process_write()
            .unwrap()
            .finish(Ok::<_, ()>(()))
            .unwrap();
    }

    #[test]
    fn process_lifetime_is_not_released_or_tainted_by_a_consuming_windows_destruction() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "consumer");
        let work = barrier.begin_process_write().unwrap();
        barrier.observe_destroyed(&window).unwrap();
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        work.finish(Ok::<_, ()>(())).unwrap();
        barrier.reopen_admission(closed).unwrap();
        assert!(barrier.close_admission().is_ok());
    }

    #[test]
    fn unqualified_admission_preserves_open_work_and_permanently_denies_qualification() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        barrier.admit_unqualified_write().unwrap();
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnattributedNativeOperation)
        ));
        complete(
            barrier
                .begin_native_write(&window, NativeLane::Persistence)
                .unwrap(),
        );
        barrier.admit_unqualified_write().unwrap();
    }

    #[test]
    fn an_unqualified_writer_cannot_cross_an_existing_closure_even_when_qualification_is_tainted() {
        let barrier = WindowBarrier::new();
        live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.admit_unqualified_write(),
            Err(BarrierError::AdmissionClosed)
        ));
        assert!(barrier.prove_native_idle(&closed).is_err());
        barrier.reopen_admission(closed).unwrap();
        barrier.admit_unqualified_write().unwrap();
        assert!(barrier.close_admission().is_err());
    }

    #[test]
    fn poisoned_tracking_does_not_hide_a_closed_gate_or_disable_ordinary_open_work() {
        for closed in [false, true] {
            let barrier = WindowBarrier::new();
            live_window(&barrier, "main");
            let _closure = closed.then(|| barrier.close_admission().unwrap());
            let poisoned = std::panic::catch_unwind(|| {
                let _guard = barrier.state.lock().unwrap();
                panic!("fixture tracking failure");
            });
            assert!(poisoned.is_err());
            if closed {
                assert!(matches!(
                    barrier.admit_unqualified_write(),
                    Err(BarrierError::AdmissionClosed)
                ));
            } else {
                barrier.admit_unqualified_write().unwrap();
            }
            assert!(barrier.close_admission().is_err());
        }
    }

    fn complete(operation: NativeOperation) {
        operation.finish(Ok::<_, ()>(())).unwrap();
    }

    fn live_window(barrier: &WindowBarrier, label: &str) -> WindowToken {
        let window = barrier.admit_window(label).unwrap();
        barrier.confirm_created(&window).unwrap();
        window
    }

    fn checkpoint(barrier: &WindowBarrier, closed: &ClosedAdmission, window: &WindowToken) {
        complete(
            barrier
                .begin_native_checkpoint(closed, window, NativeLane::Persistence)
                .unwrap(),
        );
        complete(
            barrier
                .begin_native_checkpoint(closed, window, NativeLane::Buffers)
                .unwrap(),
        );
    }

    #[test]
    fn missing_native_checkpoints_do_not_prove_idle() {
        let barrier = WindowBarrier::new();
        live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
    }

    #[test]
    fn empty_roster_is_unqualified() {
        let barrier = WindowBarrier::new();
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::EmptyWindowRoster)
        ));
    }

    #[test]
    fn pending_native_creation_cannot_start_writes_or_prove_idle() {
        let barrier = WindowBarrier::new();
        let window = barrier.admit_window("main").unwrap();
        assert!(matches!(
            barrier.begin_writer(&window),
            Err(BarrierError::PendingNativeWindow)
        ));
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeWindow)
        ));
        assert!(matches!(
            barrier.confirm_created(&window),
            Err(BarrierError::UnexpectedWindowAdmission)
        ));
    }

    #[test]
    fn failed_builder_cancels_only_its_still_pending_creation() {
        let barrier = WindowBarrier::new();
        let pending = barrier.admit_window("main").unwrap();
        let before = barrier.state.lock().unwrap().roster_epoch;
        barrier.cancel_creation(&pending).unwrap();
        assert!(barrier.state.lock().unwrap().roster_epoch > before);
        assert!(matches!(
            barrier.current_window("main"),
            Err(BarrierError::UnknownWindow)
        ));
        let replacement = barrier.admit_window("main").unwrap();
        assert_ne!(pending.incarnation, replacement.incarnation);
        assert_eq!(
            barrier.cancel_creation(&pending),
            Err(BarrierError::StaleWindow)
        );
        assert_eq!(
            barrier.current_window("main").unwrap().incarnation,
            replacement.incarnation
        );
    }

    #[test]
    fn failed_builder_cleanup_retains_native_observed_or_confirmed_creation() {
        for page_started in [true, false] {
            let barrier = WindowBarrier::new();
            let admitted = barrier.admit_window("main").unwrap();
            if page_started {
                let observed = barrier.observe_created("main").unwrap();
                assert_eq!(observed.incarnation, admitted.incarnation);
            } else {
                barrier.confirm_created(&admitted).unwrap();
            }
            let before = barrier.state.lock().unwrap().roster_epoch;
            barrier.cancel_creation(&admitted).unwrap();
            assert_eq!(barrier.state.lock().unwrap().roster_epoch, before);
            assert_eq!(
                barrier.current_window("main").unwrap().incarnation,
                admitted.incarnation
            );
            complete(barrier.begin_writer(&admitted).unwrap());
            barrier.observe_destroyed(&admitted).unwrap();
            assert_eq!(
                barrier.cancel_creation(&admitted),
                Err(BarrierError::UnknownWindow)
            );
        }
    }

    #[test]
    fn native_load_observation_can_confirm_an_admitted_build_before_it_returns() {
        let barrier = WindowBarrier::new();
        let pending = barrier.admit_window("main").unwrap();
        let observed = barrier.observe_created("main").unwrap();
        assert_eq!(pending.incarnation, observed.incarnation);
        barrier.confirm_created(&pending).unwrap();
        complete(barrier.begin_writer(&observed).unwrap());
        assert_eq!(
            barrier.current_window("main").unwrap().incarnation,
            observed.incarnation
        );
        let reloaded = barrier.observe_reloaded(&observed).unwrap();
        assert_ne!(reloaded.incarnation, observed.incarnation);
        assert!(matches!(
            barrier.observe_destroyed(&observed),
            Err(BarrierError::StaleWindow)
        ));
        complete(barrier.begin_writer(&reloaded).unwrap());
    }

    #[test]
    fn stale_physical_window_reload_cannot_replace_a_reused_label() {
        let barrier = WindowBarrier::new();
        let old = live_window(&barrier, "main");
        barrier.observe_destroyed(&old).unwrap();
        let replacement = live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        checkpoint(&barrier, &closed, &replacement);
        let proof = barrier.prove_native_idle(&closed).unwrap();
        assert!(matches!(
            barrier.observe_reloaded(&old),
            Err(BarrierError::StaleWindow)
        ));
        assert_eq!(
            barrier.current_window("main").unwrap().incarnation,
            replacement.incarnation
        );
        assert_eq!(barrier.with_native_idle(&proof, || 123), Ok(123));
    }

    #[test]
    fn exact_native_reload_invalidates_old_proof_and_taints_closed_admission() {
        let barrier = WindowBarrier::new();
        let original = live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        checkpoint(&barrier, &closed, &original);
        let proof = barrier.prove_native_idle(&closed).unwrap();
        let reloaded = barrier.observe_reloaded(&original).unwrap();
        assert_ne!(original.incarnation, reloaded.incarnation);
        assert_eq!(
            barrier.with_native_idle(&proof, || panic!("must not run")),
            Err(BarrierError::UnexpectedWindowAdmission)
        );
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::UnexpectedWindowAdmission)
        ));
        assert!(matches!(
            barrier.begin_writer(&reloaded),
            Err(BarrierError::AdmissionClosed)
        ));
        barrier.reopen_admission(closed).unwrap();
        complete(barrier.begin_writer(&reloaded).unwrap());
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnexpectedWindowAdmission)
        ));
        barrier.observe_destroyed(&reloaded).unwrap();
        assert!(matches!(
            barrier.current_window("main"),
            Err(BarrierError::UnknownWindow)
        ));
    }

    #[test]
    fn reload_rejects_foreign_and_destroyed_tokens_without_adding_windows() {
        let barrier = WindowBarrier::new();
        let other = WindowBarrier::new();
        let foreign = live_window(&other, "main");
        assert!(matches!(
            barrier.observe_reloaded(&foreign),
            Err(BarrierError::ForeignToken)
        ));
        let destroyed = live_window(&barrier, "main");
        barrier.observe_destroyed(&destroyed).unwrap();
        assert!(matches!(
            barrier.observe_reloaded(&destroyed),
            Err(BarrierError::UnknownWindow)
        ));
        assert!(barrier.state.lock().unwrap().windows.is_empty());
    }

    #[test]
    fn label_only_destruction_cannot_remove_an_unidentified_replacement() {
        let barrier = WindowBarrier::new();
        live_window(&barrier, "main");
        assert_eq!(
            barrier.observe_unattributed_destruction(),
            Err(BarrierError::UnattributedWindowDestruction)
        );
        assert_eq!(barrier.state.lock().unwrap().windows.len(), 1);
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnattributedWindowDestruction)
        ));
    }

    #[test]
    fn closure_denies_new_writers_and_only_native_token_admits_drain() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.begin_writer(&window),
            Err(BarrierError::AdmissionClosed)
        ));
        assert!(matches!(
            barrier.begin_native_write(&window, NativeLane::Persistence),
            Err(BarrierError::AdmissionClosed)
        ));
        assert!(matches!(
            barrier.admit_window("second"),
            Err(BarrierError::AdmissionClosed)
        ));
        checkpoint(&barrier, &closed, &window);
        let proof = barrier.prove_native_idle(&closed).unwrap();
        assert_eq!(barrier.with_native_idle(&proof, || 42), Ok(42));
    }

    #[test]
    fn in_flight_commit_and_late_writer_completion_require_fresh_checkpoints() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        let writer = barrier.begin_writer(&window).unwrap();
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        assert!(matches!(
            barrier.begin_native_checkpoint(&closed, &window, NativeLane::Persistence),
            Err(BarrierError::PendingNativeOperations)
        ));
        complete(writer);
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
        checkpoint(&barrier, &closed, &window);
        let proof = barrier.prove_native_idle(&closed).unwrap();
        let in_flight = barrier
            .begin_native_checkpoint(&closed, &window, NativeLane::Buffers)
            .unwrap();
        assert_eq!(
            barrier.with_native_idle(&proof, || panic!("must not run")),
            Err(BarrierError::StaleProof)
        );
        complete(in_flight);
        assert!(barrier.with_native_idle(&proof, || ()).is_err());
    }

    #[test]
    fn recreated_label_never_reuses_old_roster_or_window_token() {
        let barrier = WindowBarrier::new();
        let first = live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        checkpoint(&barrier, &closed, &first);
        let proof = barrier.prove_native_idle(&closed).unwrap();
        barrier.observe_destroyed(&first).unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::StaleAdmission)
        ));
        assert!(barrier.with_native_idle(&proof, || ()).is_err());
        barrier.reopen_admission(closed).unwrap();
        let replacement = barrier.observe_created("main").unwrap();
        assert!(matches!(
            barrier.begin_writer(&first),
            Err(BarrierError::StaleWindow)
        ));
        assert!(matches!(
            barrier.observe_destroyed(&first),
            Err(BarrierError::StaleWindow)
        ));
        complete(barrier.begin_writer(&replacement).unwrap());
    }

    #[test]
    fn unexpected_creation_and_reload_invalidate_a_closed_roster() {
        for label in ["new-window", "main"] {
            let barrier = WindowBarrier::new();
            let window = live_window(&barrier, "main");
            let closed = barrier.close_admission().unwrap();
            checkpoint(&barrier, &closed, &window);
            let proof = barrier.prove_native_idle(&closed).unwrap();
            assert!(matches!(
                barrier.observe_created(label),
                Err(BarrierError::UnexpectedWindowAdmission)
            ));
            assert!(barrier.with_native_idle(&proof, || ()).is_err());
            assert!(matches!(
                barrier.prove_native_idle(&closed),
                Err(BarrierError::UnexpectedWindowAdmission)
            ));
            barrier.reopen_admission(closed).unwrap();
            let current = barrier.current_window(label).unwrap();
            complete(barrier.begin_writer(&current).unwrap());
            live_window(&barrier, "later-window");
            assert!(matches!(
                barrier.close_admission(),
                Err(BarrierError::UnexpectedWindowAdmission)
            ));
        }
    }

    #[test]
    fn failed_or_abandoned_write_remains_invalid_after_reopen() {
        for failed in [true, false] {
            let barrier = WindowBarrier::new();
            let window = live_window(&barrier, "main");
            let write = barrier
                .begin_native_write(&window, NativeLane::Persistence)
                .unwrap();
            let closed = barrier.close_admission().unwrap();
            if failed {
                assert!(matches!(
                    write.finish(Err::<(), _>("disk full")),
                    Err(TrackedWriteError::Operation("disk full"))
                ));
            } else {
                drop(write);
            }
            assert!(barrier.prove_native_idle(&closed).is_err());
            assert!(matches!(
                barrier.begin_writer(&window),
                Err(BarrierError::AdmissionClosed)
            ));
            barrier.reopen_admission(closed).unwrap();
            complete(barrier.begin_writer(&window).unwrap());
            assert!(barrier.current_window("main").is_ok());
            live_window(&barrier, "later-window");
            assert!(barrier.close_admission().is_err());
        }
    }

    #[test]
    fn concurrent_failure_preserves_actual_success_and_later_open_work() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        let first = barrier
            .begin_native_write(&window, NativeLane::Persistence)
            .unwrap();
        let second = barrier
            .begin_native_write(&window, NativeLane::Buffers)
            .unwrap();
        assert!(matches!(
            first.finish(Err::<(), _>("disk full")),
            Err(TrackedWriteError::Operation("disk full"))
        ));
        assert!(matches!(second.finish(Ok::<_, ()>(123)), Ok(123)));
        let later = barrier
            .begin_native_write(&window, NativeLane::Persistence)
            .unwrap();
        assert!(matches!(later.finish(Ok::<_, ()>(456)), Ok(456)));
        assert!(barrier.current_window("main").is_ok());
        live_window(&barrier, "later-window");
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::FailedNativeOperation)
        ));
        assert!(barrier.state.lock().unwrap().operations.is_empty());
    }

    #[test]
    fn successful_commit_after_window_replacement_keeps_its_actual_value() {
        let barrier = WindowBarrier::new();
        let old_window = live_window(&barrier, "main");
        let write = barrier
            .begin_native_write(&old_window, NativeLane::Persistence)
            .unwrap();
        let replacement = barrier.observe_created("main").unwrap();
        assert!(matches!(write.finish(Ok::<_, ()>(123)), Ok(123)));
        complete(barrier.begin_writer(&replacement).unwrap());
        assert!(barrier.current_window("main").is_ok());
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnfinishedNativeOperation)
        ));
    }

    #[test]
    fn failed_checkpoint_can_cancel_exact_closure_without_clearing_taint() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        let checkpoint = barrier
            .begin_native_checkpoint(&closed, &window, NativeLane::Persistence)
            .unwrap();
        assert!(matches!(
            checkpoint.finish(Err::<(), _>("checkpoint failed")),
            Err(TrackedWriteError::Operation("checkpoint failed"))
        ));
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::FailedNativeOperation)
        ));
        assert!(matches!(
            barrier.begin_writer(&window),
            Err(BarrierError::AdmissionClosed)
        ));
        barrier.reopen_admission(closed).unwrap();
        complete(barrier.begin_writer(&window).unwrap());
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::FailedNativeOperation)
        ));
    }

    #[test]
    fn dropped_lease_and_unknown_lifecycle_preserve_ordinary_open_work() {
        for unknown_lifecycle in [true, false] {
            let barrier = WindowBarrier::new();
            let window = live_window(&barrier, "main");
            if unknown_lifecycle {
                assert_eq!(
                    barrier.observe_unattributed_destruction(),
                    Err(BarrierError::UnattributedWindowDestruction)
                );
            } else {
                drop(barrier.begin_writer(&window).unwrap());
            }
            complete(barrier.begin_writer(&window).unwrap());
            assert!(barrier.current_window("main").is_ok());
            live_window(&barrier, "later-window");
            assert!(barrier.close_admission().is_err());
            assert!(barrier.state.lock().unwrap().operations.is_empty());
        }
    }

    #[test]
    fn tokens_are_bound_to_the_actual_barrier_instance() {
        let first = WindowBarrier::new();
        let second = WindowBarrier::new();
        let window = live_window(&first, "main");
        let foreign_window = live_window(&second, "main");
        let closed = first.close_admission().unwrap();
        checkpoint(&first, &closed, &window);
        let proof = first.prove_native_idle(&closed).unwrap();
        assert!(matches!(
            second.begin_native_checkpoint(&closed, &foreign_window, NativeLane::Buffers),
            Err(BarrierError::ForeignToken)
        ));
        assert_eq!(
            second.with_native_idle(&proof, || panic!("must not run")),
            Err(BarrierError::ForeignToken)
        );
    }

    #[test]
    fn reopening_and_closing_again_cannot_revalidate_an_old_proof() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        let first = barrier.close_admission().unwrap();
        checkpoint(&barrier, &first, &window);
        let proof = barrier.prove_native_idle(&first).unwrap();
        barrier.reopen_admission(first).unwrap();
        let second = barrier.close_admission().unwrap();
        checkpoint(&barrier, &second, &window);
        assert_eq!(
            barrier.with_native_idle(&proof, || panic!("must not run")),
            Err(BarrierError::StaleProof)
        );
    }

    #[test]
    fn rejected_window_admission_recovers_capacity_without_poisoning_cleanup() {
        let barrier = WindowBarrier::new();
        let windows: Vec<_> = (0..MAX_WINDOWS)
            .map(|index| live_window(&barrier, &format!("window-{index}")))
            .collect();
        assert!(matches!(
            barrier.admit_window("overflow"),
            Err(BarrierError::CapacityExceeded)
        ));
        barrier.observe_destroyed(&windows[0]).unwrap();
        live_window(&barrier, "replacement");
        assert_eq!(barrier.state.lock().unwrap().windows.len(), MAX_WINDOWS);
        assert!(barrier.close_admission().is_ok());
    }

    #[test]
    fn untracked_created_window_over_capacity_taints_only_qualification() {
        let barrier = WindowBarrier::new();
        let windows: Vec<_> = (0..MAX_WINDOWS)
            .map(|index| live_window(&barrier, &format!("window-{index}")))
            .collect();
        assert!(matches!(
            barrier.observe_created("overflow"),
            Err(BarrierError::CapacityExceeded)
        ));
        assert_eq!(barrier.state.lock().unwrap().windows.len(), MAX_WINDOWS);
        barrier.observe_destroyed(&windows[0]).unwrap();
        live_window(&barrier, "ordinary-replacement");
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::CapacityExceeded)
        ));
    }

    #[test]
    fn rejected_operation_admission_recovers_capacity_and_preserves_proof() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        let mut operations: Vec<_> = (0..MAX_OPERATIONS)
            .map(|_| barrier.begin_writer(&window).unwrap())
            .collect();
        assert!(matches!(
            barrier.begin_writer(&window),
            Err(BarrierError::CapacityExceeded)
        ));
        assert_eq!(
            barrier.state.lock().unwrap().operations.len(),
            MAX_OPERATIONS
        );
        complete(operations.pop().unwrap());
        complete(barrier.begin_writer(&window).unwrap());
        for operation in operations {
            complete(operation);
        }
        let closed = barrier.close_admission().unwrap();
        checkpoint(&barrier, &closed, &window);
        assert!(barrier.prove_native_idle(&closed).is_ok());
    }

    #[test]
    fn generation_exhaustion_cannot_wrap_or_reuse_an_old_proof() {
        let barrier = WindowBarrier::new();
        let window = live_window(&barrier, "main");
        barrier.state.lock().unwrap().epoch = u64::MAX;
        assert!(matches!(
            barrier.begin_writer(&window),
            Err(BarrierError::CounterExhausted)
        ));
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::CounterExhausted)
        ));

        let barrier = WindowBarrier::new();
        barrier.state.lock().unwrap().next_id = u64::MAX;
        assert!(matches!(
            barrier.admit_window("main"),
            Err(BarrierError::CounterExhausted)
        ));
    }

    #[test]
    fn labels_are_bounded_and_invalid_observation_taint_preserves_open_work() {
        for label in [
            String::new(),
            "x".repeat(MAX_LABEL_BYTES + 1),
            "a\0b".into(),
        ] {
            let barrier = WindowBarrier::new();
            assert!(matches!(
                barrier.observe_created(&label),
                Err(BarrierError::InvalidWindowLabel)
            ));
            live_window(&barrier, "main");
            assert!(matches!(
                barrier.close_admission(),
                Err(BarrierError::InvalidWindowLabel)
            ));
        }
    }
}
