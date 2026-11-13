//! macOS permission helper: a small always-on-top card docked to the bottom of
//! System Settings while the owner grants a permission.
//!
//! The card ("Drag bycoda into the list above") is `permission-helper.html`.
//! A native thread follows the Settings window, shows the card only while
//! Settings (or the card) is frontmost, and polls the grant every second. When
//! the grant arrives it closes the card, brings bycoda back and emits
//! `system-permissions-changed`. Windows and Linux have no settings window to
//! dock to; the in-app setup sheet polls instead, so the commands are no-ops.

use super::PermissionId;
use tauri::AppHandle;

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const LABEL: &str = "permission-helper";

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

const HELPER_HEIGHT: f64 = 140.0;
const SETTINGS_SIDEBAR: f64 = 216.0;
const INSET: f64 = 16.0;

/// Centre the card over the Settings content pane, bottom-aligned.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn settings_helper_bounds(settings: Bounds) -> Bounds {
    let content = settings.width - SETTINGS_SIDEBAR;
    let width = 560.0_f64.min(content - INSET * 2.0);
    Bounds {
        x: (settings.x + SETTINGS_SIDEBAR + (content - width) / 2.0).round(),
        y: (settings.y + settings.height - HELPER_HEIGHT - INSET).round(),
        width: width.round(),
        height: HELPER_HEIGHT,
    }
}

/// The running `.app` bundle for an executable at `X.app/Contents/MacOS/bin`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn bundle_path(executable: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    is_bundle.then(|| bundle.to_path_buf())
}

#[tauri::command(async)]
pub async fn system_permission_helper_show(app: AppHandle, id: PermissionId) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac::show(app, id);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, id);
        Ok(())
    }
}

