//! Actual native lifecycle observations for authority qualification.
//!
//! Every page start is a new native incarnation, including renderer-created
//! windows and reloads. Completion of a page load never certifies persisted
//! renderer state. Migration still requires the separate native write and
//! renderer drain barriers; these hooks alone cannot qualify a writer cohort.

use crate::session_store::window_barrier::{BarrierError, WindowBarrier, WindowToken};
use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Resource, ResourceTable, Webview, WebviewWindow};

const SLOT_NAME: &str = "bycoda.native-window-lifecycle";

/// The physical Window owns this slot. Reusing a label creates a new resource
/// table. No token or proof is sent to the renderer; closing a resource cannot
/// manufacture a destroyed native window.
struct WindowSlot {
    barrier: WindowBarrier,
    token: Mutex<WindowToken>,
}

impl WindowSlot {
    fn reloaded(&self) {
        if let Ok(mut token) = self.token.lock() {
            if let Ok(reloaded) = self.barrier.observe_reloaded(&token) {
                *token = reloaded;
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
        let _ = self.barrier.observe_unattributed_destruction();
    }
}

fn slot(resources: &ResourceTable) -> Option<Arc<WindowSlot>> {
    let id = resources
        .names()
        .find_map(|(id, name)| (name == SLOT_NAME).then_some(id))?;
    resources.get(id).ok()
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
