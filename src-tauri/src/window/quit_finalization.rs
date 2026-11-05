use super::{workspace_windows, ALLOW_EXIT, QUIT_RUN};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

fn begin_finalization(finalizing: &AtomicBool) -> bool {
    !finalizing.swap(true, Ordering::SeqCst)
}

/// Persist already happened in JS. Show windows so window-state doesn't save hidden.
pub fn confirm_quit(app: AppHandle) {
    static FINALIZING: AtomicBool = AtomicBool::new(false);
    if !begin_finalization(&FINALIZING) {
        return;
    }
    *QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()) = None;
    for window in workspace_windows(&app) {
        let _ = window.show();
    }
    // Belt and braces. `RunEvent::Exit` reaps too, and it also runs before the
    // process is gone, but a macOS terminate that skips the run loop would not
    // reach it — and `kill_all`'s SIGKILL wait only works while we're alive.
    std::thread::spawn(move || {
        if let Some(host) = app.try_state::<crate::harness::HarnessHost>() {
            host.kill_all();
        }
        if let Some(host) = app.try_state::<crate::pty::PtyHost>() {
            host.kill_all();
        }
        ALLOW_EXIT.store(true, Ordering::SeqCst);
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finalization_can_only_start_once() {
        let finalizing = AtomicBool::new(false);
        assert!(begin_finalization(&finalizing));
        assert!(!begin_finalization(&finalizing));
    }
}
