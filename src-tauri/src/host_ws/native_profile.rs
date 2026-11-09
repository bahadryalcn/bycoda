//! Native-selected profile access is a distinct authorization context from a
//! renderer-selected machine. It shares the same broker engine, not window
//! ownership. No constructor or scope is exposed through Serde/IPC.
use super::*;
use std::sync::Weak;

pub(super) fn native_profile_recovery(method: &str) -> bool {
    matches!(
        method,
        "native.buffers.recovery.list"
            | "native.buffers.recovery.read"
            | "native.buffers.recovery.status"
    )
}

const MAX_CALLERS: usize = 128;
const ANCHOR: &str = "native-profile-owner";

struct Scope {
    valid: AtomicBool,
    machine: String,
    environment: String,
}
#[derive(Default)]
struct Lifecycle {
    closed: bool,
    callers: Vec<Weak<Scope>>,
}
#[derive(Default)]
struct State {
    broker: HostWsBroker,
    lifecycle: Mutex<Lifecycle>,
}
impl Drop for State {
    fn drop(&mut self) {
        self.broker.shutdown();
    }
}

/// One process-owned pool for the private Native profile authorization context.
/// Window detach operates only on RemoteConnections' separate window pool.
#[derive(Default)]
pub(crate) struct NativeProfileBroker {
    state: Arc<State>,
}
impl Drop for NativeProfileBroker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub(crate) struct NativeProfileCaller {
    state: Arc<State>,
    scope: Arc<Scope>,
    route: NativeRoute,
    consumer: String,
    request_scope: RequestScope,
}
pub(crate) struct NativeProfilePending {
    pending: PendingRequest,
    caller: Arc<NativeProfileCaller>,
}
pub(crate) struct NativeProfilePrepared {
    prepared: PreparedRequest,
    caller: Arc<NativeProfileCaller>,
}
impl NativeProfilePrepared {
    fn enqueue(&mut self) -> Result<NativeProfilePending, WsFailure> {
        let pending = self.prepared.enqueue()?;
        Ok(NativeProfilePending {
            pending,
            caller: self.caller.clone(),
        })
    }
}
pub(crate) struct NativeProfileReply {
    reply: WsReply,
    caller: Arc<NativeProfileCaller>,
}
pub(crate) struct NativeProfileGuard {
    guard: ReplyGuard,
    caller: Arc<NativeProfileCaller>,
}

/// Borrowed only during joint issuer/target admission. No serialized fields or
/// unchecked caller constructor can mint an enqueue authority outside the gate.
pub(crate) struct NativeDeviceAdmission<'a> {
    target: &'a NativeProfileCaller,
}
impl NativeDeviceAdmission<'_> {
    pub(crate) fn begin(
        &self,
        target: &Arc<NativeProfileCaller>,
        prepared: &mut NativeProfilePrepared,
    ) -> Result<NativeProfilePending, WsFailure> {
        if !std::ptr::eq(self.target, target.as_ref())
            || !Arc::ptr_eq(target, &prepared.caller)
            || !matches!(target.request_scope, RequestScope::NativeDevice)
        {
            return Err(unavailable());
        }
        target.check()?;
        prepared.enqueue()
    }
}

fn unavailable() -> WsFailure {
    WsFailure::local(
        "RPC_NATIVE_PROFILE_RETIRED",
        "Native profile access changed or retired",
    )
}
impl NativeProfileBroker {
    pub(crate) fn supports_params(method: &str, params: &Value) -> bool {
        Self::supports_scoped_params(method, params, RequestScope::NativeProfile)
    }

    pub(crate) fn supports_workspace_params(method: &str, params: &Value) -> bool {
        Self::supports_scoped_params(method, params, RequestScope::NativeWorkspace)
    }

    pub(crate) fn supports_gateway_params(method: &str, params: &Value) -> bool {
        Self::supports_scoped_params(method, params, RequestScope::NativeGateway)
    }

    pub(crate) fn supports_service_params(method: &str, params: &Value) -> bool {
        Self::supports_scoped_params(method, params, RequestScope::NativeService)
    }

    pub(crate) fn supports_device_params(method: &str, params: &Value) -> bool {
        Self::supports_scoped_params(method, params, RequestScope::NativeDevice)
    }

    pub(crate) fn supports_peer_service_params(method: &str, params: &Value) -> bool {
        Self::supports_scoped_params(method, params, RequestScope::NativePeerService)
    }

    pub(crate) fn validates_workspace_params(method: &str, params: &Value) -> bool {
        native_workspace_method(method)
            && Contracts::get().is_ok_and(|contracts| {
                contracts
                    .methods
                    .get(method)
                    .is_some_and(|descriptor| descriptor.params.is_valid(params))
            })
    }

