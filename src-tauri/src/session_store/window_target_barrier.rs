//! Session-scoped companion to the same native WindowBarrier state/operation owner.
//! This never establishes actor coverage or renderer/native checkpoint completion.
//! Native command handlers derive the scope from the row they actually mutate.
use super::*;

const MAX_TARGET_CLOSURES: usize = 64;
const MAX_SESSION_BYTES: usize = 256;

pub(super) struct TargetState {
    round: u64,
    epoch: u64,
    roster_epoch: u64,
    checkpoints: BTreeMap<String, [Option<u64>; 2]>,
}

/// Native-only owner of one session closure. Not Clone, Serialize or an IPC DTO.
/// Losing this token does not reopen admission or cancel a durable source fence.
pub(crate) struct ClosedTargetAdmission {
    owner: Weak<Mutex<State>>,
    session_id: String,
    round: u64,
    roster_epoch: u64,
    windows: Vec<WindowToken>,
}

impl ClosedTargetAdmission {
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn windows(&self) -> &[WindowToken] {
        &self.windows
    }
}

/// Exact session/round/roster proof; cannot be used by the profile-wide consumer.
pub(crate) struct NativeTargetIdleProof {
    owner: Weak<Mutex<State>>,
    session_id: String,
    round: u64,
    epoch: u64,
    roster_epoch: u64,
    roster: Vec<(String, u64)>,
}

fn validate_session(session_id: &str) -> Result<(), BarrierError> {
    if session_id.is_empty()
        || session_id.len() > MAX_SESSION_BYTES
        || session_id.chars().any(char::is_control)
    {
        return Err(BarrierError::InvalidSessionScope);
    }
    Ok(())
}

impl State {
    pub(super) fn scope_open(&self, session_id: Option<&str>) -> Result<(), BarrierError> {
        if self.closed_round.is_some()
            || match session_id {
                Some(session_id) => self.targets.contains_key(session_id),
                None => !self.targets.is_empty(),
            }
        {
            return Err(BarrierError::AdmissionClosed);
        }
        Ok(())
    }

    fn closed_target(&self, closed: &ClosedTargetAdmission) -> Result<&TargetState, BarrierError> {
        self.targets
            .get(&closed.session_id)
            .filter(|target| {
                target.round == closed.round
                    && target.roster_epoch == closed.roster_epoch
                    && self.roster_epoch == closed.roster_epoch
            })
            .ok_or(BarrierError::StaleAdmission)
    }

    fn target_idle(&self, session_id: &str, target: &TargetState) -> Result<(), BarrierError> {
        self.qualified()?;
        self.target_operations_idle(session_id)?;
        if target.checkpoints.len() != self.windows.len()
            || target
                .checkpoints
                .values()
                .any(|lanes| *lanes != [Some(target.round); 2])
        {
            return Err(BarrierError::MissingNativeCheckpoint);
        }
        Ok(())
    }

    fn target_operations_idle(&self, session_id: &str) -> Result<(), BarrierError> {
        if self.operations.values().any(|operation| {
            operation
                .session_id
                .as_deref()
                .is_none_or(|id| id == session_id)
        }) {
            return Err(BarrierError::PendingNativeOperations);
        }
        if self.windows.is_empty() {
            return Err(BarrierError::EmptyWindowRoster);
        }
        if self.windows.values().any(|window| !window.created) {
            return Err(BarrierError::PendingNativeWindow);
        }
        Ok(())
    }

    pub(super) fn finish_target_operation(&mut self, operation: &Operation, epoch: u64) {
        for (session_id, target) in &mut self.targets {
            if operation
                .session_id
                .as_deref()
                .is_some_and(|id| id != session_id)
            {
                continue;
            }
            target.epoch = epoch;
            if let (Some((lane, round)), OperationOwner::Window { label, incarnation }) =
                (operation.target_checkpoint, &operation.owner)
            {
                if round == target.round
                    && self.roster_epoch == target.roster_epoch
                    && self
                        .windows
                        .get(label)
                        .is_some_and(|window| window.incarnation == *incarnation)
                {
                    if let Some(lanes) = target.checkpoints.get_mut(label) {
                        lanes[lane.index()] = Some(round);
                        continue;
                    }
                }
            }
            for lanes in target.checkpoints.values_mut() {
                *lanes = [None; 2];
            }
        }
    }
}

impl WindowBarrier {
    pub(crate) fn close_target_admission(
        &self,
        session_id: &str,
    ) -> Result<ClosedTargetAdmission, BarrierError> {
        self.close_target_admission_inner(session_id, false, None, || false)
    }

    /// Observer preflight and closure are atomic with actual process/session
    /// admissions. Failure never leaves a partially closed target gate.
    pub(crate) fn try_close_idle_target_admission(
        &self,
        session_id: &str,
    ) -> Result<ClosedTargetAdmission, BarrierError> {
        self.close_target_admission_inner(session_id, true, None, || false)
    }

