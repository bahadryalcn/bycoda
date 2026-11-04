//! Actual native lifecycle observations for authority qualification.
//!
//! Every page start is a new native incarnation, including renderer-created
//! windows and reloads. Completion of a page load never certifies persisted
//! renderer state. Migration still requires the separate native write and
//! renderer drain barriers; these hooks alone cannot qualify a writer cohort.

use crate::session_store::window_barrier::{
    BarrierError, NativeLane, NativeOperation, WindowBarrier, WindowToken,
};
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Resource, ResourceTable, Webview, WebviewWindow};

mod admitted_work;
pub(crate) use admitted_work::run as run_admitted_blocking;

const SLOT_NAME: &str = "bycoda.native-window-lifecycle";

/// The physical Window owns this slot. Reusing a label creates a new resource
/// table. No token or proof is sent to the renderer; closing a resource cannot
/// manufacture a destroyed native window.
struct WindowSlot {
    barrier: WindowBarrier,
    token: Mutex<WindowToken>,
    // Always read/change under token first: a reload rotates this exact pair.
    buffer_incarnation: Mutex<uuid::Uuid>,
    buffer_owner_valid: AtomicBool,
}

impl WindowSlot {
    fn destroyed(&self) {
        // Same ordering as capture/group consumption and Resource::close.
        // Do not invalidate a physical owner halfway through its FULL callback.
        match self.token.lock() {
            Ok(token) => {
                self.buffer_owner_valid.store(false, Ordering::Release);
                let _ = self.barrier.observe_destroyed(&token);
            }
            Err(_) => {
                self.buffer_owner_valid.store(false, Ordering::Release);
                let _ = self.barrier.observe_unattributed_destruction();
            }
        }
    }
    fn reloaded(&self) {
        if let Ok(mut token) = self.token.lock() {
            if let Ok(reloaded) = self.barrier.observe_reloaded(&token) {
                *token = reloaded;
                if let Ok(mut incarnation) = self.buffer_incarnation.lock() {
                    *incarnation = uuid::Uuid::new_v4();
                } else {
                    self.buffer_owner_valid.store(false, Ordering::Release);
                    let _ = self.barrier.observe_unattributed_destruction();
                }
            }
        } else {
            let _ = self.barrier.observe_unattributed_destruction();
        }
    }
}

impl Resource for WindowSlot {
    fn name(&self) -> Cow<'_, str> {
        SLOT_NAME.into()
    }

    fn close(self: Arc<Self>) {
        // Serialize invalidation with exact owner+admission capture. A capture
        // already holding this lock is admitted old work, never a new owner.
        let _token = self.token.lock();
        self.buffer_owner_valid.store(false, Ordering::Release);
        let _ = self.barrier.observe_unattributed_destruction();
    }
}

/// Native-only owner capture, never deserialized from a renderer/label/PID.
pub(crate) struct NativeBufferOwner {
    store_instance: uuid::Uuid,
    incarnation: uuid::Uuid,
    label: String,
}

/// Opaque exact physical resource/incarnation capture, never an IPC argument.
pub(crate) struct NativeCheckpointWindow {
    slot: Arc<WindowSlot>,
    token: WindowToken,
    incarnation: uuid::Uuid,
    store_instance: uuid::Uuid,
}

impl NativeCheckpointWindow {
    pub(crate) fn incarnation(&self) -> uuid::Uuid {
        self.incarnation
    }

    pub(crate) fn same_capture(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.slot, &other.slot)
            && self.incarnation == other.incarnation
            && self.store_instance == other.store_instance
            && self.token.same_capture(&other.token)
    }
}

/// A borrowed proof of the owner locks held by with_checked_checkpoint_resources.
/// No Clone/Serde constructor, and the higher-ranked callback prevents escape.
pub(crate) struct CheckedCheckpointWindow<'scope> {
    owner: &'scope NativeCheckpointWindow,
    _scope: &'scope (),
}
impl CheckedCheckpointWindow<'_> {
    pub(crate) fn matches_store_instance(&self, instance: uuid::Uuid) -> bool {
        self.owner.store_instance == instance
    }

    /// Derive only from the actual physical owner already locked by the group.
    /// No resource-table or Store lookup may be performed under the FULL lock.
    pub(crate) fn buffer_owner(&self) -> NativeBufferOwner {
        NativeBufferOwner {
            store_instance: self.owner.store_instance,
            incarnation: self.owner.incarnation,
            label: self.owner.token.label().to_owned(),
        }
    }

    /// Pure capture comparison: callers already hold resource locks, then SQL.
    /// Reacquiring either here would invert the checkpoint lock order.
    pub(crate) fn matches(&self, captured: &NativeCheckpointWindow) -> bool {
        Arc::ptr_eq(&self.owner.slot, &captured.slot)
            && self.owner.incarnation == captured.incarnation
            && self.owner.store_instance == captured.store_instance
            && self.owner.token.same_capture(&captured.token)
    }
}

/// Exact captures whose physical locks are held together. This is not a roster
/// or migration proof; the caller must also hold the target barrier scope.
pub(crate) struct CheckedCheckpointGroup<'scope> {
    owners: &'scope [&'scope NativeCheckpointWindow],
    _scope: &'scope (),
}
impl CheckedCheckpointGroup<'_> {
    pub(crate) fn matches(&self, captured: &NativeCheckpointWindow) -> bool {
        self.owners.iter().any(|owner| {
            Arc::ptr_eq(&owner.slot, &captured.slot)
                && owner.incarnation == captured.incarnation
                && owner.store_instance == captured.store_instance
                && owner.token.same_capture(&captured.token)
        })
    }
    pub(crate) fn matches_store_instance(&self, instance: uuid::Uuid) -> bool {
        self.owners
            .iter()
            .all(|owner| owner.store_instance == instance)
    }
    pub(crate) fn matches_closed_roster(
        &self,
        closed: &crate::session_store::window_barrier::target::ClosedTargetAdmission,
    ) -> bool {
        self.owners.iter().all(|owner| {
            closed
                .windows()
                .iter()
                .any(|token| token.same_capture(&owner.token))
        })
    }
    pub(crate) fn checked_window<'a>(
        &'a self,
        owner: &'a NativeCheckpointWindow,
    ) -> Option<CheckedCheckpointWindow<'a>> {
        self.matches(owner).then_some(CheckedCheckpointWindow {
            owner,
            _scope: self._scope,
        })
    }

    pub(crate) fn with_target_scope<T>(
        &self,
        recipient: &NativeCheckpointWindow,
        closed: &crate::session_store::window_barrier::target::ClosedTargetAdmission,
        consume: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        if !self.matches(recipient) || !self.matches_closed_roster(closed) {
            return Err("NATIVE_CHECKPOINT_WRONG_ROSTER".into());
        }
        recipient
            .slot
            .barrier
            .with_target_checkpoint_scope(closed, &recipient.token, |_| consume())
            .map_err(|error| error.to_string())?
    }

    pub(crate) fn begin_target_checkpoint_before(
        &self,
        recipient: &NativeCheckpointWindow,
        closed: &crate::session_store::window_barrier::target::ClosedTargetAdmission,
        deadline: std::time::Instant,
    ) -> Result<NativeOperation, String> {
        if !self.matches(recipient) || !self.matches_closed_roster(closed) {
            return Err("NATIVE_CHECKPOINT_WRONG_ROSTER".into());
        }
        recipient
            .slot
            .barrier
            .begin_target_checkpoint_before(
                closed,
                &recipient.token,
                NativeLane::Persistence,
                deadline,
            )
            .map_err(|error| error.to_string())
    }
}