    fn supports_scoped_params(method: &str, params: &Value, scope: RequestScope) -> bool {
        let allowed = match scope {
            RequestScope::NativeProfile => native_profile_recovery(method),
            RequestScope::NativeWorkspace => native_workspace_method(method),
            RequestScope::NativeGateway => native_gateway_method(method),
            RequestScope::NativeService => native_service_method(method),
            RequestScope::NativePeerService => native_peer_service_method(method),
            RequestScope::NativeDevice => native_device_method(method),
            RequestScope::Window => false,
        };
        allowed
            && Contracts::get().is_ok_and(|contracts| {
                contracts
                    .methods
                    .get(method)
                    .is_some_and(|descriptor| descriptor.params.is_valid(params))
                    && request_message_bytes(
                        method,
                        &"i".repeat(MAX_REQUEST_ID_BYTES),
                        params,
                        contracts.limit("maxMessageBytes"),
                    )
                    .is_some()
            })
    }

    /// The caller must pin and recheck the real Native-selected saved route.
    /// Merely possessing a renderer label or caller-supplied profile ID is not
    /// a call path to this factory. Remote WSS/SSH destinations are not profiles.
    pub(crate) fn capture(
        &self,
        route: NativeRoute,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        self.capture_scoped(route, RequestScope::NativeProfile)
    }

    pub(crate) fn capture_workspace(
        &self,
        route: NativeRoute,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        self.capture_scoped(route, RequestScope::NativeWorkspace)
    }

    pub(crate) fn capture_gateway(
        &self,
        route: NativeRoute,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        self.capture_scoped(route, RequestScope::NativeGateway)
    }

    pub(crate) fn capture_service(
        &self,
        route: NativeRoute,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        self.capture_scoped(route, RequestScope::NativeService)
    }

    pub(crate) fn capture_peer_service(
        &self,
        route: NativeRoute,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        self.capture_scoped(route, RequestScope::NativePeerService)
    }

    pub(crate) fn capture_device(
        &self,
        route: NativeRoute,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        self.capture_scoped(route, RequestScope::NativeDevice)
    }

    fn capture_scoped(
        &self,
        route: NativeRoute,
        request_scope: RequestScope,
    ) -> Result<Arc<NativeProfileCaller>, WsFailure> {
        let url = Url::parse(&route.endpoint).map_err(|_| unavailable())?;
        if !matches!(
            request_scope,
            RequestScope::NativeGateway
                | RequestScope::NativePeerService
                | RequestScope::NativeDevice
        ) && (url.scheme() != "ws" || !loopback(&url))
        {
            return Err(unavailable());
        }
        let mut lifecycle = self.state.lifecycle.lock().map_err(|_| unavailable())?;
        if lifecycle.closed {
            return Err(unavailable());
        }
        lifecycle.callers.retain(|scope| scope.strong_count() > 0);
        if lifecycle.callers.len() >= MAX_CALLERS {
            return Err(WsFailure::local(
                "RPC_WS_OVERLOAD",
                "Native profile caller limit reached",
            ));
        }
        let scope = Arc::new(Scope {
            valid: AtomicBool::new(true),
            machine: route.machine_id.clone(),
            environment: route.environment_id.clone(),
        });
        // Keep one physical connection for this context across short Native
        // requests. Only route retirement/shutdown removes this private owner.
        if matches!(
            request_scope,
            RequestScope::NativeProfile | RequestScope::NativeWorkspace
        ) {
            self.state.broker.connection(&route, ANCHOR)?;
        }
        lifecycle.callers.push(Arc::downgrade(&scope));
        Ok(Arc::new(NativeProfileCaller {
            state: self.state.clone(),
            scope,
            route,
            consumer: uuid::Uuid::new_v4().to_string(),
            request_scope,
        }))
    }

    /// True while this context holds a lane to `machine` in the blocked state.
    pub(crate) fn machine_blocked(&self, machine: &str) -> bool {
        self.state
            .broker
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .any(|handle| {
                handle.shared.route.machine_id == machine
                    && matches!(
                        handle.shared.last_state
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .as_ref(),
                        Some(NativeEvent::State { phase, .. }) if phase == "blocked"
                    )
            })
    }

    /// Only a fresh, successful identity probe of the same saved route may call
    /// this. Callers stay valid; their next request opens a new lane.
    pub(crate) fn retry_blocked_machine(&self, machine: &str) {
        self.state.broker.retry_blocked_machine(machine);
    }

