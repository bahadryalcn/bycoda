//! Private strict write views over an original physical child. Receipt values
//! select retained source objects; they never reconstruct them or retarget stdin.
use super::*;
use crate::control::writes::{TurnWork, WriteScope, WriteTicket, CAPACITY};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChildTurnBinding {
    version: u8,
    binding_id: String,
    session_id: String,
    construction_id: String,
    turn_id: String,
}
impl ChildTurnBinding {
    fn validate(&self) -> Result<(), String> {
        require_process_construction(Some(&self.binding_id))?;
        require_process_construction(Some(&self.construction_id))?;
        require_process_construction(Some(&self.turn_id))?;
        if self.version != 1 || self.session_id.is_empty() {
            return Err("NATIVE_TURN_BINDING_INVALID".into());
        }
        Ok(())
    }
}

struct Binding {
    receipt: ChildTurnBinding,
    route: String,
    live: Arc<LiveChild>,
    output: Arc<NativeOutputStream>,
    turn: Arc<TurnWork>,
    writes: Arc<WriteScope>,
    ready: Mutex<Option<Result<(), String>>>,
    changed: Condvar,
}
impl Binding {
    fn wait(&self) -> Result<ChildTurnBinding, String> {
        let ready = self
            .ready
            .lock()
            .map_err(|_| "NATIVE_TURN_BINDING_UNAVAILABLE")?;
        let ready = self
            .changed
            .wait_while(ready, |result| result.is_none())
            .map_err(|_| "NATIVE_TURN_BINDING_UNAVAILABLE")?;
        ready.as_ref().unwrap().clone()?;
        Ok(self.receipt.clone())
    }
    fn finish(&self, result: Result<(), String>) {
        if result.is_err() {
            self.writes.close();
        }
        *self.ready.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
        self.changed.notify_all();
    }
    fn reclaimable(&self) -> bool {
        self.turn.finished() && self.ready.lock().is_ok_and(|ready| ready.is_some())
    }
    fn matches_source(&self, route: &str, live: &Arc<LiveChild>, turn: &Arc<TurnWork>) -> bool {
        self.route == route
            && Arc::ptr_eq(&self.live, live)
            && Arc::ptr_eq(&self.turn, turn)
            && live
                .output
                .as_ref()
                .is_some_and(|output| Arc::ptr_eq(output, &self.output))
    }
}

#[derive(Default)]
pub(super) struct Bindings {
    records: Vec<Arc<Binding>>,
}
struct BindPlan {
    binding: Arc<Binding>,
    predecessors: Vec<Arc<Binding>>,
    creator: bool,
    // Finish cannot report this turn drained while an admitted original bind
    // is still awaiting A. It settles without claiming stdin/provider effects.
    _operation: WriteTicket,
}
impl Bindings {
    fn prepare(
        &mut self,
        route: &str,
        live: &Arc<LiveChild>,
        turn: Arc<TurnWork>,
    ) -> Result<BindPlan, String> {
        let operation = turn.writes.admit()?;
        if let Some(binding) = self
            .records
            .iter()
            .find(|binding| binding.matches_source(route, live, &turn))
        {
            return Ok(BindPlan {
                binding: binding.clone(),
                predecessors: Vec::new(),
                creator: false,
                _operation: operation,
            });
        }
        if self.records.len() >= CAPACITY {
            if let Some(index) = self
                .records
                .iter()
                .position(|binding| binding.reclaimable())
            {
                self.records.remove(index);
            }
        }
        if self.records.len() >= CAPACITY {
            return Err("NATIVE_TURN_BINDING_CAPACITY".into());
        }
        let output = live
            .output
            .clone()
            .ok_or("NATIVE_TURN_OUTPUT_UNAVAILABLE")?;
        let binding = Arc::new(Binding {
            receipt: ChildTurnBinding {
                version: 1,
                binding_id: uuid::Uuid::new_v4().to_string(),
                session_id: turn.receipt.session_id.clone(),
                construction_id: live.construction_id.clone(),
                turn_id: turn.receipt.turn_id.clone(),
            },
            route: route.into(),
            live: live.clone(),
            output,
            turn,
            writes: Arc::default(),
            ready: Mutex::new(None),
            changed: Condvar::new(),
        });
        // Capacity is committed before closing any predecessor. Include pending
        // predecessors as well, so A→pending B→C cannot bypass A's held writer.
        let predecessors: Vec<_> = self
            .records
            .iter()
            .filter(|old| Arc::ptr_eq(&old.live, live))
            .cloned()
            .collect();
        self.records.push(binding.clone());
        for old in &predecessors {
            old.writes.close();
        }
        Ok(BindPlan {
            binding,
            predecessors,
            creator: true,
            _operation: operation,
        })
    }
    fn resolve(&self, receipt: &ChildTurnBinding) -> Result<Arc<Binding>, String> {
        receipt.validate()?;
        self.records
            .iter()
            .find(|binding| binding.receipt == *receipt)
            .cloned()
            .ok_or_else(|| "NATIVE_TURN_BINDING_STALE".into())
    }
}