    /// Additional reject policies, checked at the actual admission point after
    /// waiting for the mutex. The predicate must be a nonblocking local check;
    /// it cannot acquire Store/barrier locks or establish qualifying authority.
    pub(crate) fn try_close_idle_target_admission_before(
        &self,
        session_id: &str,
        expires: std::time::Instant,
        is_cancelled: impl FnOnce() -> bool,
    ) -> Result<ClosedTargetAdmission, BarrierError> {
        self.close_target_admission_inner(session_id, true, Some(expires), is_cancelled)
    }

    fn close_target_admission_inner(
        &self,
        session_id: &str,
        require_idle: bool,
        expires: Option<std::time::Instant>,
        is_cancelled: impl FnOnce() -> bool,
    ) -> Result<ClosedTargetAdmission, BarrierError> {
        validate_session(session_id)?;
        let mut state = self.lock()?;
        state.qualified()?;
        if state.closed_round.is_some() || state.targets.contains_key(session_id) {
            return Err(BarrierError::AdmissionAlreadyClosed);
        }
        if state.targets.len() >= MAX_TARGET_CLOSURES {
            return Err(BarrierError::CapacityExceeded);
        }
        if require_idle {
            state.target_operations_idle(session_id)?;
        }
        if expires.is_some_and(|expires| std::time::Instant::now() >= expires) || is_cancelled() {
            return Err(BarrierError::CheckpointExpired);
        }
        let round = state.id()?;
        let epoch = state.tick()?;
        let roster_epoch = state.roster_epoch;
        let windows = state
            .windows
            .iter()
            .map(|(label, window)| WindowToken {
                owner: Arc::downgrade(&self.state),
                label: label.clone(),
                incarnation: window.incarnation,
            })
            .collect();
        let checkpoints = state
            .windows
            .keys()
            .map(|label| (label.clone(), [None; 2]))
            .collect();
        state.targets.insert(
            session_id.into(),
            TargetState {
                round,
                epoch,
                roster_epoch,
                checkpoints,
            },
        );
        Ok(ClosedTargetAdmission {
            owner: Arc::downgrade(&self.state),
            session_id: session_id.into(),
            round,
            roster_epoch,
            windows,
        })
    }

