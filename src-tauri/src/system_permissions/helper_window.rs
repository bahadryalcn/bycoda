//! Keeps a permission card next to System Settings on macOS.

#[cfg(target_os = "macos")]
pub(super) use mac::{close, owns, show};

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

const WIDTH: f64 = 320.0;
const HEIGHT: f64 = 144.0;
const GAP: f64 = 12.0;

fn settings_helper_bounds(settings: Bounds, work_area: Bounds) -> Option<Bounds> {
    let min_x = work_area.x + GAP;
    let min_y = work_area.y + GAP;
    let max_x = work_area.x + work_area.width - WIDTH - GAP;
    let max_y = work_area.y + work_area.height - HEIGHT - GAP;
    if min_x > max_x || min_y > max_y {
        return None;
    }

    let x = (settings.x + (settings.width - WIDTH) / 2.0).clamp(min_x, max_x);
    let y = (settings.y + (settings.height - HEIGHT) / 2.0).clamp(min_y, max_y);
    [
        (x, settings.y + settings.height + GAP),
        (settings.x + settings.width + GAP, y),
        (settings.x - WIDTH - GAP, y),
        (x, settings.y - HEIGHT - GAP),
    ]
    .into_iter()
    .find(|&(x, y)| (min_x..=max_x).contains(&x) && (min_y..=max_y).contains(&y))
    .map(|(x, y)| Bounds {
        x,
        y,
        width: WIDTH,
        height: HEIGHT,
    })
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{settings_helper_bounds, Bounds, HEIGHT, WIDTH};
    use crate::system_permissions::{
        entry, pane_name, PermissionId, PermissionState, RESTART_REQUIRED,
    };
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize, NSString};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager, WebviewWindow};

    static GENERATION: AtomicU32 = AtomicU32::new(0);

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

    fn label(generation: u32) -> String {
        format!("permission-helper-{generation}")
    }

    pub(in crate::system_permissions) fn owns(window: &WebviewWindow) -> bool {
        window.label() == label(GENERATION.load(Ordering::SeqCst))
    }

    pub(in crate::system_permissions) fn close(app: &AppHandle, generation: u32) {
        if let Some(window) = app.get_webview_window(&label(generation)) {
            let _ = window.close();
        }
    }

    fn settled(id: PermissionId) -> bool {
        let current = entry(id);
        current.state == PermissionState::Granted
            || current.detail.as_deref() == Some(RESTART_REQUIRED)
    }

    pub(in crate::system_permissions) fn show(
        app: AppHandle,
        id: PermissionId,
    ) -> Result<Option<u32>, String> {
        match id {
            PermissionId::Accessibility
            | PermissionId::ScreenRecording
            | PermissionId::FullDiskAccess => {}
            _ => return Ok(None),
        }
        let previous = GENERATION.fetch_add(1, Ordering::SeqCst);
        let generation = previous.wrapping_add(1);
        close(&app, previous);
        if settled(id) {
            return Ok(None);
        }

        // Each opening owns its window. An old close can finish after a new open.
        let url = format!("permission-helper.html?permission={}", pane_name(id));
        let window = crate::webview_args::new_app_window(&app, &label(generation), url)
            .title(&app.package_info().name)
            .inner_size(WIDTH, HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .accept_first_mouse(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
        std::thread::spawn(move || track(app, window, id, generation));
        Ok(Some(generation))
    }

    fn place(window: &WebviewWindow, settings: Bounds) -> Option<()> {
        let screens = NSScreen::screens(MainThreadMarker::new()?);
        let primary_top = screens.firstObject()?.frame().size.height;
        let x = settings.x + settings.width / 2.0;
        let y = primary_top - (settings.y + settings.height / 2.0);
        let screen = screens.iter().find(|screen| {
            let frame = screen.frame();
            (frame.origin.x..frame.origin.x + frame.size.width).contains(&x)
                && (frame.origin.y..frame.origin.y + frame.size.height).contains(&y)
        })?;
        let visible = screen.visibleFrame();
        let bounds = settings_helper_bounds(
            settings,
            Bounds {
                x: visible.origin.x,
                y: primary_top - (visible.origin.y + visible.size.height),
                width: visible.size.width,
                height: visible.size.height,
            },
        )?;
        let native_window = crate::macos::ns_window(window)?;
        let frame = NSRect::new(
            NSPoint::new(bounds.x, primary_top - (bounds.y + bounds.height)),
            NSSize::new(bounds.width, bounds.height),
        );
        native_window.setFrame_display(frame, false);
        if !native_window.isVisible() {
            native_window.orderFrontRegardless();
        }
        Some(())
    }

    fn track(app: AppHandle, window: WebviewWindow, id: PermissionId, generation: u32) {
        let start = Instant::now();
        let mut seen_settings = false;
        let mut tick: u64 = 0;
        while GENERATION.load(Ordering::SeqCst) == generation
            && app.get_webview_window(window.label()).is_some()
        {
            if tick.is_multiple_of(2) && settled(id) {
                break;
            }
            let settings = settings_window();
            if settings.is_none() && (seen_settings || start.elapsed() >= Duration::from_secs(10)) {
                break;
            }
            seen_settings |= settings.is_some();
            let current = window.clone();
            let _ = app.run_on_main_thread(move || {
                if GENERATION.load(Ordering::SeqCst) != generation
                    || current
                        .app_handle()
                        .get_webview_window(current.label())
                        .is_none()
                {
                    return;
                }
                let placed = settings
                    .filter(|settings| settings.frontmost || current.is_focused().unwrap_or(false))
                    .and_then(|settings| place(&current, settings.bounds));
                if placed.is_none() {
                    let _ = current.hide();
                }
            });
            tick = tick.wrapping_add(1);
            std::thread::sleep(Duration::from_millis(400));
        }
        close(&app, generation);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn docks_below_then_to_the_side_without_covering_settings() {
        let screen = rect(0.0, 25.0, 1440.0, 855.0);
        assert_eq!(
            settings_helper_bounds(rect(220.0, 120.0, 860.0, 510.0), screen),
            Some(rect(490.0, 642.0, WIDTH, HEIGHT))
        );
        assert_eq!(
            settings_helper_bounds(rect(180.0, 25.0, 800.0, 855.0), screen),
            Some(rect(992.0, 380.5, WIDTH, HEIGHT))
        );
    }

    #[test]
    fn stays_on_the_settings_display_and_hides_if_there_is_no_room() {
        let screen = rect(-1440.0, 25.0, 1440.0, 855.0);
        assert_eq!(
            settings_helper_bounds(rect(-1070.0, 25.0, 1050.0, 855.0), screen),
            Some(rect(-1402.0, 380.5, WIDTH, HEIGHT))
        );
        assert_eq!(
            settings_helper_bounds(rect(-1430.0, 30.0, 1420.0, 840.0), screen),
            None
        );
    }
}