fn source(
    live: &Arc<LiveChild>,
    issuer: &Arc<crate::control::receipts::WindowIssuer>,
) -> Result<(String, String), String> {
    if !live
        .issuer
        .as_ref()
        .is_some_and(|original| Arc::ptr_eq(original, issuer))
    {
        return Err("NATIVE_TURN_SOURCE_WINDOW_CHANGED".into());
    }
    let output = live
        .output
        .as_ref()
        .ok_or("NATIVE_TURN_OUTPUT_UNAVAILABLE")?;
    if output.epoch() != live.construction_id || live.writers.is_closing() {
        return Err("NATIVE_TURN_SOURCE_CHANGED".into());
    }
    Ok((
        output.target().into(),
        crate::control::canonical_child_cwd(&live.cwd)?,
    ))
}

fn original_current(
    inner: &HarnessInner,
    route: &str,
    live: &Arc<LiveChild>,
) -> Result<(), String> {
    if !inner
        .children
        .get(route)
        .is_some_and(|current| Arc::ptr_eq(current, live))
        || live.writers.is_closing()
    {
        return Err("NATIVE_PROCESS_CONSTRUCTION_STALE".into());
    }
    Ok(())
}

fn bind_original(
    host: &HarnessHost,
    control: &crate::control::ControlHost,
    issuer: &Arc<crate::control::receipts::WindowIssuer>,
    window: &str,
    route: &str,
    live: Arc<LiveChild>,
    receipt: crate::control::ControlTurnReceipt,
) -> Result<ChildTurnBinding, String> {
    let (target, cwd) = source(&live, issuer)?;
    let plan = crate::control::with_write_turn(
        control,
        issuer,
        window,
        &target,
        &cwd,
        &receipt,
        |turn| {
            let mut inner = host.lock_inner();
            original_current(&inner, route, &live)?;
            inner.turn_bindings.prepare(route, &live, turn)
        },
    )?;
    if !plan.creator {
        let result = plan.binding.wait()?;
        crate::control::with_write_turn(control, issuer, window, &target, &cwd, &receipt, |turn| {
            let inner = host.lock_inner();
            original_current(&inner, route, &live)?;
            if !plan.binding.matches_source(route, &live, &turn) {
                return Err("NATIVE_TURN_BINDING_STALE".into());
            }
            Ok(result)
        })
    } else {
        // Join every captured predecessor even when an earlier one failed. A first
        // error is not evidence that another admitted original writer has drained.
        let mut drained = Ok(());
        for old in &plan.predecessors {
            let result = old.writes.drain();
            if drained.is_ok() {
                drained = result;
            }
        }
        let result = drained.and_then(|_| {
            crate::control::with_write_turn(
                control,
                issuer,
                window,
                &target,
                &cwd,
                &receipt,
                |turn| {
                    let inner = host.lock_inner();
                    original_current(&inner, route, &live)?;
                    source(&live, issuer)?;
                    if !plan.binding.matches_source(route, &live, &turn) {
                        return Err("NATIVE_TURN_BINDING_STALE".into());
                    }
                    Ok(())
                },
            )
        });
        plan.binding.finish(result);
        plan.binding.wait()
    }
}

#[tauri::command(async)]
pub fn harness_bind_turn(
    window: tauri::WebviewWindow,
    host: State<'_, HarnessHost>,
    control: State<'_, crate::control::ControlHost>,
    session_id: String,
    construction_id: String,
    control_turn: crate::control::ControlTurnReceipt,
) -> Result<ChildTurnBinding, String> {
    let issuer = crate::control::receipts::existing(&window)?;
    let live = host.get_original(&session_id, Some(&construction_id))?;
    bind_original(
        &host,
        &control,
        &issuer,
        window.label(),
        &session_id,
        live,
        control_turn,
    )
}

