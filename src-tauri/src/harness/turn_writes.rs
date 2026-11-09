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
/// Whole budget of one `bind_original` call, shared by every wait inside it.
const BIND_BUDGET: Duration = Duration::from_secs(12);
/// Whole budget of one controlled write, including its authority lease wait.
const CONTROLLED_WRITE_BUDGET: Duration = Duration::from_secs(12);

impl Binding {
    fn wait_until(&self, deadline: Instant) -> Result<ChildTurnBinding, String> {
        let ready = self
            .ready
            .lock()
            .map_err(|_| "NATIVE_TURN_BINDING_UNAVAILABLE")?;
        let wait = deadline.saturating_duration_since(Instant::now());
        let (ready, _) = self
            .changed
            .wait_timeout_while(ready, wait, |result| result.is_none())
            .map_err(|_| "NATIVE_TURN_BINDING_UNAVAILABLE")?;
        ready
            .as_ref()
            .ok_or("Turn binding timed out; previous write may still be in flight")?
            .clone()?;
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
        (self.turn.finished() || self.turn.writes.settled())
            && self.ready.lock().is_ok_and(|ready| ready.is_some())
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
        self.records.retain(|binding| !binding.reclaimable());
        if self.records.len() >= CAPACITY {
            if let Some(index) = self
                .records
                .iter()
                .position(|binding| binding.reclaimable())
            {
                self.records.remove(index);
            }
        }
        self.records.retain(|binding| !binding.reclaimable());
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
        live.native_session_capability.as_ref().map_or_else(
            || output.target().to_owned(),
            |capability| capability.shell_id().to_owned(),
        ),
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
    // Every wait below shares one deadline instead of stacking fresh ones.
    let deadline = Instant::now() + BIND_BUDGET;
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
        let result = plan.binding.wait_until(deadline)?;
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
            let result = if old.writes.settled() {
                if let Err(error) = &result {
                    log::warn!("predecessor write failed: {error}");
                }
                Ok(())
            } else {
                result
            };
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
        // `finish` settled it already; a spent budget must not turn that into a timeout.
        plan.binding
            .wait_until(Instant::now() + Duration::from_secs(1))
    }
}

#[tauri::command]
pub async fn harness_bind_turn(
    window: tauri::WebviewWindow,
    session_id: String,
    construction_id: String,
    control_turn: crate::control::ControlTurnReceipt,
) -> Result<ChildTurnBinding, String> {
    crate::harness::run_blocking("harness_bind_turn", move || {
        let app = window.app_handle().clone();
        let host = app.state::<HarnessHost>();
        let control = app.state::<crate::control::ControlHost>();
        harness_bind_turn_blocking(
            window,
            host,
            control,
            session_id,
            construction_id,
            control_turn,
        )
    })
    .await
}

fn harness_bind_turn_blocking(
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

/// The response deadline never kills P. The blocking writer retains all
/// original permits and lease until its actual I/O and callback tail finish.
#[cfg(test)]
fn write_controlled(
    live: Arc<LiveChild>,
    line: String,
    authority: Option<crate::session_store::authority::NativeLease>,
    admission: StrictWrite,
    after_io: impl FnOnce() + Send + 'static,
) -> Result<(), String> {
    write_controlled_within(
        live,
        line,
        authority,
        admission,
        after_io,
        CONTROLLED_WRITE_BUDGET,
    )
}

fn write_controlled_within(
    live: Arc<LiveChild>,
    line: String,
    mut authority: Option<crate::session_store::authority::NativeLease>,
    mut admission: StrictWrite,
    after_io: impl FnOnce() + Send + 'static,
    wait: Duration,
) -> Result<(), String> {
    // Idempotent; a no-op when the command already queued before its lease.
    let deadline = Instant::now() + wait;
    admission.physical.acquire(deadline)?;
    let wait = deadline.saturating_duration_since(Instant::now());
    if let Some(lease) = authority.as_mut() {
        lease.begin_external()?;
    }
    admission.start();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = (|| {
            let mut stdin = live
                .stdin
                .try_lock()
                .map_err(|_| crate::harness::PROVIDER_NOT_READING.to_string())?;
            stdin
                .write_all(line.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|error| format!("Failed to write original controlled harness: {error}"))
        })();
        after_io();
        let cleanup = authority.map_or(Ok(()), |lease| lease.finish());
        let result = result.and(cleanup);
        admission.finish(&result);
        let _ = tx.send(result);
    });
    rx.recv_timeout(wait).map_err(|_| {
        "Provider stdin delivery outcome unknown; do not retry while writing".to_string()
    })?
}

#[tauri::command]
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
    native_session_capability: Option<
        crate::session_store::canonical_store::NativeSessionCapability,
    >,
    native_process_purpose: Option<crate::session_store::canonical_store::NativeProcessPurpose>,
) -> Result<(), String> {
    let issuer = crate::control::receipts::existing(&window)?;
    let live = host.get_original(&session_id, Some(&construction_id))?;
    if live.management_input_policy.is_some() != live.management_route_id.is_some() {
        return Err("NATIVE_MANAGEMENT_ROUTE_INVALID".into());
    }
    if let Some(policy) = live.management_input_policy {
        super::management_authority::validate_input(policy, &line, &live.cwd)?;
    }
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
    let target = live.native_session_capability.as_ref().map_or_else(
        || original.output.target().to_owned(),
        |capability| capability.shell_id().to_owned(),
    );
    // Lease SQL must not run on the async command thread.
    tauri::async_runtime::spawn_blocking(move || {
        if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
            && live.native_session_capability != native_session_capability
        {
            return Err("CANONICAL_SESSION_CONSTRUCTION_MISMATCH".into());
        }
        if crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED
            && live.native_process_purpose != native_process_purpose
        {
            return Err("NATIVE_PROCESS_PURPOSE_MISMATCH".into());
        }
        let _purpose_admission = native_process_purpose
            .as_ref()
            .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
            .map(|purpose| {
                crate::session_store::canonical_store::admit_process_purpose(
                    &window.as_ref().window(),
                    purpose,
                )
            })
            .transpose()?;
        let _session_admission = native_session_capability
            .as_ref()
            .filter(|_| crate::session_store::canonical_store::SESSION_EFFECT_GUARD_ENABLED)
            .map(|capability| {
                crate::session_store::canonical_store::admit_session_effect(
                    &app,
                    &window.as_ref().window(),
                    &target,
                    capability,
                )
            })
            .transpose()?;
        // The write deadline starts before the lease wait, as in `harness_write`.
        let deadline = Instant::now() + CONTROLLED_WRITE_BUDGET;
        // Queue behind earlier writes to this child (FIFO) before taking a lease.
        let mut admission = admission;
        admission.physical.acquire(deadline)?;
        let lease = reserve_authority_within(
            gate,
            target,
            "provider-stdin",
            scope,
            false,
            AUTHORITY_LEASE_WAIT.min(deadline.saturating_duration_since(Instant::now())),
        )?;
        let line = crate::social_bridge::authorize_acp_frame(&session_id, line);
        let line = crate::runtime_logs_bridge::authorize_acp_frame(&session_id, line);
        let line = crate::conversation_tools_bridge::authorize_acp_frame(&session_id, line);
        write_controlled_within(
            live,
            line,
            Some(lease),
            admission,
            || {},
            deadline.saturating_duration_since(Instant::now()),
        )
    })
    .await
    .map_err(|error| format!("Controlled harness write task failed: {error}"))?
}

#[cfg(test)]
#[path = "turn_write_tests.rs"]
mod tests;