/// Lock every original producer/recipient in one canonical order. Preparation
/// resolves actual resource tables before this call and releases those table
/// locks; no IPC, resource lookup or Store relocking is allowed in consume.
pub(crate) fn with_checkpoint_owner_group<T>(
    owners: &[&NativeCheckpointWindow],
    instance: uuid::Uuid,
    consume: impl for<'scope> FnOnce(CheckedCheckpointGroup<'scope>) -> Result<T, String>,
) -> Result<T, String> {
    if owners.is_empty() || owners.len() > 128 {
        return Err("NATIVE_CHECKPOINT_OWNER_GROUP_CAPACITY".into());
    }
    let mut ordered = owners.to_vec();
    ordered.sort_by_key(|owner| Arc::as_ptr(&owner.slot) as usize);
    for pair in ordered.windows(2) {
        if Arc::ptr_eq(&pair[0].slot, &pair[1].slot)
            && (pair[0].incarnation != pair[1].incarnation
                || pair[0].store_instance != pair[1].store_instance
                || !pair[0].token.same_capture(&pair[1].token))
        {
            return Err("NATIVE_CHECKPOINT_WINDOW_CHANGED".into());
        }
    }
    ordered.dedup_by(|a, b| Arc::ptr_eq(&a.slot, &b.slot));
    if ordered.iter().any(|owner| owner.store_instance != instance) {
        return Err("NATIVE_CHECKPOINT_SOURCE_CHANGED".into());
    }
    let tokens = ordered
        .iter()
        .map(|owner| {
            owner
                .slot
                .token
                .lock()
                .map_err(|_| "NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let incarnations = ordered
        .iter()
        .map(|owner| {
            owner
                .slot
                .buffer_incarnation
                .lock()
                .map_err(|_| "NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    for (index, owner) in ordered.iter().enumerate() {
        if !owner.slot.buffer_owner_valid.load(Ordering::Acquire)
            || *incarnations[index] != owner.incarnation
            || !tokens[index].same_capture(&owner.token)
        {
            return Err("NATIVE_CHECKPOINT_WINDOW_CHANGED".into());
        }
    }
    let scope = ();
    consume(CheckedCheckpointGroup {
        owners: &ordered,
        _scope: &scope,
    })
}

// The atomic projection/FULL consumer is not installed yet. Do not fabricate a
// runtime caller: this guard factory is exercised by the Native receipt tests.
#[allow(dead_code)]
pub(crate) fn with_checked_checkpoint_resources<T>(
    owner: &NativeCheckpointWindow,
    resources: &ResourceTable,
    store_instance: uuid::Uuid,
    consume: impl for<'scope> FnOnce(
        &WindowBarrier,
        &WindowToken,
        CheckedCheckpointWindow<'scope>,
    ) -> Result<T, String>,
) -> Result<T, String> {
    with_checkpoint_resources(owner, resources, store_instance, |barrier, token| {
        let scope = ();
        consume(
            barrier,
            token,
            CheckedCheckpointWindow {
                owner,
                _scope: &scope,
            },
        )
    })
}

pub(crate) fn capture_checkpoint_resources(
    resources: &ResourceTable,
    store_instance: uuid::Uuid,
) -> Result<NativeCheckpointWindow, String> {
    let slot = slot(resources).ok_or("NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE")?;
    let token = slot
        .token
        .lock()
        .map_err(|_| "NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE")?;
    let incarnation = slot
        .buffer_incarnation
        .lock()
        .map_err(|_| "NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE")?;
    if !slot.buffer_owner_valid.load(Ordering::Acquire) {
        return Err("NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE".into());
    }
    Ok(NativeCheckpointWindow {
        slot: slot.clone(),
        token: token.clone(),
        incarnation: *incarnation,
        store_instance,
    })
}

/// Keep physical-owner locks through the bounded local SQL callback. Native
/// reload/destruction cannot make a new incarnation inherit an older receipt.
pub(crate) fn with_checkpoint_resources<T>(
    owner: &NativeCheckpointWindow,
    resources: &ResourceTable,
    store_instance: uuid::Uuid,
    consume: impl FnOnce(&WindowBarrier, &WindowToken) -> Result<T, String>,
) -> Result<T, String> {
    let current = slot(resources).ok_or("NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE")?;
    if !Arc::ptr_eq(&current, &owner.slot) || owner.store_instance != store_instance {
        return Err("NATIVE_CHECKPOINT_WINDOW_CHANGED".into());
    }
    let _token = current
        .token
        .lock()
        .map_err(|_| "NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE")?;
    let incarnation = current
        .buffer_incarnation
        .lock()
        .map_err(|_| "NATIVE_CHECKPOINT_WINDOW_UNAVAILABLE")?;
    if !current.buffer_owner_valid.load(Ordering::Acquire) || *incarnation != owner.incarnation {
        return Err("NATIVE_CHECKPOINT_WINDOW_CHANGED".into());
    }
    consume(&current.barrier, &owner.token)
}
impl NativeBufferOwner {
    pub(crate) fn store_instance(&self) -> uuid::Uuid {
        self.store_instance
    }
    pub(crate) fn incarnation(&self) -> uuid::Uuid {
        self.incarnation
    }
    pub(crate) fn label(&self) -> &str {
        &self.label
    }
    pub(crate) fn key(&self) -> String {
        use sha2::{Digest, Sha256};
        format!(
            "{:x}",
            Sha256::digest(format!("{}:{}", self.store_instance, self.incarnation).as_bytes())
        )
    }
}

fn capture_buffer_owner(
    resources: &ResourceTable,
    store_instance: uuid::Uuid,
) -> Result<(NativeBufferOwner, NativeOperation), String> {
    let slot = slot(resources).ok_or("NATIVE_EDITOR_OWNER_UNAVAILABLE")?;
    let token = slot
        .token
        .lock()
        .map_err(|_| "NATIVE_EDITOR_OWNER_UNAVAILABLE")?;
    let incarnation = slot
        .buffer_incarnation
        .lock()
        .map_err(|_| "NATIVE_EDITOR_OWNER_UNAVAILABLE")?;
    if !slot.buffer_owner_valid.load(Ordering::Acquire) {
        return Err("NATIVE_EDITOR_OWNER_UNAVAILABLE".into());
    }
    let admission = slot
        .barrier
        .begin_native_write(&token, NativeLane::Buffers)
        .map_err(|error| error.to_string())?;
    Ok((
        NativeBufferOwner {
            store_instance,
            incarnation: *incarnation,
            label: token.label().into(),
        },
        admission,
    ))
}

/// Capture before SQL/scheduling and keep this exact native owner through settlement.
pub(crate) fn editor_buffers<T>(
    window: &tauri::Window,
    store: &crate::session_store::SessionStore,
    work: impl FnOnce(&NativeBufferOwner) -> Result<T, String>,
) -> Result<T, String> {
    let (owner, admission) =
        capture_buffer_owner(&window.resources_table(), store.native_instance_id())?;
    admission
        .finish(work(&owner))
        .map_err(|error| error.to_string())
}

fn capture_workspace_report(
    resources: &ResourceTable,
    store_instance: uuid::Uuid,
    fallback: Option<&WindowBarrier>,
) -> Result<(Option<NativeBufferOwner>, NativeWriteAdmission), BarrierError> {
    if let Some(slot) = slot(resources) {
        // One exact pair across reload; never substitute the newest label token.
        if let (Ok(token), Ok(incarnation)) = (slot.token.lock(), slot.buffer_incarnation.lock()) {
            if slot.buffer_owner_valid.load(Ordering::Acquire) {
                match slot.barrier.begin_native_write(&token, NativeLane::Buffers) {
                    Ok(admission) => {
                        return Ok((
                            Some(NativeBufferOwner {
                                store_instance,
                                incarnation: *incarnation,
                                label: token.label().into(),
                            }),
                            NativeWriteAdmission::Tracked(admission),
                        ));
                    }
                    Err(BarrierError::AdmissionClosed) => {
                        return Err(BarrierError::AdmissionClosed)
                    }
                    Err(_) => {}
                }
            }
        }
        slot.barrier.admit_unqualified_write()?;
    } else if let Some(barrier) = fallback {
        barrier.admit_unqualified_write()?;
    }
    Ok((None, NativeWriteAdmission::Unqualified))
}

/// Compatibility reports preserve ordinary work if physical attribution is
/// missing, while tainting qualification. None must be stored as unattributed;
/// callers may never synthesize a physical owner from a label or renderer data.
/// The closure retains actual admission through SQL/Host/confirmation settlement.
pub(crate) fn workspace_buffer_report<T>(
    window: &tauri::Window,
    store: &crate::session_store::SessionStore,
    work: impl FnOnce(Option<&NativeBufferOwner>) -> Result<T, String>,
) -> Result<T, String> {
    let (owner, admission) = {
        let barrier = window.app_handle().try_state::<WindowBarrier>();
        capture_workspace_report(
            &window.resources_table(),
            store.native_instance_id(),
            barrier.as_ref().map(|state| state.inner()),
        )
        .map_err(|error| error.to_string())?
    };
    admission.finish(work(owner.as_ref()))
}

#[cfg(test)]
pub(crate) fn test_buffer_owner(
    resources: &ResourceTable,
    store_instance: uuid::Uuid,
) -> Result<(NativeBufferOwner, NativeOperation), String> {
    capture_buffer_owner(resources, store_instance)
}

#[cfg(test)]
pub(crate) fn test_buffer_resources(barrier: &WindowBarrier, label: &str) -> ResourceTable {
    let mut resources = ResourceTable::default();
    ensure_slot(&mut resources, barrier, label).unwrap();
    resources
}

#[cfg(test)]
pub(crate) fn test_reload_buffer_resources(resources: &ResourceTable) {
    slot(resources).unwrap().reloaded();
}

fn slot(resources: &ResourceTable) -> Option<Arc<WindowSlot>> {
    let id = resources
        .names()
        .find_map(|(id, name)| (name == SLOT_NAME).then_some(id))?;
    resources.get(id).ok()
}

/// Tracking is separate from the actual save outcome and never fabricates a
/// lease for a missing/stale native owner. Unqualified open work remains usable.
pub(crate) enum NativeWriteAdmission {
    Tracked(NativeOperation),
    Unqualified,
}

impl NativeWriteAdmission {
    pub(crate) fn finish<T, E>(self, result: Result<T, E>) -> Result<T, E> {
        self.finish_observed(result, Ok(()))
    }

    /// Native-only observation may withhold idle proof without changing an
    /// already-authoritative public result (for example SQL delete + cleanup).
    pub(crate) fn finish_observed<T, E>(
        self,
        result: Result<T, E>,
        observation: Result<(), ()>,
    ) -> Result<T, E> {
        if let Self::Tracked(operation) = self {
            let tracked = result.as_ref().map(|_| ()).map_err(|_| ()).and(observation);
            let _ = operation.finish(tracked);
        }
        result
    }
}

/// Supplied only by the native Store/worker owner, never a caller's window or grant.
pub(crate) fn admit_process_persistence(
    barrier: Option<&WindowBarrier>,
) -> Result<NativeWriteAdmission, BarrierError> {
    if let Some(barrier) = barrier {
        match barrier.begin_process_write() {
            Ok(operation) => return Ok(NativeWriteAdmission::Tracked(operation)),
            Err(BarrierError::AdmissionClosed) => return Err(BarrierError::AdmissionClosed),
            Err(_) => barrier.admit_unqualified_write()?,
        }
    }
    Ok(NativeWriteAdmission::Unqualified)
}

fn admit_persistence(
    resources: &ResourceTable,
    fallback: Option<&WindowBarrier>,
) -> Result<NativeWriteAdmission, BarrierError> {
    admit_lane(resources, fallback, NativeLane::Persistence)
}

fn admit_lane(
    resources: &ResourceTable,
    fallback: Option<&WindowBarrier>,
    lane: NativeLane,
) -> Result<NativeWriteAdmission, BarrierError> {
    admit_scoped_lane(resources, fallback, lane, None)
}

fn admit_scoped_lane(
    resources: &ResourceTable,
    fallback: Option<&WindowBarrier>,
    lane: NativeLane,
    session_id: Option<&str>,
) -> Result<NativeWriteAdmission, BarrierError> {
    if let Some(slot) = slot(resources) {
        // This resource belongs to this physical Window. Never obtain a newer
        // same-label window's token from the global roster (label ABA).
        let token = slot.token.lock().ok().map(|token| token.clone());
        if let Some(token) = token {
            let admitted = match session_id {
                Some(session_id) => slot.barrier.begin_session_write(&token, session_id, lane),
                None => slot.barrier.begin_native_write(&token, lane),
            };
            match admitted {
                Ok(operation) => return Ok(NativeWriteAdmission::Tracked(operation)),
                Err(BarrierError::AdmissionClosed) => return Err(BarrierError::AdmissionClosed),
                Err(BarrierError::InvalidSessionScope) => {
                    return Err(BarrierError::InvalidSessionScope)
                }
                Err(_) => {}
            }
        }
        match session_id {
            Some(session_id) => slot.barrier.admit_unqualified_session_write(session_id)?,
            None => slot.barrier.admit_unqualified_write()?,
        }
    } else if let Some(barrier) = fallback {
        match session_id {
            Some(session_id) => barrier.admit_unqualified_session_write(session_id)?,
            None => barrier.admit_unqualified_write()?,
        }
    }
    Ok(NativeWriteAdmission::Unqualified)
}

/// The injected Window is native-owned. Capture admission before Git work,
/// SQL locks or scheduling, and retain it until the actual write settles.
/// This tracks only the wired persistence commands, not all native writers or
/// unsent renderer drafts, and supplies no checkpoint or migration proof.
pub(crate) fn persistence_write<T>(
    window: &tauri::Window,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    persistence_write_observed(window, || (work(), Ok(())))
}

/// The public command result can be authoritative even when best-effort work
/// failed. That native observation withholds qualification; it grants no retry.
pub(crate) fn persistence_write_observed<T>(
    window: &tauri::Window,
    work: impl FnOnce() -> (Result<T, String>, Result<(), ()>),
) -> Result<T, String> {
    let admission = admit_window_persistence(window)?;
    // Resource/token locks are released; work's SQL guard drops before finish.
    let (result, observation) = work();
    admission.finish_observed(result, observation)
}

/// Transfer the actual caller's Persistence admission to its accepted worker.
/// Resource/token locks end here; the worker must retain the returned admission
/// through its last SQL callback and cleanup, independently of an IPC waiter.
pub(crate) fn admit_window_persistence(
    window: &tauri::Window,
) -> Result<NativeWriteAdmission, String> {
    let barrier = window.app_handle().try_state::<WindowBarrier>();
    let resources = window.resources_table();
    admit_persistence(&resources, barrier.as_ref().map(|state| state.inner()))
        .map_err(|error| error.to_string())
}

/// The actual native command's mutation key, not a separate caller-chosen scope.
/// Session B continues during a closure for A. Shared/unknown commands retain
/// the profile lane; this grants neither checkpoint admission nor actor proof.
pub(crate) fn session_persistence_write<T>(
    window: &tauri::Window,
    session_id: &str,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let admission = {
        let barrier = window.app_handle().try_state::<WindowBarrier>();
        let resources = window.resources_table();
        admit_scoped_lane(
            &resources,
            barrier.as_ref().map(|state| state.inner()),
            NativeLane::Persistence,
            Some(session_id),
        )
        .map_err(|error| error.to_string())?
    };
    admission.finish(work())
}

/// Admit before scheduling asynchronous blob work; the native worker owns this
/// lease until its actual write/access-grant result, independent of its waiter.
pub(crate) fn admit_window_buffers(window: &tauri::Window) -> Result<NativeWriteAdmission, String> {
    let barrier = window.app_handle().try_state::<WindowBarrier>();
    let resources = window.resources_table();
    admit_buffer_resources(&resources, barrier.as_ref().map(|state| state.inner()))
}

fn admit_buffer_resources(
    resources: &ResourceTable,
    barrier: Option<&WindowBarrier>,
) -> Result<NativeWriteAdmission, String> {
    admit_lane(resources, barrier, NativeLane::Buffers).map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) fn test_admit_window_buffers(
    resources: &ResourceTable,
    barrier: Option<&WindowBarrier>,
) -> Result<NativeWriteAdmission, String> {
    admit_buffer_resources(resources, barrier)
}

/// Test the same resource-owned Persistence admission used by native commands.
#[cfg(test)]
pub(crate) fn test_admit_window_persistence(
    resources: &ResourceTable,
    barrier: Option<&WindowBarrier>,
) -> Result<NativeWriteAdmission, String> {
    admit_persistence(resources, barrier).map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) fn test_persistence_write<T>(
    resources: &ResourceTable,
    barrier: Option<&WindowBarrier>,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let admission = test_admit_window_persistence(resources, barrier)?;
    admission.finish(work())
}

fn ensure_slot(
    resources: &mut ResourceTable,
    barrier: &WindowBarrier,
    label: &str,
) -> Result<(Arc<WindowSlot>, bool), String> {
    if let Some(slot) = slot(resources) {
        return Ok((slot, false));
    }
    let token = match barrier.observe_created(label) {
        Ok(token) => token,
        // Native Ready already observed and recorded this real window. Keep its
        // exact cleanup handle even though its creation tainted qualification.
        Err(BarrierError::UnexpectedWindowAdmission) => barrier
            .current_window(label)
            .map_err(|error| error.to_string())?,
        Err(error) => return Err(error.to_string()),
    };
    let slot = Arc::new(WindowSlot {
        barrier: barrier.clone(),
        token: Mutex::new(token),
        buffer_incarnation: Mutex::new(uuid::Uuid::new_v4()),
        buffer_owner_valid: AtomicBool::new(true),
    });
    resources.add_arc(slot.clone());
    Ok((slot, true))
}

fn tracker(app: &AppHandle) -> Result<WindowBarrier, String> {
    app.try_state::<WindowBarrier>()
        .map(|state| state.inner().clone())
        .ok_or_else(|| "Native window lifecycle is unavailable".into())
}

fn destruction_callback(slot: Arc<WindowSlot>) -> impl Fn(&tauri::WindowEvent) + Send + 'static {
    move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            slot.destroyed();
        }
    }
}

fn observe_ready(window: &tauri::Window) {
    let Ok(barrier) = tracker(window.app_handle()) else {
        return;
    };
    let result = ensure_slot(&mut window.resources_table(), &barrier, window.label());
    if let Ok((slot, true)) = result {
        // Native Ready happens once per physical window. Page starts update the
        // existing slot and cannot accumulate native destruction listeners.
        window.on_window_event(destruction_callback(slot));
    }
}

pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("native-window-lifecycle")
        .on_window_ready(|window| observe_ready(&window))
        .build()
}