struct StrictWrite {
    turn: WriteTicket,
    binding: WriteTicket,
    physical: LiveWrite,
}
impl StrictWrite {
    fn start(&mut self) {
        self.turn.start();
        self.binding.start();
        self.physical.started = true;
    }
    fn finish(self, result: &Result<(), String>) {
        self.physical.finish(result);
        self.binding.finish(result);
        self.turn.finish(result);
    }
}

fn admit_original(
    host: &HarnessHost,
    control: &crate::control::ControlHost,
    issuer: &Arc<crate::control::receipts::WindowIssuer>,
    window: &str,
    route: &str,
    live: &Arc<LiveChild>,
    receipt: &ChildTurnBinding,
) -> Result<(Arc<Binding>, StrictWrite), String> {
    let binding = host.lock_inner().turn_bindings.resolve(receipt)?;
    let (target, cwd) = source(live, issuer)?;
    crate::control::with_write_turn(
        control,
        issuer,
        window,
        &target,
        &cwd,
        &binding.turn.receipt,
        |turn| {
            let inner = host.lock_inner();
            original_current(&inner, route, live)?;
            if !binding.matches_source(route, live, &turn) {
                return Err("NATIVE_TURN_BINDING_STALE".into());
            }
            let ready = binding
                .ready
                .lock()
                .map_err(|_| "NATIVE_TURN_BINDING_UNAVAILABLE")?;
            if !matches!(&*ready, Some(Ok(()))) {
                return Err("NATIVE_TURN_BINDING_NOT_READY".into());
            }
            let admission = StrictWrite {
                turn: turn.writes.admit()?,
                binding: binding.writes.admit()?,
                physical: live.admit_write()?,
            };
            Ok((binding.clone(), admission))
        },
    )
}

/// There is deliberately no deadline that kills P to rotate turns. The actual
/// blocking writer retains all original permits and lease through join/tail.
fn write_controlled(
    live: Arc<LiveChild>,
    line: String,
    mut authority: Option<crate::session_store::authority::NativeLease>,
    mut admission: StrictWrite,
    after_io: impl FnOnce() + Send + 'static,
) -> Result<(), String> {
    if let Some(lease) = authority.as_mut() {
        lease.begin_external()?;
    }
    admission.start();
    let writer = thread::spawn(move || {
        let result = (|| {
            let mut stdin = live
                .stdin
                .lock()
                .map_err(|_| "NATIVE_TURN_STDIN_UNAVAILABLE".to_string())?;
            stdin
                .write_all(line.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|error| format!("Failed to write original controlled harness: {error}"))
        })();
        after_io();
        result.and_then(|_| authority.map_or(Ok(()), |lease| lease.finish()))
    });
    let result = writer
        .join()
        .map_err(|_| "NATIVE_TURN_WRITER_PANICKED".to_string())
        .and_then(|result| result);
    admission.finish(&result);
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn harness_write_controlled(
    app: AppHandle,
    window: tauri::WebviewWindow,
    host: State<'_, HarnessHost>,
    control: State<'_, crate::control::ControlHost>,
    session_id: String,
    construction_id: String,
    line: String,
    binding: ChildTurnBinding,
    authority_environment_id: Option<String>,
    authority_generation: Option<u64>,
) -> Result<(), String> {
    let issuer = crate::control::receipts::existing(&window)?;
    let live = host.get_original(&session_id, Some(&construction_id))?;
    let (original, admission) = admit_original(
        &host,
        &control,
        &issuer,
        window.label(),
        &session_id,
        &live,
        &binding,
    )?;
    let gate = original.output.control_gate(&app)?;
    let scope = native_authority_scope(authority_environment_id, authority_generation)?;
    // Strict turn admission has no JSON-shape bypass. Existing byte authority is
    // independent; a stale/closed turn is rejected before these rewrites/effects.
    let lease = gate.reserve_existing(
        original.output.target(),
        "provider-stdin",
        scope.as_ref(),
        false,
    )?;
    let line = crate::social_bridge::authorize_acp_frame(&session_id, line);
    let line = crate::runtime_logs_bridge::authorize_acp_frame(&session_id, line);
    let line = crate::conversation_tools_bridge::authorize_acp_frame(&session_id, line);
    tauri::async_runtime::spawn_blocking(move || {
        write_controlled(live, line, Some(lease), admission, || {})
    })
    .await
    .map_err(|error| format!("Controlled harness write task failed: {error}"))?
}

#[cfg(test)]
#[path = "turn_write_tests.rs"]
mod tests;
