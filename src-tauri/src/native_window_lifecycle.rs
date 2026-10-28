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
        if let Self::Tracked(operation) = self {
            let _ = operation.finish(result.as_ref().map(|_| ()).map_err(|_| ()));
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
    if let Some(slot) = slot(resources) {
        // This resource belongs to this physical Window. Never obtain a newer
        // same-label window's token from the global roster (label ABA).
        let token = slot.token.lock().ok().map(|token| token.clone());
        if let Some(token) = token {
            match slot.barrier.begin_native_write(&token, lane) {
                Ok(operation) => return Ok(NativeWriteAdmission::Tracked(operation)),
                Err(BarrierError::AdmissionClosed) => return Err(BarrierError::AdmissionClosed),
                Err(_) => {}
            }
        }
        slot.barrier.admit_unqualified_write()?;
    } else if let Some(barrier) = fallback {
        barrier.admit_unqualified_write()?;
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
    let admission = {
        let barrier = window.app_handle().try_state::<WindowBarrier>();
        let resources = window.resources_table();
        admit_persistence(&resources, barrier.as_ref().map(|state| state.inner()))
            .map_err(|error| error.to_string())?
    };
    // Resource/token locks are released; work's SQL guard drops before finish.
    admission.finish(work())
}

/// Own the buffer report before waiting for its serialization gate, through
/// local SQL, the actual Host response and exact local confirmation. This is
/// accounting only: legacy report identities are not migration checkpoints.
pub(crate) fn buffers_write<T>(
    window: &tauri::Window,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let admission = {
        let barrier = window.app_handle().try_state::<WindowBarrier>();
        let resources = window.resources_table();
        admit_lane(
            &resources,
            barrier.as_ref().map(|state| state.inner()),
            NativeLane::Buffers,
        )
        .map_err(|error| error.to_string())?
    };
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
            slot.buffer_owner_valid.store(false, Ordering::Release);
            if let Ok(token) = slot.token.lock() {
                let _ = slot.barrier.observe_destroyed(&token);
            } else {
                let _ = slot.barrier.observe_unattributed_destruction();
            }
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
}