/// Covers configured startup windows even if their first page event preceded
/// setup. All windows participate, including auxiliary tool/composer windows.
pub(crate) fn observe_existing(app: &AppHandle) {
    for window in app.webview_windows().into_values() {
        observe_ready(&window.as_ref().window());
    }
}

/// Native event, not a renderer-reported flush or readiness acknowledgement.
pub(crate) fn on_page_load(webview: &Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if !matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        return;
    }
    if let Some(issuer) = crate::control::receipts::page_reloaded(webview) {
        crate::control::page_reloaded(webview.app_handle(), &issuer);
        crate::harness::page_retired(webview.app_handle(), &issuer);
        crate::session_window_ownership::release_issuer(&issuer);
    }
    let Ok(barrier) = tracker(webview.app_handle()) else {
        return;
    };
    let window = webview.window();
    let slot = slot(&window.resources_table());
    if let Some(slot) = slot {
        slot.reloaded();
    } else {
        // A page event without its native owner cannot bless an incarnation.
        // Later Ready may register it; qualification stays conservatively tainted.
        let _ = barrier.observe_unattributed_destruction();
    }
    // A failed observation remains a sticky native qualification failure. It
    // never grants permission to stop work, destroy a window or migrate state.
}

/// Reserve the native roster before a common Rust builder creates its window.
/// Admission remains pending until actual creation; a failed build removes only
/// this reserved incarnation. Dropping this guard never closes a live window.
pub(crate) struct WindowCreation {
    barrier: WindowBarrier,
    token: WindowToken,
    confirmed: bool,
}

