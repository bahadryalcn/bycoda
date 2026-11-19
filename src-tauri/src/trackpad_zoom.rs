//! Route native macOS magnification only while an image surface claims it.
#[tauri::command]
pub fn set_trackpad_zoom_enabled(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let owner = window.clone();
        window
            .run_on_main_thread(move || mac::set_enabled(&owner, enabled))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, enabled);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::collections::HashMap;
    use std::ptr::NonNull;
    use std::sync::{Mutex, Once, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static INSTALL: Once = Once::new();
    static ENABLED: Mutex<Option<HashMap<isize, String>>> = Mutex::new(None);
    /// Pinch events arrive at display rate. Deltas are summed per window and
    /// emitted once per frame, because each `emit` is a JS eval.
    const MAGNIFY_FRAME: Duration = Duration::from_millis(16);
    /// Deltas waiting for the next flush, keyed by window label. A present key
    /// means a flush is already scheduled for that window.
    static PENDING: Mutex<Option<HashMap<String, f64>>> = Mutex::new(None);

    /// Adds a delta to a window's pending total. Returns true when the window
    /// had nothing pending, so the caller schedules its flush.
    fn push_magnify(pending: &mut HashMap<String, f64>, label: String, delta: f64) -> bool {
        let opened = !pending.contains_key(&label);
        *pending.entry(label).or_insert(0.0) += delta;
        opened
    }

    fn queue_magnify(app: &AppHandle, label: String, delta: f64) {
        let opened = match PENDING.lock() {
            Ok(mut pending) => push_magnify(pending.get_or_insert_with(HashMap::new), label, delta),
            Err(_) => return,
        };
        if opened {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(MAGNIFY_FRAME);
                flush_magnify(&app);
            });
        }
    }

    fn flush_magnify(app: &AppHandle) {
        let due: Vec<(String, f64)> = match PENDING.lock() {
            Ok(mut pending) => pending.get_or_insert_with(HashMap::new).drain().collect(),
            Err(_) => return,
        };
        for (label, delta) in due {
            // A zero net delta (zoom in and out within one frame) has no effect.
            if delta != 0.0 && app.get_webview_window(&label).is_some() {
                let _ = app.emit_to(label.as_str(), "trackpad_magnify", delta);
            }
        }
    }
    pub(super) fn set_enabled(window: &WebviewWindow, enabled: bool) {
        let Some(native) = crate::macos::ns_window(window) else {
            return;
        };
        if let Ok(mut entries) = ENABLED.lock() {
            let entries = entries.get_or_insert_with(HashMap::new);
            if enabled {
                entries.insert(native.windowNumber(), window.label().into());
            } else {
                entries.remove(&native.windowNumber());
            }
        }
        if enabled {
            let _ = APP.set(window.app_handle().clone());
            INSTALL.call_once(|| {
                let handler = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
                    let native = unsafe { event.as_ref() };
                    let label = ENABLED
                        .lock()
                        .ok()
                        .and_then(|entries| entries.as_ref()?.get(&native.windowNumber()).cloned());
                    let (Some(label), Some(app)) = (label, APP.get()) else {
                        return event.as_ptr();
                    };
                    if app.get_webview_window(&label).is_none() {
                        return event.as_ptr();
                    }
                    queue_magnify(app, label, native.magnification());
                    std::ptr::null_mut()
                });
                // AppKit retains the process-wide monitor; per-window claims
                // govern forwarding and leave normal magnification alone.
                let monitor = unsafe {
                    NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                        NSEventMask::Magnify,
                        &handler,
                    )
                };
                std::mem::forget(monitor);
            });
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn same_window_sums_signed_deltas_and_schedules_one_flush() {
            let mut pending = HashMap::new();
            assert!(push_magnify(&mut pending, "main".into(), 0.1));
            assert!(!push_magnify(&mut pending, "main".into(), -0.3));
            assert!(!push_magnify(&mut pending, "main".into(), 0.05));
            let total = pending["main"];
            assert!((total - -0.15).abs() < 1e-9, "net direction and total kept, got {total}");
        }

        #[test]
        fn windows_keep_their_own_totals() {
            let mut pending = HashMap::new();
            assert!(push_magnify(&mut pending, "a".into(), 0.1));
            assert!(push_magnify(&mut pending, "b".into(), 0.2));
            assert!((pending["a"] - 0.1).abs() < 1e-9);
            assert!((pending["b"] - 0.2).abs() < 1e-9);
        }

        #[test]
        fn a_drained_window_schedules_again() {
            let mut pending = HashMap::new();
            assert!(push_magnify(&mut pending, "main".into(), 0.1));
            pending.clear();
            assert!(push_magnify(&mut pending, "main".into(), 0.2));
        }
    }
}
