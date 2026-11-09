//! Source-private turn/write lifetimes. A drained byte writer is not process
//! retirement or provider acknowledgement. No public receipt recreates an owner.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use super::{ControlTurnReceipt, WindowIssuer};

pub(crate) const CAPACITY: usize = 512;
const WRITE_CAPACITY: usize = 4096;

#[derive(Default)]
struct GateState {
    closed: bool,
    active: usize,
    failure: Option<String>,
}

#[derive(Default)]
pub(crate) struct WriteScope {
    state: Mutex<GateState>,
    changed: Condvar,
}
impl WriteScope {
    pub(crate) fn admit(self: &Arc<Self>) -> Result<WriteTicket, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "NATIVE_TURN_WRITE_UNAVAILABLE")?;
        if state.closed {
            return Err("NATIVE_TURN_WRITE_CLOSED".into());
        }
        if state.active >= WRITE_CAPACITY {
            return Err("NATIVE_TURN_WRITE_CAPACITY".into());
        }
        state.active += 1;
        Ok(WriteTicket {
            scope: self.clone(),
            started: false,
            completed: false,
        })
    }
    pub(crate) fn close(&self) {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).closed = true;
        self.changed.notify_all();
    }
    pub(crate) fn drain(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "NATIVE_TURN_WRITE_UNAVAILABLE")?;
        let (state, _) = self
            .changed
            .wait_timeout_while(state, std::time::Duration::from_secs(12), |s| s.active != 0)
            .map_err(|_| "NATIVE_TURN_WRITE_UNAVAILABLE")?;
        if state.active != 0 {
            return Err("Turn write delivery outcome unknown; do not retry while writing".into());
        }
        state.failure.clone().map_or(Ok(()), Err)
    }
    pub(crate) fn settled(&self) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.closed && state.active == 0)
    }
}

pub(crate) struct WriteTicket {
    scope: Arc<WriteScope>,
    started: bool,
    completed: bool,
}
impl WriteTicket {
    pub(crate) fn start(&mut self) {
        self.started = true;
    }
    pub(crate) fn finish(mut self, result: &Result<(), String>) {
        if let Err(error) = result {
            self.scope
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .failure
                .get_or_insert(error.clone());
        }
        self.completed = true;
    }
}
impl Drop for WriteTicket {
    fn drop(&mut self) {
        let mut state = self.scope.state.lock().unwrap_or_else(|e| e.into_inner());
        if self.started && !self.completed {
            state
                .failure
                .get_or_insert_with(|| "NATIVE_TURN_WRITE_SETTLEMENT_UNKNOWN".into());
        }
        state.active -= 1;
        self.scope.changed.notify_all();
    }
}

pub(crate) struct TurnWork {
    pub(crate) receipt: ControlTurnReceipt,
    pub(crate) issuer: Arc<WindowIssuer>,
    pub(crate) window: String,
    pub(crate) cwd: String,
    pub(crate) writes: Arc<WriteScope>,
    finished: AtomicBool,
}
impl TurnWork {
    pub(super) fn new(
        receipt: ControlTurnReceipt,
        issuer: Arc<WindowIssuer>,
        window: String,
        cwd: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            receipt,
            issuer,
            window,
            cwd,
            writes: Arc::default(),
            finished: AtomicBool::new(false),
        })
    }
    pub(crate) fn matches(
        &self,
        window: &str,
        issuer: &Arc<WindowIssuer>,
        receipt: &ControlTurnReceipt,
    ) -> bool {
        self.receipt == *receipt && self.window == window && Arc::ptr_eq(&self.issuer, issuer)
    }
    pub(crate) fn complete(&self) -> Result<(), String> {
        if !self.writes.settled() {
            return Err("NATIVE_TURN_WRITE_SETTLEMENT_UNKNOWN".into());
        }
        self.finished.store(true, Ordering::Release);
        Ok(())
    }
    pub(crate) fn finished(&self) -> bool {
        self.finished.load(Ordering::Acquire)
    }
}