pub(crate) fn admit_window(app: &AppHandle, label: &str) -> Result<WindowCreation, String> {
    let barrier = tracker(app)?;
    let token = barrier
        .admit_window(label)
        .map_err(|error| error.to_string())?;
    Ok(WindowCreation {
        barrier,
        token,
        confirmed: false,
    })
}

impl WindowCreation {
    pub(crate) fn created(mut self, window: &WebviewWindow) {
        // An unexpected closure raced with creation: the tracker keeps its
        // qualification fault. The already-created application window continues
        // its ordinary lifecycle; it is not stopped to manufacture idle proof.
        let _ = self.barrier.confirm_created(&self.token);
        observe_ready(&window.as_ref().window());
        self.confirmed = true;
    }
}

impl Drop for WindowCreation {
    fn drop(&mut self) {
        if !self.confirmed {
            let _ = self.barrier.cancel_creation(&self.token);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_native_persistence_keeps_other_sql_rows_writable_and_shared_work_closed() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE drafts(id TEXT PRIMARY KEY, body TEXT); INSERT INTO drafts VALUES('A','old A'),('B','old B');").unwrap();
        let closed = barrier.close_target_admission("A").unwrap();
        let other = admit_scoped_lane(
            &resources,
            Some(&barrier),
            NativeLane::Persistence,
            Some("B"),
        )
        .unwrap();
        assert_eq!(
            other.finish(db.execute("UPDATE drafts SET body='new B' WHERE id='B'", [])),
            Ok(1)
        );
        assert!(matches!(
            admit_scoped_lane(
                &resources,
                Some(&barrier),
                NativeLane::Persistence,
                Some("A")
            ),
            Err(BarrierError::AdmissionClosed)
        ));
        assert!(matches!(
            admit_persistence(&resources, Some(&barrier)),
            Err(BarrierError::AdmissionClosed)
        ));
        assert!(matches!(
            admit_process_persistence(Some(&barrier)),
            Err(BarrierError::AdmissionClosed)
        ));
        assert_eq!(
            db.query_row("SELECT body FROM drafts WHERE id='A'", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "old A"
        );
        assert_eq!(
            db.query_row("SELECT body FROM drafts WHERE id='B'", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "new B"
        );
        barrier.reopen_target_admission(closed).unwrap();
        assert!(admit_scoped_lane(
            &resources,
            Some(&barrier),
            NativeLane::Persistence,
            Some("A")
        )
        .unwrap()
        .finish(Ok::<_, String>(()))
        .is_ok());
    }

    #[test]
    fn scoped_missing_window_is_unqualified_without_blocking_unrelated_actual_result() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let closed = barrier.close_target_admission("A").unwrap();
        let unknown = ResourceTable::default();
        assert_eq!(
            admit_scoped_lane(&unknown, Some(&barrier), NativeLane::Persistence, Some("B"))
                .unwrap()
                .finish(Ok::<_, String>("committed B")),
            Ok("committed B")
        );
        assert!(matches!(
            admit_scoped_lane(&unknown, Some(&barrier), NativeLane::Persistence, Some("A")),
            Err(BarrierError::AdmissionClosed)
        ));
        assert!(barrier.prove_target_native_idle(&closed).is_err());
        barrier.reopen_target_admission(closed).unwrap();
        assert!(admit_persistence(&resources, Some(&barrier))
            .unwrap()
            .finish(Ok::<_, String>(()))
            .is_ok());
    }

    #[test]
    fn workspace_report_owner_and_lease_are_captured_together_through_settlement() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let store = uuid::Uuid::new_v4();
        let (owner, admission) =
            capture_workspace_report(&resources, store, Some(&barrier)).unwrap();
        let owner = owner.unwrap();
        assert_eq!(owner.store_instance(), store);
        assert_eq!(owner.label(), "main");
        let (same, second) = capture_workspace_report(&resources, store, Some(&barrier)).unwrap();
        assert_eq!(same.unwrap().key(), owner.key());
        second.finish(Ok::<_, String>(())).unwrap();
        let closed = barrier.close_target_admission("A").unwrap();
        assert!(matches!(
            barrier.prove_target_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        assert!(matches!(
            capture_workspace_report(&resources, store, Some(&barrier)),
            Err(BarrierError::AdmissionClosed)
        ));
        assert_eq!(
            admission.finish(Ok::<_, String>("Host response")),
            Ok("Host response")
        );
        assert!(matches!(
            barrier.prove_target_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
    }

    #[test]
    fn workspace_report_reload_preserves_captured_old_owner_and_gives_new_reports_a_new_key() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let store = uuid::Uuid::new_v4();
        let (old, admission) = capture_workspace_report(&resources, store, Some(&barrier)).unwrap();
        let old = old.unwrap();
        test_reload_buffer_resources(&resources);
        let (new, next) = capture_workspace_report(&resources, store, Some(&barrier)).unwrap();
        assert_ne!(old.key(), new.unwrap().key());
        assert_eq!(admission.finish(Ok::<_, String>(old.key())), Ok(old.key()));
        next.finish(Ok::<_, String>(())).unwrap();
        assert!(barrier.close_target_admission("A").is_err());
    }

    #[test]
    fn unattributed_workspace_report_stays_explicitly_unknown_and_cannot_cross_closed_gate() {
        let barrier = WindowBarrier::new();
        let resources = ResourceTable::default();
        let store = uuid::Uuid::new_v4();
        let (owner, admission) =
            capture_workspace_report(&resources, store, Some(&barrier)).unwrap();
        assert!(owner.is_none());
        assert_eq!(
            admission.finish(Err::<(), _>("original failure")),
            Err("original failure")
        );
        assert!(barrier.close_target_admission("A").is_err());

        let barrier = WindowBarrier::new();
        let _live = self::resources(&barrier, "main");
        let closed = barrier.close_target_admission("A").unwrap();
        assert!(matches!(
            capture_workspace_report(&resources, store, Some(&barrier)),
            Err(BarrierError::AdmissionClosed)
        ));
        barrier.reopen_target_admission(closed).unwrap();
        assert!(capture_workspace_report(&resources, store, Some(&barrier))
            .unwrap()
            .0
            .is_none());
    }

    #[test]
    fn invalidated_physical_resource_cannot_mint_workspace_report_ownership() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        Resource::close(slot(&resources).unwrap());
        let (owner, admission) =
            capture_workspace_report(&resources, uuid::Uuid::new_v4(), Some(&barrier)).unwrap();
        assert!(owner.is_none());
        assert_eq!(
            admission.finish(Ok::<_, String>("retained unknown report")),
            Ok("retained unknown report")
        );
        assert!(barrier.close_target_admission("A").is_err());
    }

    fn resources(barrier: &WindowBarrier, label: &str) -> ResourceTable {
        let mut resources = ResourceTable::default();
        ensure_slot(&mut resources, barrier, label).unwrap();
        resources
    }

    #[test]
    fn editor_owner_capture_has_no_unattributed_fallback_and_closed_resource_rejects_fresh_work() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let store = uuid::Uuid::new_v4();
        assert!(capture_buffer_owner(&ResourceTable::default(), store).is_err());
        let (owner, operation) = capture_buffer_owner(&resources, store).unwrap();
        let old_key = owner.key();
        Resource::close(slot(&resources).unwrap());
        assert!(capture_buffer_owner(&resources, store).is_err());
        assert_eq!(
            operation.finish(Ok::<_, String>(old_key.clone())).unwrap(),
            old_key
        );
        // Legacy ordinary writes keep their existing preservation behavior.
        assert!(admit_lane(&resources, Some(&barrier), NativeLane::Buffers)
            .unwrap()
            .finish(Ok::<_, String>(()))
            .is_ok());
    }

    #[test]
    fn buffer_report_owns_admission_through_ack_and_invalidates_native_idle() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let admission = admit_lane(&resources, Some(&barrier), NativeLane::Buffers).unwrap();
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        assert!(matches!(
            admit_lane(&resources, Some(&barrier), NativeLane::Buffers),
            Err(BarrierError::AdmissionClosed)
        ));
        assert_eq!(
            admission.finish(Ok::<_, String>("actual Host response")),
            Ok("actual Host response")
        );
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
        barrier.reopen_admission(closed).unwrap();
    }

    #[test]
    fn buffer_failure_and_untracked_report_preserve_ordinary_work_but_not_qualification() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let admission = admit_lane(&resources, Some(&barrier), NativeLane::Buffers).unwrap();
        assert_eq!(
            admission.finish(Err::<(), _>("lost Host ACK")),
            Err("lost Host ACK")
        );
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::FailedNativeOperation)
        ));
        let untracked = ResourceTable::default();
        let admission = admit_lane(&untracked, Some(&barrier), NativeLane::Buffers).unwrap();
        assert!(matches!(admission, NativeWriteAdmission::Unqualified));
        assert_eq!(
            admission.finish(Ok::<_, String>("ordinary saved report")),
            Ok("ordinary saved report")
        );
        admit_lane(&resources, Some(&barrier), NativeLane::Buffers)
            .unwrap()
            .finish(Ok::<_, ()>(()))
            .unwrap();
    }

    #[test]
    fn persistence_is_tracked_before_work_and_held_until_actual_settlement() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let admission = admit_persistence(&resources, Some(&barrier)).unwrap();
        assert!(matches!(admission, NativeWriteAdmission::Tracked(_)));
        let closed = barrier.close_admission().unwrap();
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::PendingNativeOperations)
        ));
        assert_eq!(
            admission.finish(Ok::<_, String>("committed")),
            Ok("committed")
        );
        assert!(matches!(
            barrier.prove_native_idle(&closed),
            Err(BarrierError::MissingNativeCheckpoint)
        ));
    }

    #[test]
    fn absent_tracker_and_resource_preserve_the_actual_result_without_a_lease() {
        let resources = ResourceTable::default();
        let admission = admit_persistence(&resources, None).unwrap();
        assert!(matches!(admission, NativeWriteAdmission::Unqualified));
        assert_eq!(admission.finish(Ok::<_, String>(17)), Ok(17));
        let admission = admit_persistence(&resources, None).unwrap();
        assert_eq!(
            admission.finish(Err::<(), _>("native write failed")),
            Err("native write failed")
        );
        assert_eq!(resources.names().count(), 0);
    }

    #[test]
    fn missing_resource_taints_qualification_but_keeps_ordinary_open_writes_working() {
        let barrier = WindowBarrier::new();
        let main = resources(&barrier, "main");
        let absent = ResourceTable::default();
        let admission = admit_persistence(&absent, Some(&barrier)).unwrap();
        assert!(matches!(admission, NativeWriteAdmission::Unqualified));
        assert_eq!(
            admission.finish(Ok::<_, String>("draft saved")),
            Ok("draft saved")
        );
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnattributedNativeOperation)
        ));
        let next = admit_persistence(&main, Some(&barrier)).unwrap();
        assert!(matches!(next, NativeWriteAdmission::Tracked(_)));
        assert_eq!(
            next.finish(Ok::<_, String>("queue saved")),
            Ok("queue saved")
        );
    }

    #[test]
    fn genuine_closed_admission_rejects_before_the_write_and_can_reopen() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        let effect = std::cell::Cell::new(false);
        let outcome = admit_persistence(&resources, Some(&barrier)).map(|admission| {
            effect.set(true);
            admission.finish(Ok::<_, String>(123))
        });
        assert!(matches!(outcome, Err(BarrierError::AdmissionClosed)));
        assert!(!effect.get());
        barrier.reopen_admission(closed).unwrap();
        assert_eq!(
            admit_persistence(&resources, Some(&barrier))
                .unwrap()
                .finish(Ok::<_, String>(123)),
            Ok(123)
        );
        assert!(barrier.close_admission().is_ok());
    }

    #[test]
    fn missing_resource_cannot_bypass_an_existing_native_closure() {
        let barrier = WindowBarrier::new();
        let _main = resources(&barrier, "main");
        let closed = barrier.close_admission().unwrap();
        let absent = ResourceTable::default();
        assert!(matches!(
            admit_persistence(&absent, Some(&barrier)),
            Err(BarrierError::AdmissionClosed)
        ));
        barrier.reopen_admission(closed).unwrap();
        let admission = admit_persistence(&absent, Some(&barrier)).unwrap();
        assert!(matches!(admission, NativeWriteAdmission::Unqualified));
        assert_eq!(
            admission.finish(Ok::<_, String>("saved after cancellation")),
            Ok("saved after cancellation")
        );
        assert!(barrier.close_admission().is_err());
    }

    #[test]
    fn old_physical_resource_does_not_borrow_a_replacement_windows_token() {
        let barrier = WindowBarrier::new();
        let old = resources(&barrier, "same");
        let current = resources(&barrier, "same");
        let stale = admit_persistence(&old, Some(&barrier)).unwrap();
        assert!(matches!(stale, NativeWriteAdmission::Unqualified));
        assert_eq!(
            stale.finish(Ok::<_, String>("ordinary save")),
            Ok("ordinary save")
        );
        let current = admit_persistence(&current, Some(&barrier)).unwrap();
        assert!(matches!(current, NativeWriteAdmission::Tracked(_)));
        current.finish(Ok::<_, ()>(())).unwrap();
        assert!(barrier.close_admission().is_err());
    }

    #[test]
    fn stale_physical_resource_cannot_bypass_a_replacement_windows_closure() {
        let barrier = WindowBarrier::new();
        let old = resources(&barrier, "same");
        let _current = resources(&barrier, "same");
        let _closed = barrier.close_admission().unwrap();
        assert!(matches!(
            admit_persistence(&old, Some(&barrier)),
            Err(BarrierError::AdmissionClosed)
        ));
    }

    #[test]
    fn a_reload_cannot_turn_an_actual_commit_into_an_error_or_retry() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let admission = admit_persistence(&resources, Some(&barrier)).unwrap();
        slot(&resources).unwrap().reloaded();
        assert_eq!(
            admission.finish(Ok::<_, String>("original native receipt")),
            Ok("original native receipt")
        );
        assert!(barrier.close_admission().is_err());
        admit_persistence(&resources, Some(&barrier))
            .unwrap()
            .finish(Ok::<_, ()>(()))
            .unwrap();
    }

    #[test]
    fn original_native_error_is_preserved_and_qualification_taint_does_not_disable_saves() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let original: Arc<str> = "original disk error".into();
        let returned = admit_persistence(&resources, Some(&barrier))
            .unwrap()
            .finish(Err::<(), _>(original.clone()))
            .unwrap_err();
        assert!(Arc::ptr_eq(&original, &returned));
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::FailedNativeOperation)
        ));
        assert_eq!(
            admit_persistence(&resources, Some(&barrier))
                .unwrap()
                .finish(Ok::<_, String>("saved")),
            Ok("saved")
        );
    }

    #[test]
    fn dropped_native_work_taints_qualification_without_failing_future_open_work() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        drop(admit_persistence(&resources, Some(&barrier)).unwrap());
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnfinishedNativeOperation)
        ));
        assert_eq!(
            admit_persistence(&resources, Some(&barrier))
                .unwrap()
                .finish(Ok::<_, String>("saved")),
            Ok("saved")
        );
    }

    #[test]
    fn exhausted_tracking_capacity_keeps_actual_saves_and_never_fabricates_a_lease() {
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "main");
        let mut active = Vec::new();
        let mut saturated = false;
        for _ in 0..10_000 {
            match admit_persistence(&resources, Some(&barrier)).unwrap() {
                NativeWriteAdmission::Tracked(operation) => active.push(operation),
                unqualified @ NativeWriteAdmission::Unqualified => {
                    assert_eq!(
                        unqualified.finish(Ok::<_, String>("native save succeeded")),
                        Ok("native save succeeded")
                    );
                    saturated = true;
                    break;
                }
            }
        }
        assert!(saturated);
        assert!(!active.is_empty());
        for operation in active {
            operation.finish(Ok::<_, ()>(())).unwrap();
        }
        assert!(matches!(
            barrier.close_admission(),
            Err(BarrierError::UnattributedNativeOperation)
        ));
        admit_persistence(&resources, Some(&barrier))
            .unwrap()
            .finish(Ok::<_, ()>(()))
            .unwrap();
    }

    #[test]
    fn repeated_ready_and_reload_keeps_one_slot_and_one_listener() {
        let barrier = WindowBarrier::new();
        let mut resources = ResourceTable::default();
        let mut listeners = 0;
        for _ in 0..1_000 {
            let (slot, added) = ensure_slot(&mut resources, &barrier, "main").unwrap();
            listeners += usize::from(added);
            slot.reloaded();
        }
        assert_eq!(listeners, 1);
        assert_eq!(resources.names().count(), 1);
        let slot = slot(&resources).unwrap();
        destruction_callback(slot)(&tauri::WindowEvent::Destroyed);
        assert!(matches!(
            barrier.current_window("main"),
            Err(BarrierError::UnknownWindow)
        ));
    }

    #[test]
    fn old_physical_slot_events_cannot_remove_or_reload_a_replacement() {
        let barrier = WindowBarrier::new();
        let mut old_resources = ResourceTable::default();
        let (old, _) = ensure_slot(&mut old_resources, &barrier, "tools").unwrap();
        let mut new_resources = ResourceTable::default();
        let (new, _) = ensure_slot(&mut new_resources, &barrier, "tools").unwrap();
        old.reloaded();
        destruction_callback(old)(&tauri::WindowEvent::Destroyed);
        let token = new.token.lock().unwrap();
        let operation = barrier.begin_writer(&token).unwrap();
        assert_eq!(operation.finish(Ok::<_, ()>(123)).unwrap(), 123);
        drop(token);
        destruction_callback(new)(&tauri::WindowEvent::Destroyed);
        assert!(matches!(
            barrier.current_window("tools"),
            Err(BarrierError::UnknownWindow)
        ));
    }

    #[test]
    fn unexpected_creation_retains_cleanup_without_qualifying_migration() {
        let barrier = WindowBarrier::new();
        let mut main_resources = ResourceTable::default();
        ensure_slot(&mut main_resources, &barrier, "main").unwrap();
        let closed = barrier.close_admission().unwrap();
        let mut resources = ResourceTable::default();
        let (slot, added) = ensure_slot(&mut resources, &barrier, "tools").unwrap();
        assert!(added);
        destruction_callback(slot)(&tauri::WindowEvent::Destroyed);
        assert!(matches!(
            barrier.current_window("tools"),
            Err(BarrierError::UnknownWindow)
        ));
        assert!(barrier.prove_native_idle(&closed).is_err());
        barrier.reopen_admission(closed).unwrap();
        assert!(barrier.admit_window("ordinary-next-window").is_ok());
        assert!(barrier.close_admission().is_err());
    }

    #[test]
    fn resource_close_is_not_an_attributed_window_destruction() {
        let barrier = WindowBarrier::new();
        let mut resources = ResourceTable::default();
        let (slot, _) = ensure_slot(&mut resources, &barrier, "main").unwrap();
        Resource::close(slot);
        let token = barrier.current_window("main").unwrap();
        assert_eq!(
            barrier
                .begin_writer(&token)
                .unwrap()
                .finish(Ok::<_, ()>(123))
                .unwrap(),
            123
        );
        assert!(barrier.close_admission().is_err());
    }

    #[test]
    fn owner_group_deduplicates_exact_captures_and_rejects_replacement_and_store() {
        let barrier = WindowBarrier::new();
        let first = resources(&barrier, "first");
        let second = resources(&barrier, "second");
        let instance = uuid::Uuid::new_v4();
        let a = capture_checkpoint_resources(&first, instance).unwrap();
        let b = capture_checkpoint_resources(&second, instance).unwrap();
        let closed = barrier.close_target_admission("session").unwrap();
        with_checkpoint_owner_group(&[&b, &a, &b], instance, |group| {
            assert!(group.matches(&a) && group.matches(&b));
            assert!(group.matches_closed_roster(&closed));
            assert!(group.checked_window(&a).unwrap().matches(&a));
            assert!(group.matches_store_instance(instance));
            Ok(())
        })
        .unwrap();
        assert!(with_checkpoint_owner_group(&[&a], uuid::Uuid::new_v4(), |_| Ok(())).is_err());
        barrier.reopen_target_admission(closed).unwrap();
        slot(&first).unwrap().reloaded();
        assert!(with_checkpoint_owner_group(&[&a, &b], instance, |_| Ok(())).is_err());
        let current = capture_checkpoint_resources(&first, instance).unwrap();
        assert!(with_checkpoint_owner_group(&[&a, &current], instance, |_| Ok(())).is_err());
    }

    #[test]
    fn actual_destroyed_callback_waits_for_held_owner_group() {
        use std::sync::mpsc;
        use std::time::Duration;
        let barrier = WindowBarrier::new();
        let resources = resources(&barrier, "held");
        let instance = uuid::Uuid::new_v4();
        let owner = capture_checkpoint_resources(&resources, instance).unwrap();
        let physical = slot(&resources).unwrap();
        let (entered, holding) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let (attempt, attempted) = mpsc::channel();
        let (done, destroyed) = mpsc::channel();
        std::thread::scope(|scope| {
            let owner_ref = &owner;
            scope.spawn(move || {
                with_checkpoint_owner_group(&[owner_ref], instance, |_| {
                    entered.send(()).unwrap();
                    released.recv().unwrap();
                    Ok(())
                })
                .unwrap();
            });
            holding.recv().unwrap();
            let destroyed_slot = physical.clone();
            scope.spawn(move || {
                attempt.send(()).unwrap();
                destruction_callback(destroyed_slot)(&tauri::WindowEvent::Destroyed);
                done.send(()).unwrap();
            });
            attempted.recv().unwrap();
            assert!(destroyed.recv_timeout(Duration::from_millis(30)).is_err());
            assert!(physical.buffer_owner_valid.load(Ordering::Acquire));
            release.send(()).unwrap();
            destroyed.recv_timeout(Duration::from_secs(2)).unwrap();
        });
        assert!(!physical.buffer_owner_valid.load(Ordering::Acquire));
        assert!(with_checkpoint_owner_group(&[&owner], instance, |_| Ok(())).is_err());
    }
}
