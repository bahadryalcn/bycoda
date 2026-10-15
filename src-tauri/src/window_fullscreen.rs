use tauri::WebviewWindow;

/// Set fullscreen without changing maximize state or the saved window placement.
#[tauri::command]
pub async fn set_window_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Win32 subclass installation must run on the window's owning thread.
        let (tx, mut rx) = tauri::async_runtime::channel(1);
        let owner = window.clone();
        window
            .run_on_main_thread(move || {
                let result = windows::set_fullscreen(&owner, fullscreen);
                let _ = tx.try_send(result);
            })
            .map_err(|error| error.to_string())?;
        rx.recv()
            .await
            .ok_or_else(|| "Fullscreen window closed during transition".to_string())?
    }
    #[cfg(not(windows))]
    window
        .set_fullscreen(fullscreen)
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
mod windows {
    use tauri::WebviewWindow;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{WM_NCCALCSIZE, WM_NCDESTROY},
        },
    };

    const SUBCLASS_ID: usize = 0x42594653;

    // Tao 0.35's undecorated WM_NCCALCSIZE path applies rcWork to maximized
    // fullscreen windows. During fullscreen only, keep the incoming monitor
    // rectangle as the client rectangle. All other messages use Tao as usual.
    // No allocation or Tauri calls are made inside the window procedure.
    unsafe extern "system" fn client_area_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        fullscreen: usize,
    ) -> LRESULT {
        if message == WM_NCCALCSIZE && fullscreen != 0 {
            return 0;
        }
        if message == WM_NCDESTROY {
            unsafe { RemoveWindowSubclass(hwnd, Some(client_area_proc), id) };
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    fn set_client_area_mode(hwnd: HWND, fullscreen: bool) -> Result<(), String> {
        // Reusing the procedure/id updates the per-window ref data in place.
        if unsafe {
            SetWindowSubclass(
                hwnd,
                Some(client_area_proc),
                SUBCLASS_ID,
                usize::from(fullscreen),
            )
        } == 0
        {
            return Err("Could not configure the fullscreen client area".into());
        }
        Ok(())
    }

    pub(super) fn set_fullscreen(window: &WebviewWindow, fullscreen: bool) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        let previous = window.is_fullscreen().map_err(|error| error.to_string())?;
        set_client_area_mode(hwnd, fullscreen)?;
        if let Err(error) = window.set_fullscreen(fullscreen) {
            set_client_area_mode(hwnd, previous)?;
            return Err(error.to_string());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::{
            Foundation::RECT,
            UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, GetClientRect, GetWindowRect, SetWindowPos,
                NCCALCSIZE_PARAMS, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                SWP_NOZORDER, WS_POPUP,
            },
        };

        // Reproduce the native work-area clipping below the production subclass.
        unsafe extern "system" fn work_area_proc(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
            _: usize,
            _: usize,
        ) -> LRESULT {
            if message == WM_NCCALCSIZE && wparam != 0 {
                unsafe { (*(lparam as *mut NCCALCSIZE_PARAMS)).rgrc[0].bottom -= 48 };
                return 0;
            }
            unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
        }

        struct HiddenWindow(HWND);
        impl HiddenWindow {
            fn new() -> Self {
                let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
                // No WS_VISIBLE: this test never shows or activates a window.
                let hwnd = unsafe {
                    CreateWindowExW(
                        0,
                        class.as_ptr(),
                        std::ptr::null(),
                        WS_POPUP,
                        100,
                        100,
                        640,
                        480,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null(),
                    )
                };
                assert!(!hwnd.is_null());
                assert_ne!(
                    unsafe { SetWindowSubclass(hwnd, Some(work_area_proc), 1, 0) },
                    0
                );
                Self(hwnd)
            }

            fn dimensions(&self) -> (i32, i32, i32, i32) {
                let mut outer: RECT = unsafe { std::mem::zeroed() };
                let mut client: RECT = unsafe { std::mem::zeroed() };
                unsafe {
                    assert_ne!(
                        SetWindowPos(
                            self.0,
                            std::ptr::null_mut(),
                            0,
                            0,
                            0,
                            0,
                            SWP_FRAMECHANGED
                                | SWP_NOACTIVATE
                                | SWP_NOMOVE
                                | SWP_NOSIZE
                                | SWP_NOZORDER
                        ),
                        0
                    );
                    assert_ne!(GetWindowRect(self.0, &mut outer), 0);
                    assert_ne!(GetClientRect(self.0, &mut client), 0);
                }
                (
                    outer.right - outer.left,
                    outer.bottom - outer.top,
                    client.right - client.left,
                    client.bottom - client.top,
                )
            }
        }

        impl Drop for HiddenWindow {
            fn drop(&mut self) {
                unsafe { DestroyWindow(self.0) };
            }
        }

        #[test]
        fn fullscreen_uses_entire_client_area_without_resizing_the_window() {
            let window = HiddenWindow::new();
            let other = HiddenWindow::new();
            assert_eq!(window.dimensions(), (640, 480, 640, 432));
            set_client_area_mode(window.0, true).unwrap();
            assert_eq!(window.dimensions(), (640, 480, 640, 480));
            // State belongs to the target window only.
            assert_eq!(other.dimensions(), (640, 480, 640, 432));
            set_client_area_mode(window.0, false).unwrap();
            assert_eq!(window.dimensions(), (640, 480, 640, 432));
        }
    }
}