#[derive(Default)]
pub(super) struct TurnLedger {
    records: VecDeque<Arc<TurnWork>>,
}
impl TurnLedger {
    pub(super) fn capacity(&mut self) -> Result<(), String> {
        if self.records.len() >= CAPACITY {
            if let Some(index) = self
                .records
                .iter()
                .position(|turn| turn.finished() || turn.writes.settled())
            {
                self.records.remove(index);
            }
        }
        if self.records.len() >= CAPACITY {
            return Err("NATIVE_CONTROL_TURN_CAPACITY".into());
        }
        Ok(())
    }
    pub(super) fn close_issuer(&self, issuer: &Arc<WindowIssuer>) {
        for turn in &self.records {
            if Arc::ptr_eq(&turn.issuer, issuer) {
                turn.writes.close();
            }
        }
    }
    pub(super) fn close_window(&self, window: &str) {
        for turn in &self.records {
            if turn.window == window {
                turn.writes.close();
            }
        }
    }
    pub(super) fn close_abandoned(&self, window: &str, issuer: &Arc<WindowIssuer>) {
        for turn in &self.records {
            if !turn.issuer.is_live()
                || (turn.window == window && !Arc::ptr_eq(&turn.issuer, issuer))
            {
                turn.writes.close();
            }
        }
    }
    pub(super) fn insert(&mut self, turn: Arc<TurnWork>) {
        self.records.push_back(turn);
    }
    pub(super) fn find(&self, receipt: &ControlTurnReceipt) -> Option<Arc<TurnWork>> {
        self.records
            .iter()
            .find(|turn| turn.receipt == *receipt)
            .cloned()
    }
    #[cfg(test)]
    pub(super) fn completed_count(&self) -> usize {
        self.records.iter().filter(|turn| turn.finished()).count()
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;
    use crate::control::ControlHost;

    pub(crate) fn host() -> ControlHost {
        ControlHost {
            endpoint: String::new(),
            inner: Arc::default(),
        }
    }
    pub(crate) fn authorize(
        host: &ControlHost,
        issuer: &Arc<WindowIssuer>,
        target: &str,
        cwd: &std::path::Path,
    ) -> Result<ControlTurnReceipt, String> {
        let cwd = crate::control::canonical_child_cwd(cwd)?;
        issuer.with_live(|| {
            host.inner.lock().unwrap().install_authorized_turn(
                "original-window",
                issuer,
                target.into(),
                cwd,
                true,
            )
        })
    }
    pub(crate) fn active(host: &ControlHost, receipt: &ControlTurnReceipt) -> bool {
        host.inner
            .lock()
            .unwrap()
            .active
            .get(&receipt.session_id)
            .is_some_and(|turn| turn.receipt == *receipt && turn.app_allowed)
    }
    pub(crate) fn work(host: &ControlHost, receipt: &ControlTurnReceipt) -> Arc<TurnWork> {
        host.inner
            .lock()
            .unwrap()
            .turn_writes
            .find(receipt)
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fixtures::*;

    #[test]
    fn turn_capacity_refusal_preserves_original_admission_and_app_permission() {
        let host = host();
        let issuer = Arc::new(WindowIssuer::default());
        let cwd = std::env::temp_dir();
        let mut last = authorize(&host, &issuer, "one", &cwd).unwrap();
        let mut pending = Vec::new();
        for _ in 1..CAPACITY {
            pending.push(work(&host, &last).writes.admit().unwrap());
            last = authorize(&host, &issuer, "one", &cwd).unwrap();
        }
        let old = work(&host, &last);
        assert_eq!(
            authorize(&host, &issuer, "one", &cwd).unwrap_err(),
            "NATIVE_CONTROL_TURN_CAPACITY"
        );
        assert!(active(&host, &last));
        let ticket = old.writes.admit().unwrap();
        ticket.finish(&Ok(()));
        crate::control::finish_original_turn(&host, &issuer, "original-window", &last).unwrap();
        let next = authorize(&host, &issuer, "one", &cwd).unwrap();
        assert!(active(&host, &next));
    }

    #[test]
    fn failed_or_lost_started_writer_never_supplies_completed_turn_capacity() {
        for failure in [false, true] {
            let host = host();
            let issuer = Arc::new(WindowIssuer::default());
            let receipt = authorize(&host, &issuer, "one", &std::env::temp_dir()).unwrap();
            let original = work(&host, &receipt);
            let mut ticket = original.writes.admit().unwrap();
            ticket.start();
            if failure {
                ticket.finish(&Err("real stdin error".into()));
            } else {
                drop(ticket);
            }
            assert!(crate::control::finish_original_turn(
                &host,
                &issuer,
                "original-window",
                &receipt
            )
            .is_ok());
            assert!(!active(&host, &receipt));
            assert!(original.finished());
            assert!(original.writes.admit().is_err());
            for _ in 1..CAPACITY {
                authorize(&host, &issuer, "next", &std::env::temp_dir()).unwrap();
            }
            assert!(authorize(&host, &issuer, "next", &std::env::temp_dir()).is_ok());
            assert!(host
                .inner
                .lock()
                .unwrap()
                .turn_writes
                .find(&receipt)
                .is_none());
        }
    }
}