    /// In-memory admission only: a coordinator must separately establish that
    /// durable source authority permits cancellation. Stale roster does not trap
    /// the exact owner forever, but another round/owner cannot reopen this gate.
    pub(crate) fn reopen_target_admission(
        &self,
        closed: ClosedTargetAdmission,
    ) -> Result<(), BarrierError> {
        self.owns(&closed.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        if state
            .targets
            .get(&closed.session_id)
            .is_none_or(|target| target.round != closed.round)
        {
            return Err(BarrierError::StaleAdmission);
        }
        state.tick()?;
        state.targets.remove(&closed.session_id);
        Ok(())
    }

    pub(crate) fn begin_session_write(
        &self,
        window: &WindowToken,
        session_id: &str,
        _lane: NativeLane,
    ) -> Result<NativeOperation, BarrierError> {
        self.begin_target_operation(window, session_id, None, None)
    }

    /// Actual Native execution lease; it is not owned by a renderer/window and
    /// survives callback/waiter disposal through real process/SQL settlement.
    pub(crate) fn begin_process_session_write(
        &self,
        session_id: &str,
    ) -> Result<NativeOperation, BarrierError> {
        validate_session(session_id)?;
        self.begin_process_operation(Some(session_id))
    }

    /// Missing native window attribution still taints all qualification. It
    /// cannot turn a renderer-supplied session string into a checkpoint grant.
    pub(crate) fn admit_unqualified_session_write(
        &self,
        session_id: &str,
    ) -> Result<(), BarrierError> {
        validate_session(session_id)?;
        let mut state = self.state.lock().unwrap_or_else(|poisoned| {
            let mut state = poisoned.into_inner();
            state.fault(BarrierError::Unavailable);
            state
        });
        state.taint(BarrierError::UnattributedNativeOperation);
        state.scope_open(Some(session_id))
    }

    pub(crate) fn begin_target_checkpoint(
        &self,
        closed: &ClosedTargetAdmission,
        window: &WindowToken,
        lane: NativeLane,
    ) -> Result<NativeOperation, BarrierError> {
        self.owns(&closed.owner)?;
        self.begin_target_operation(window, &closed.session_id, Some((closed, lane)), None)
    }

    /// Deadline is checked at the actual admission point under the state lock.
    /// Waiting for that lock never reserves work after the challenge expires.
    pub(crate) fn begin_target_checkpoint_before(
        &self,
        closed: &ClosedTargetAdmission,
        window: &WindowToken,
        lane: NativeLane,
        expires: std::time::Instant,
    ) -> Result<NativeOperation, BarrierError> {
        self.owns(&closed.owner)?;
        self.begin_target_operation(
            window,
            &closed.session_id,
            Some((closed, lane)),
            Some(expires),
        )
    }

    /// Only bounded local SQL may run here. Hold barrier-before-Store lock order
    /// through its actual commit; never await, emit IPC or invoke providers.
    pub(crate) fn with_target_checkpoint_scope<T>(
        &self,
        closed: &ClosedTargetAdmission,
        window: &WindowToken,
        consume: impl FnOnce(&str) -> T,
    ) -> Result<T, BarrierError> {
        self.owns(&closed.owner)?;
        self.owns(&window.owner)?;
        let state = self.lock()?;
        state.healthy()?;
        state.closed_target(closed)?;
        state.window(window)?;
        if !state.windows.get(&window.label).unwrap().created {
            return Err(BarrierError::PendingNativeWindow);
        }
        Ok(consume(&closed.session_id))
    }

    fn begin_target_operation(
        &self,
        window: &WindowToken,
        session_id: &str,
        checkpoint: Option<(&ClosedTargetAdmission, NativeLane)>,
        expires: Option<std::time::Instant>,
    ) -> Result<NativeOperation, BarrierError> {
        validate_session(session_id)?;
        self.owns(&window.owner)?;
        let mut state = self.lock()?;
        state.healthy()?;
        state.window(window)?;
        if !state.windows.get(&window.label).unwrap().created {
            return Err(BarrierError::PendingNativeWindow);
        }
        let target_checkpoint = match checkpoint {
            Some((closed, lane)) => {
                state.qualified()?;
                let round = state.closed_target(closed)?.round;
                if state.operations.values().any(|operation| {
                    operation
                        .session_id
                        .as_deref()
                        .is_none_or(|id| id == session_id)
                        && operation
                            .target_checkpoint
                            .is_none_or(|(_, active_round)| active_round != round)
                }) {
                    return Err(BarrierError::PendingNativeOperations);
                }
                Some((lane, round))
            }
            None => {
                state.scope_open(Some(session_id))?;
                None
            }
        };
        if state.operations.len() >= MAX_OPERATIONS {
            return Err(BarrierError::CapacityExceeded);
        }
        if expires.is_some_and(|expires| std::time::Instant::now() >= expires) {
            return Err(BarrierError::CheckpointExpired);
        }
        let id = state.id()?;
        let epoch = state.tick()?;
        state.windows.get_mut(&window.label).unwrap().checkpoints = [None; 2];
        if let Some((lane, _)) = target_checkpoint {
            let target = state.targets.get_mut(session_id).unwrap();
            target.epoch = epoch;
            target.checkpoints.get_mut(&window.label).unwrap()[lane.index()] = None;
        }
        state.operations.insert(
            id,
            Operation {
                owner: OperationOwner::Window {
                    label: window.label.clone(),
                    incarnation: window.incarnation,
                },
                checkpoint: None,
                session_id: Some(session_id.into()),
                target_checkpoint,
            },
        );
        Ok(NativeOperation {
            state: self.state.clone(),
            id: Some(id),
        })
    }

    pub(crate) fn prove_target_native_idle(
        &self,
        closed: &ClosedTargetAdmission,
    ) -> Result<NativeTargetIdleProof, BarrierError> {
        self.owns(&closed.owner)?;
        let state = self.lock()?;
        let target = state.closed_target(closed)?;
        state.target_idle(&closed.session_id, target)?;
        Ok(NativeTargetIdleProof {
            owner: Arc::downgrade(&self.state),
            session_id: closed.session_id.clone(),
            round: target.round,
            epoch: target.epoch,
            roster_epoch: target.roster_epoch,
            roster: state.roster(),
        })
    }

    /// Same barrier-before-store lock order as the profile consumer; no awaits,
    /// renderer calls or external work. Exact session is supplied to consumption.
    pub(crate) fn with_target_native_idle<T>(
        &self,
        proof: &NativeTargetIdleProof,
        consume: impl FnOnce(&str) -> T,
    ) -> Result<T, BarrierError> {
        self.owns(&proof.owner)?;
        let state = self.lock()?;
        let target = state
            .targets
            .get(&proof.session_id)
            .ok_or(BarrierError::StaleProof)?;
        if target.round != proof.round
            || target.epoch != proof.epoch
            || target.roster_epoch != proof.roster_epoch
            || state.roster_epoch != proof.roster_epoch
            || state.roster() != proof.roster
        {
            return Err(BarrierError::StaleProof);
        }
        state.target_idle(&proof.session_id, target)?;
        Ok(consume(&proof.session_id))
    }
}

#[cfg(test)]
#[path = "window_target_barrier_tests.rs"]
mod tests;