#[tauri::command]
pub fn system_permission_helper_close(app: AppHandle) {
    #[cfg(target_os = "macos")]
    mac::close(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command(async)]
pub async fn system_permission_helper_reveal_app(app: AppHandle) -> Result<(), String> {
    let _ = app;
    #[cfg(target_os = "macos")]
    return mac::reveal_app();
    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{bundle_path, settings_helper_bounds, Bounds, LABEL};
    use crate::system_permissions::{
        entry, pane_name, status_report, PermissionId, PermissionState, CHANGED_EVENT,
    };
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_foundation::NSString;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;
    use tauri::{
        AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
    };

    /// Bumped by every show/close; a tracking thread stops when it changes.
    static GENERATION: AtomicU64 = AtomicU64::new(0);

    #[repr(C)]
    #[derive(Default)]
    struct CGRect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    const ON_SCREEN_ONLY: u32 = 1 << 0;
    const EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *const AnyObject;
        fn CGRectMakeWithDictionaryRepresentation(
            dict: *const AnyObject,
            rect: *mut CGRect,
        ) -> bool;
        static kCGWindowOwnerPID: *const AnyObject;
        static kCGWindowLayer: *const AnyObject;
        static kCGWindowBounds: *const AnyObject;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
    }

    struct SettingsWindow {
        bounds: Bounds,
        frontmost: bool,
    }

    /// Window bounds and PIDs need no Screen Recording grant. Matching the
    /// bundle id avoids localized window titles.
    fn settings_window() -> Option<SettingsWindow> {
        let running = AnyClass::get(c"NSRunningApplication")?;
        let workspace = AnyClass::get(c"NSWorkspace")?;
        objc2::rc::autoreleasepool(|_| unsafe {
            // SAFETY: AppKit class methods with documented argument types; every
            // returned object is autoreleased into this pool, and the copied
            // window list is released before returning.
            let bundle = NSString::from_str("com.apple.systempreferences");
            let apps: *mut AnyObject =
                msg_send![running, runningApplicationsWithBundleIdentifier: &*bundle];
            if apps.is_null() {
                return None;
            }
            let count: usize = msg_send![apps, count];
            if count == 0 {
                return None;
            }
            let settings_app: *mut AnyObject = msg_send![apps, objectAtIndex: 0usize];
            let pid: i32 = msg_send![settings_app, processIdentifier];
            let shared: *mut AnyObject = msg_send![workspace, sharedWorkspace];
            let front: *mut AnyObject = msg_send![shared, frontmostApplication];
            let frontmost = !front.is_null() && {
                let front_pid: i32 = msg_send![front, processIdentifier];
                front_pid == pid
            };
            let list = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP_ELEMENTS, 0);
            if list.is_null() {
                return None;
            }
            let mut found = None;
            let windows: usize = msg_send![list, count];
            for index in 0..windows {
                let info: *mut AnyObject = msg_send![list, objectAtIndex: index];
                let owner: *mut AnyObject = msg_send![info, objectForKey: kCGWindowOwnerPID];
                let layer: *mut AnyObject = msg_send![info, objectForKey: kCGWindowLayer];
                let rect_dict: *mut AnyObject = msg_send![info, objectForKey: kCGWindowBounds];
                if owner.is_null() || layer.is_null() || rect_dict.is_null() {
                    continue;
                }
                let owner: i32 = msg_send![owner, intValue];
                let layer: i32 = msg_send![layer, intValue];
                let mut rect = CGRect::default();
                if owner != pid
                    || layer != 0
                    || !CGRectMakeWithDictionaryRepresentation(rect_dict, &mut rect)
                    || rect.width < 500.0
                    || rect.height < 350.0
                {
                    continue;
                }
                found = Some(SettingsWindow {
                    bounds: Bounds {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                    frontmost,
                });
                break;
            }
            CFRelease(list.cast());
            found
        })
    }

    pub fn close(app: &AppHandle) {
        GENERATION.fetch_add(1, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.close();
        }
    }

    fn finish(app: &AppHandle) {
        close(app);
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
        let _ = app.emit_to("main", CHANGED_EVENT, status_report());
    }

    pub fn show(app: AppHandle, id: PermissionId) -> Result<(), String> {
        close(&app);
        if entry(id).state == PermissionState::Granted {
            return Ok(());
        }
        let generation = GENERATION.load(Ordering::SeqCst);
        let url = format!("permission-helper.html?permission={}", pane_name(id));
        // CG window bounds and Tauri logical positions share a top-left origin
        // in display points, including negative coordinates on other displays.
        crate::webview_args::inherit_main_browser_args(
            &app,
            WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App(url.into())),
        )
        .title(&app.package_info().name)
        .inner_size(560.0, super::HELPER_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
        std::thread::spawn(move || track(app, id, generation));
        Ok(())
    }

    /// Follows System Settings until the grant arrives, Settings closes or a
    /// newer show/close replaces this helper.
    fn track(app: AppHandle, id: PermissionId, generation: u64) {
        let mut seen_settings = false;
        let mut tick: u64 = 0;
        loop {
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let Some(window) = app.get_webview_window(LABEL) else {
                return;
            };
            if tick % 2 == 0 && entry(id).state == PermissionState::Granted {
                finish(&app);
                return;
            }
            let settings = settings_window();
            let frontmost = settings.as_ref().is_some_and(|s| s.frontmost);
            match settings {
                Some(settings) if frontmost || window.is_focused().unwrap_or(false) => {
                    seen_settings = true;
                    let bounds = settings_helper_bounds(settings.bounds);
                    let _ = window.set_size(LogicalSize::new(bounds.width, bounds.height));
                    let _ = window.set_position(LogicalPosition::new(bounds.x, bounds.y));
                    if !window.is_visible().unwrap_or(false) {
                        let _ = window.show();
                    }
                }
                Some(_) => {
                    seen_settings = true;
                    let _ = window.hide();
                }
                None if seen_settings => {
                    // The owner closed System Settings; the card has no anchor.
                    close(&app);
                    return;
                }
                None => {
                    let _ = window.hide();
                }
            }
            tick = tick.wrapping_add(1);
            std::thread::sleep(Duration::from_millis(if frontmost { 500 } else { 1000 }));
        }
    }

    /// Reveals the running bundle in Finder so the owner can drag it into the
    /// System Settings list.
    // shortcut: reveal-only, no native drag of the bundle from the webview;
    // upgrade with an NSDraggingSession from the helper's NSView if owners ask.
    pub fn reveal_app() -> Result<(), String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let bundle = bundle_path(&executable)
            .ok_or_else(|| "bycoda is not running from an app bundle.".to_string())?;
        let workspace =
            AnyClass::get(c"NSWorkspace").ok_or_else(|| "Finder is unavailable.".to_string())?;
        let revealed = objc2::rc::autoreleasepool(|_| unsafe {
            // SAFETY: NSWorkspace class and instance methods with NSString
            // arguments that live until the call returns.
            let path = NSString::from_str(&bundle.to_string_lossy());
            let root = NSString::from_str("");
            let shared: *mut AnyObject = msg_send![workspace, sharedWorkspace];
            let ok: Bool = msg_send![shared, selectFile: &*path, inFileViewerRootedAtPath: &*root];
            ok.as_bool()
        });
        if revealed {
            Ok(())
        } else {
            Err("Could not reveal bycoda in Finder.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn helper_centres_in_content_and_aligns_to_bottom() {
        assert_eq!(
            settings_helper_bounds(Bounds {
                x: 100.0,
                y: 50.0,
                width: 1000.0,
                height: 700.0
            }),
            Bounds {
                x: 428.0,
                y: 594.0,
                width: 560.0,
                height: 140.0
            }
        );
        assert_eq!(
            settings_helper_bounds(Bounds {
                x: -500.0,
                y: -100.0,
                width: 500.0,
                height: 350.0
            }),
            Bounds {
                x: -268.0,
                y: 94.0,
                width: 252.0,
                height: 140.0
            }
        );
    }

    #[test]
    fn finds_the_app_bundle_of_the_executable() {
        assert_eq!(
            bundle_path(Path::new("/Applications/bycoda.app/Contents/MacOS/bycoda")),
            Some(Path::new("/Applications/bycoda.app").to_path_buf())
        );
        assert_eq!(bundle_path(Path::new("/usr/local/bin/bycoda")), None);
        assert_eq!(bundle_path(Path::new("/tmp/Contents/MacOS/bycoda")), None);
    }
}