    pub(crate) fn invalidate_machine(&self, machine: &str) {
        if let Ok(mut lifecycle) = self.state.lifecycle.lock() {
            lifecycle.callers.retain(|scope| {
                if let Some(scope) = scope.upgrade() {
                    if scope.machine == machine {
                        scope.valid.store(false, Ordering::Release);
                    }
                    true
                } else {
                    false
                }
            });
            self.state.broker.invalidate_machine(machine);
        }
    }
    pub(crate) fn invalidate_environment(&self, environment: &str) {
        if let Ok(mut lifecycle) = self.state.lifecycle.lock() {
            lifecycle.callers.retain(|scope| {
                if let Some(scope) = scope.upgrade() {
                    if scope.environment == environment {
                        scope.valid.store(false, Ordering::Release);
                    }
                    true
                } else {
                    false
                }
            });
            self.state.broker.invalidate_environment(environment);
        }
    }
    pub(crate) fn shutdown(&self) {
        if let Ok(mut lifecycle) = self.state.lifecycle.lock() {
            lifecycle.closed = true;
            for scope in lifecycle.callers.iter().filter_map(Weak::upgrade) {
                scope.valid.store(false, Ordering::Release);
            }
            self.state.broker.shutdown();
        }
    }
}

impl NativeProfileCaller {
    #[cfg(test)]
    pub(crate) fn is_current(&self) -> bool {
        self.check().is_ok()
    }
    fn check(&self) -> Result<(), WsFailure> {
        if self.scope.valid.load(Ordering::Acquire) && !self.state.lifecycle.is_poisoned() {
            Ok(())
        } else {
            Err(unavailable())
        }
    }
    pub(crate) fn begin(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeProfilePending, WsFailure> {
        let mut prepared = self.prepare(method, params, options)?;
        let lifecycle = self.state.lifecycle.lock().map_err(|_| unavailable())?;
        if lifecycle.closed {
            return Err(unavailable());
        }
        self.check()?;
        prepared.enqueue()
    }

    fn prepare(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeProfilePrepared, WsFailure> {
        // Preserve retirement's fence around connection/consumer allocation.
        // No retained resource gates are held during this preparation phase.
        let lifecycle = self.state.lifecycle.lock().map_err(|_| unavailable())?;
        if lifecycle.closed {
            return Err(unavailable());
        }
        self.check()?;
        let prepared = self.state.broker.prepare_request_scoped(
            &self.route,
            &self.consumer,
            method,
            params,
            options,
            self.request_scope,
        )?;
        Ok(NativeProfilePrepared {
            prepared,
            caller: self.clone(),
        })
    }

    /// Account/validate outside the borrowed issuer/target gates. The token is
    /// bound to this exact caller and cannot enqueue without actual admission.
    pub(crate) fn prepare_device(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeProfilePrepared, WsFailure> {
        if !matches!(self.request_scope, RequestScope::NativeDevice) {
            return Err(WsFailure::unsupported());
        }
        self.prepare(method, params, options)
    }
    /// Finite post-consumption cleanup admission. Only enqueue is enclosed by
    /// the real lifecycle/reply gates; callers wait after those gates are gone.
    pub(crate) fn begin_service_with_guards(
        self: &Arc<Self>,
        guards: &[&NativeProfileGuard],
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeProfilePending, WsFailure> {
        if !matches!(self.request_scope, RequestScope::NativeService)
            || method != "native.services.delivery.ack"
        {
            return Err(WsFailure::unsupported());
        }
        self.begin_delivery_ack(guards, method, params, options)
    }

    pub(crate) fn begin_workspace_with_guards(
        self: &Arc<Self>,
        guards: &[&NativeProfileGuard],
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeProfilePending, WsFailure> {
        if !matches!(self.request_scope, RequestScope::NativeWorkspace)
            || method != "native.buffers.delivery.ack"
        {
            return Err(WsFailure::unsupported());
        }
        self.begin_delivery_ack(guards, method, params, options)
    }

    fn begin_delivery_ack(
        self: &Arc<Self>,
        guards: &[&NativeProfileGuard],
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<NativeProfilePending, WsFailure> {
        let mut prepared = self.prepare(method, params, options)?;
        let outcome =
            NativeProfileGuard::admit_callers(&[self.as_ref()], guards, self.request_scope, || {
                Ok(prepared.enqueue())
            });
        // `prepared` (including any failed Request/Slot) outlives every gate
        // acquired by admit_callers, even when admission or try_send fails.
        outcome.map_err(|_| unavailable())?
    }
}
impl Drop for NativeProfileCaller {
    fn drop(&mut self) {
        self.state
            .broker
            .detach_machine(&self.route.machine_id, &self.consumer);
    }
}
impl NativeProfilePending {
    pub(crate) fn wait(self) -> Result<NativeProfileReply, WsFailure> {
        // Preserve dispatch identity before wait consumes the pending request.
        // A successful Host reply proves a mutating request may have taken effect
        // even when its Native caller retires before final delivery.
        let mutating = self.pending.mutating;
        let request_id = self.pending.id.clone();
        let command_id = self.pending.command_id.clone();
        Self::finish_reply(
            self.caller,
            self.pending.wait(),
            mutating,
            request_id,
            command_id,
        )
    }

    fn finish_reply(
        caller: Arc<NativeProfileCaller>,
        result: Result<WsReply, WsFailure>,
        mutating: bool,
        request_id: String,
        command_id: Option<String>,
    ) -> Result<NativeProfileReply, WsFailure> {
        // Genuine pre-dispatch failures retain their original classification.
        let reply = result?;
        caller.check().map_err(|mut error| {
            error.generation = Some(reply.generation);
            error.request_id = Some(request_id);
            error.command_id = command_id;
            error.uncertain = mutating;
            error.unsupported = false;
            error
        })?;
        Ok(NativeProfileReply { reply, caller })
    }
}
impl NativeProfileReply {
    pub(crate) fn into_guarded(self) -> (Value, NativeProfileGuard) {
        let (value, guard) = self.reply.into_guarded_result();
        (
            value,
            NativeProfileGuard {
                guard,
                caller: self.caller,
            },
        )
    }
}
impl NativeProfileGuard {
    /// One short local fence for two distinct, real authorization contexts.
    /// Lock each lifecycle once in process-wide pointer order, then every reply
    /// resource/bulk gate once. Network waits and UI effects stay outside it.
    pub(crate) fn admit_device_with_issuer<T>(
        issuer: &NativeProfileCaller,
        issuer_guards: &[&Self],
        target: &NativeProfileCaller,
        target_guards: &[&Self],
        admit: impl FnOnce(&NativeDeviceAdmission<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        if !matches!(issuer.request_scope, RequestScope::NativeService)
            || !matches!(target.request_scope, RequestScope::NativeDevice)
            || issuer_guards
                .iter()
                .any(|g| !std::ptr::eq(g.caller.as_ref(), issuer))
            || target_guards
                .iter()
                .any(|g| !std::ptr::eq(g.caller.as_ref(), target))
        {
            return Err(
                "Device projection requires its original issuer and target contexts".into(),
            );
        }
        let mut states = vec![&issuer.state, &target.state];
        states.sort_unstable_by_key(|state| Arc::as_ptr(state));
        states.dedup_by(|left, right| Arc::ptr_eq(left, right));
        let lifecycles = states
            .iter()
            .map(|state| {
                state
                    .lifecycle
                    .lock()
                    .map_err(|_| "Native joint admission fence is unavailable".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        if lifecycles.iter().any(|state| state.closed) {
            return Err(unavailable().to_string());
        }
        issuer.check().map_err(|e| e.to_string())?;
        target.check().map_err(|e| e.to_string())?;
        let guards = issuer_guards
            .iter()
            .chain(target_guards.iter())
            .map(|g| &g.guard)
            .collect::<Vec<_>>();
        ReplyGuard::commit_many(&guards, || admit(&NativeDeviceAdmission { target }))
    }

    /// Admit one operation while the caller and disclosure leases are current.
    /// The callback must be short and must never perform network IO. Retained
    /// replies continue owning their byte/resource charges after admission.
    pub(crate) fn admit_gateway<T>(
        callers: &[&NativeProfileCaller],
        guards: &[&NativeProfileGuard],
        admit: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        Self::admit_callers(callers, guards, RequestScope::NativeGateway, admit)
    }

    pub(crate) fn admit_service<T>(
        callers: &[&NativeProfileCaller],
        guards: &[&NativeProfileGuard],
        admit: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        Self::admit_callers(callers, guards, RequestScope::NativeService, admit)
    }

    pub(crate) fn admit_workspace<T>(
        callers: &[&NativeProfileCaller],
        guards: &[&NativeProfileGuard],
        admit: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        Self::admit_callers(callers, guards, RequestScope::NativeWorkspace, admit)
    }

    pub(crate) fn admit_peer_service<T>(
        callers: &[&NativeProfileCaller],
        guards: &[&NativeProfileGuard],
        admit: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        Self::admit_callers(callers, guards, RequestScope::NativePeerService, admit)
    }

    fn admit_callers<T>(
        callers: &[&NativeProfileCaller],
        guards: &[&NativeProfileGuard],
        scope: RequestScope,
        admit: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let first = callers
            .first()
            .copied()
            .or_else(|| guards.first().map(|g| g.caller.as_ref()))
            .ok_or_else(|| "Native admission requires an actual caller".to_owned())?;
        let same_context = |caller: &NativeProfileCaller| {
            Arc::ptr_eq(&first.state, &caller.state)
                && first.route.key == caller.route.key
                && std::mem::discriminant(&caller.request_scope) == std::mem::discriminant(&scope)
        };
        if callers.iter().any(|caller| !same_context(caller))
            || guards.iter().any(|guard| !same_context(&guard.caller))
        {
            return Err("Native replies belong to different caller contexts".into());
        }
        let lifecycle = first
            .state
            .lifecycle
            .lock()
            .map_err(|_| "Native admission fence is unavailable".to_owned())?;
        if lifecycle.closed {
            return Err(unavailable().to_string());
        }
        for caller in callers
            .iter()
            .copied()
            .chain(guards.iter().map(|g| g.caller.as_ref()))
        {
            caller.check().map_err(|error| error.to_string())?;
        }
        let replies = guards.iter().map(|g| &g.guard).collect::<Vec<_>>();
        ReplyGuard::commit_many(&replies, admit)
    }

    pub(crate) fn commit_many<T>(
        guards: &[&Self],
        consume: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let Some(first) = guards.first() else {
            return consume();
        };
        if guards.iter().any(|guard| {
            !Arc::ptr_eq(&first.caller.state, &guard.caller.state)
                || first.caller.route.key != guard.caller.route.key
                || std::mem::discriminant(&first.caller.request_scope)
                    != std::mem::discriminant(&guard.caller.request_scope)
        }) {
            return Err("Native projections belong to different caller contexts".into());
        }
        // One shared lock for all nested replies. Individual caller scopes are
        // checked under it; locking per reply would recursively deadlock.
        let lifecycle = first
            .caller
            .state
            .lifecycle
            .lock()
            .map_err(|_| "Native caller commit fence is unavailable".to_owned())?;
        if lifecycle.closed {
            return Err(unavailable().to_string());
        }
        for guard in guards {
            guard.caller.check().map_err(|error| error.to_string())?;
        }
        let replies = guards.iter().map(|guard| &guard.guard).collect::<Vec<_>>();
        ReplyGuard::commit_many(&replies, consume)
    }

    pub(crate) fn check(&self) -> Result<(), WsFailure> {
        self.caller.check()?;
        self.guard.check()
    }
}

#[cfg(test)]
mod commit_tests {
    use super::*;

    #[test]
    fn guarded_delivery_cleanup_cannot_cross_private_scopes_or_admit_other_effects() {
        let pool = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "local",
            "env",
            "http://127.0.0.1:9",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let service = pool.capture_service(route.clone()).unwrap();
        let workspace = pool.capture_workspace(route.clone()).unwrap();
        let device = pool.capture_device(route).unwrap();
        for caller in [&workspace, &device] {
            assert!(
                caller
                    .begin_service_with_guards(
                        &[],
                        "native.services.delivery.ack",
                        json!({}),
                        RequestOptions::default()
                    )
                    .err()
                    .unwrap()
                    .unsupported
            );
        }
        assert!(
            service
                .begin_workspace_with_guards(
                    &[],
                    "native.buffers.delivery.ack",
                    json!({}),
                    RequestOptions::default()
                )
                .err()
                .unwrap()
                .unsupported
        );
        assert!(
            service
                .begin_service_with_guards(
                    &[],
                    "native.services.delivery.apply",
                    json!({}),
                    RequestOptions::default()
                )
                .err()
                .unwrap()
                .unsupported
        );
        assert!(
            workspace
                .begin_workspace_with_guards(
                    &[],
                    "native.buffers.update",
                    json!({}),
                    RequestOptions::default()
                )
                .err()
                .unwrap()
                .unsupported
        );
        pool.invalidate_machine("local");
        let failure = service
            .begin_service_with_guards(
                &[],
                "native.services.delivery.ack",
                json!({}),
                RequestOptions::default(),
            )
            .err()
            .unwrap();
        assert_eq!(failure.code, "RPC_NATIVE_PROFILE_RETIRED");
    }

    #[test]
    fn device_admission_requires_original_scope_and_cannot_enqueue_for_another_target() {
        let issuer_pool = NativeProfileBroker::default();
        let target_pool = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "local",
            "env",
            "http://127.0.0.1:9",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let issuer = issuer_pool.capture_service(route.clone()).unwrap();
        let target = target_pool.capture_device(route.clone()).unwrap();
        let other = target_pool.capture_device(route.clone()).unwrap();
        let wrong_issuer = issuer_pool.capture_gateway(route).unwrap();
        assert!(NativeProfileGuard::admit_device_with_issuer(
            &wrong_issuer,
            &[],
            &target,
            &[],
            |_| Ok(())
        )
        .is_err());
        let mut prepared = target
            .prepare_device("devices.status", json!({}), RequestOptions::default())
            .unwrap();
        NativeProfileGuard::admit_device_with_issuer(&issuer, &[], &target, &[], |admission| {
            let rejected = admission.begin(&other, &mut prepared).err().unwrap();
            assert_eq!(rejected.code, "RPC_NATIVE_PROFILE_RETIRED");
            Ok(())
        })
        .unwrap();
        target_pool.invalidate_machine("local");
        assert!(
            NativeProfileGuard::admit_device_with_issuer(&issuer, &[], &target, &[], |_| Ok(()))
                .is_err()
        );
    }

    #[test]
    fn joint_device_gates_do_not_deadlock_when_issuer_and_target_pools_are_reversed() {
        let first = NativeProfileBroker::default();
        let second = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "local",
            "env",
            "http://127.0.0.1:9",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let issuer_first = first.capture_service(route.clone()).unwrap();
        let target_first = first.capture_device(route.clone()).unwrap();
        let issuer_second = second.capture_service(route.clone()).unwrap();
        let target_second = second.capture_device(route).unwrap();
        let gate = Arc::new(std::sync::Barrier::new(2));
        std::thread::scope(|threads| {
            fn run(
                issuer: &NativeProfileCaller,
                target: &NativeProfileCaller,
                gate: &std::sync::Barrier,
            ) {
                gate.wait();
                for _ in 0..100 {
                    NativeProfileGuard::admit_device_with_issuer(issuer, &[], target, &[], |_| {
                        Ok(())
                    })
                    .unwrap();
                }
            }
            let left = threads.spawn(|| run(&issuer_first, &target_second, &gate));
            let right = threads.spawn(|| run(&issuer_second, &target_first, &gate));
            left.join().unwrap();
            right.join().unwrap();
        });
    }

    #[test]
    fn private_service_and_gateway_factories_are_lazy_finite_and_retire_without_window_ownership() {
        let broker = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "local",
            "env",
            "http://127.0.0.1:9",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let service = broker.capture_service(route.clone()).unwrap();
        let gateway = broker.capture_gateway(route).unwrap();
        assert!(service.is_current() && gateway.is_current());
        assert!(
            broker.state.broker.connections.lock().unwrap().is_empty(),
            "HTTP compatibility must not connect WS"
        );
        assert!(NativeProfileGuard::admit_service(&[&service], &[], || Ok(())).is_ok());
        assert!(NativeProfileGuard::admit_gateway(&[&service], &[], || Ok(())).is_err());
        assert!(NativeProfileGuard::admit_gateway(&[&gateway], &[], || Ok(())).is_ok());
        assert!(
            service
                .begin(
                    "devServers.bridgeRead",
                    json!({"streamId":"s"}),
                    RequestOptions::default()
                )
                .err()
                .unwrap()
                .unsupported
        );
        assert!(
            gateway
                .begin(
                    "native.services.conversation.desktop.take",
                    json!({}),
                    RequestOptions::default()
                )
                .err()
                .unwrap()
                .unsupported
        );
        broker.invalidate_machine("local");
        assert!(!service.is_current() && !gateway.is_current());
        assert!(NativeProfileGuard::admit_service(&[&service], &[], || Ok(())).is_err());
    }

    #[test]
    fn gateway_io_admission_keeps_owner_without_locking_retirement_through_socket_waits() {
        let broker = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "paired",
            "env",
            "https://host.example",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let gateway = broker.capture_gateway(route.clone()).unwrap();
        assert!(
            broker.capture_service(route.clone()).is_err(),
            "local service selection cannot become a paired service"
        );
        let peer = broker.capture_peer_service(route).unwrap();
        assert!(NativeProfileGuard::admit_service(&[&peer], &[], || Ok(())).is_err());
        let admitted_owner =
            NativeProfileGuard::admit_gateway(&[&gateway], &[], || Ok(gateway.clone())).unwrap();
        // This retained owner stands in for an admitted, pending original-socket
        // write. Retirement must not wait for it or permit a new admission.
        broker.invalidate_machine("paired");
        assert!(!admitted_owner.is_current());
        assert!(NativeProfileGuard::admit_gateway(&[&admitted_owner], &[], || Ok(())).is_err());
        assert!(!peer.is_current());
    }

    fn guard(state: &Arc<State>, route: &NativeRoute) -> NativeProfileGuard {
        let scope = Arc::new(Scope {
            valid: AtomicBool::new(true),
            machine: route.machine_id.clone(),
            environment: route.environment_id.clone(),
        });
        state
            .lifecycle
            .lock()
            .unwrap()
            .callers
            .push(Arc::downgrade(&scope));
        NativeProfileGuard {
            guard: ReplyGuard {
                disclosure: None,
                bulk: None,
            },
            caller: Arc::new(NativeProfileCaller {
                state: state.clone(),
                scope,
                route: route.clone(),
                consumer: uuid::Uuid::new_v4().to_string(),
                request_scope: RequestScope::NativeWorkspace,
            }),
        }
    }

    #[test]
    fn native_post_success_caller_retirement_preserves_original_delivery_identity() {
        for mutating in [false, true] {
            let broker = NativeProfileBroker::default();
            let route = NativeRoute::new(
                "local",
                "env",
                "http://127.0.0.1:3774",
                "fixture-token",
                "principal",
            )
            .unwrap();
            let pending_caller = guard(&broker.state, &route).caller;
            let success = WsReply::new(42, serde_json::json!({"acknowledged":true}));
            broker.invalidate_machine("local");
            let error = NativeProfilePending::finish_reply(
                pending_caller,
                Ok(success),
                mutating,
                "original-request".into(),
                Some("original-command".into()),
            )
            .err()
            .expect("retired caller cannot deliver a successful reply");
            assert_eq!(error.code, "RPC_NATIVE_PROFILE_RETIRED");
            assert_eq!(error.generation, Some(42));
            assert_eq!(error.request_id.as_deref(), Some("original-request"));
            assert_eq!(error.command_id.as_deref(), Some("original-command"));
            assert_eq!(error.uncertain, mutating);
            assert!(
                !error.unsupported,
                "a dispatched result must never enable fallback"
            );
        }
    }

    #[test]
    fn native_post_wait_retirement_does_not_reclassify_genuine_predispatch_failure() {
        let broker = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "local",
            "env",
            "http://127.0.0.1:3774",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let caller = guard(&broker.state, &route).caller;
        broker.invalidate_machine("local");
        let error = NativeProfilePending::finish_reply(
            caller,
            Err(WsFailure::unsupported()),
            true,
            "unsent-request".into(),
            Some("unsent-command".into()),
        )
        .err()
        .expect("pre-dispatch rejection remains an error");
        assert_eq!(error.code, "RPC_WS_UNSUPPORTED");
        assert!(!error.uncertain);
        assert!(error.unsupported);
        assert!(error.request_id.is_none());
        assert!(error.command_id.is_none());
        assert!(error.generation.is_none());
    }

    #[test]
    fn native_commit_shared_caller_lifecycle_locks_once_and_retirement_waits() {
        let broker = NativeProfileBroker::default();
        let route = NativeRoute::new(
            "local",
            "env",
            "http://127.0.0.1:3774",
            "fixture-token",
            "principal",
        )
        .unwrap();
        let outer = guard(&broker.state, &route);
        let inner = guard(&broker.state, &route);
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let (retired_tx, retired_rx) = std::sync::mpsc::sync_channel(1);
        std::thread::scope(|threads| {
            let outer = &outer;
            let inner = &inner;
            let sql = threads.spawn(move || {
                NativeProfileGuard::commit_many(&[outer, inner, outer], || {
                    entered_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let broker = &broker;
            let retired = threads.spawn(move || {
                broker.invalidate_machine("local");
                retired_tx.send(()).unwrap();
            });
            let blocked = retired_rx.recv_timeout(Duration::from_millis(40)).is_err();
            release_tx.send(()).unwrap();
            sql.join().unwrap().unwrap();
            retired.join().unwrap();
            assert!(blocked);
        });
        assert!(NativeProfileGuard::commit_many(&[&outer, &inner], || Ok(())).is_err());
    }

    #[test]
    fn guarded_ack_prepares_before_resource_gate_and_rejects_concurrent_retirement() {
        use crate::host_ws::tests::{accept, hello, next, result, Server};
        use futures_util::StreamExt;
        for service in [false, true] {
            let status_method = if service {
                "native.services.delivery.status"
            } else {
                "native.buffers.delivery.status"
            };
            let ack_method = if service {
                "native.services.delivery.ack"
            } else {
                "native.buffers.delivery.ack"
            };
            let (done, finished) = mpsc::channel();
            let (verified, verification) = mpsc::channel();
            let server = Server::spawn(move |listener| async move {
                let mut socket = accept(&listener).await;
                hello(&mut socket, &[status_method, ack_method], "host.1").await;
                let warm = next(&mut socket).await;
                let mut recorded = warm["params"].clone();
                recorded["state"] = json!("recorded");
                recorded["result"] = if service {
                    json!({"accepted":true})
                } else {
                    json!({"acknowledged":true})
                };
                result(&mut socket, &warm, recorded).await;
                let mut stop = tokio::task::spawn_blocking(move || {
                    finished.recv_timeout(Duration::from_secs(5)).unwrap()
                });
                tokio::select! {
                    _ = &mut stop => {verified.send(false).unwrap();}
                    message = socket.next() => {
                        let mut saw_ack = false;
                        if let Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) = message {
                            let request:Value = serde_json::from_str(&text).unwrap();
                            assert_eq!(request["method"], ack_method);
                            saw_ack = true;
                            let mut receipt = request["params"].clone();
                            receipt["state"] = json!("retired");
                            result(&mut socket, &request, receipt).await;
                        }
                        stop.await.unwrap();
                        verified.send(saw_ack).unwrap();
                    }
                }
            });
            let broker = NativeProfileBroker::default();
            let route = NativeRoute::new(
                "local",
                "host.1",
                &server.endpoint,
                "secret-native-token",
                "race-fixture",
            )
            .unwrap();
            let caller = if service {
                broker.capture_service(route.clone())
            } else {
                broker.capture_workspace(route.clone())
            }
            .unwrap();
            let mut params = json!({"originalId":"11111111-1111-4111-8111-111111111111","sha256":"a".repeat(64),"byteLength":2});
            if service {
                params["target"] = json!("native.services.conversation.desktop.finish");
            }
            let (_, guard) = caller
                .begin(status_method, params.clone(), RequestOptions::default())
                .unwrap()
                .wait()
                .unwrap()
                .into_guarded();
            let resource = guard.guard.disclosure.as_ref().unwrap().resource.clone();
            let handle = caller
                .state
                .broker
                .connections
                .lock()
                .unwrap()
                .get(&route.key)
                .unwrap()
                .clone();
            params["consumedResult"] = json!({"sha256":"b".repeat(64),"byteLength":17});
            let ack_caller = caller.clone();
            let ids = handle.shared.ids.clone();
            let mut worker = None;
            let mut reached_ids = false;
            let resource_was_free = handle.shared.permits.with_state_lock_for_test(|revoke| {
                worker = Some(thread::spawn(move || {
                    let options = RequestOptions {
                        request_id: Some("ack-lock-order".into()),
                        ..RequestOptions::default()
                    };
                    if service {
                        ack_caller.begin_service_with_guards(&[&guard], ack_method, params, options)
                    } else {
                        ack_caller.begin_workspace_with_guards(
                            &[&guard],
                            ack_method,
                            params,
                            options,
                        )
                    }
                }));
                let bound = Instant::now() + Duration::from_secs(3);
                loop {
                    if ids.lock().unwrap().contains_key("ack-lock-order") {
                        reached_ids = true;
                        break;
                    }
                    if Instant::now() >= bound {
                        break;
                    }
                    thread::yield_now();
                }
                // Positive Core ID admission is before Permits.scope. While
                // that scope allocation is blocked on this real state lock,
                // the old resource must still be free to retire, not held by
                // the guarded wrapper. No elapsed timeout is success evidence.
                let free = reached_ids && resource.commit.try_lock().is_ok();
                if free {
                    revoke(&json!({"kind":"environment"}));
                }
                free
            });
            let outcome = worker.take().unwrap().join().unwrap();
            let rejected = outcome.is_err();
            if let Ok(pending) = outcome {
                let _ = pending.wait();
            }
            done.send(()).unwrap();
            let sent = verification.recv_timeout(Duration::from_secs(3)).unwrap();
            assert!(
                reached_ids && resource_was_free,
                "ACK allocated Core state while already holding its retained resource gate"
            );
            assert!(
                rejected && !sent,
                "retirement before guarded enqueue must reject without dispatch"
            );
            assert!(!handle
                .shared
                .ids
                .lock()
                .unwrap()
                .contains_key("ack-lock-order"));
        }
    }
}

#[cfg(test)]
#[path = "native_profile_blocked_tests.rs"]
mod blocked_tests;
