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
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static INSTALL: Once = Once::new();
    static ENABLED: Mutex<Option<HashMap<isize, String>>> = Mutex::new(None);
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
                    let _ = app.emit_to(label.as_str(), "trackpad_magnify", native.magnification());
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
}
