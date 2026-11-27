use super::{
    begin_run, resurface_prompt, watch_stage, workspace_labels, workspace_windows, Stage,
    ALLOW_EXIT, POLL_TIMEOUT, QUIT_COUNTER, QUIT_POLL, QUIT_RUN,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

/// Whether the run that finalizes relaunches instead of exiting. Each started run
/// stores its own kind, so an aborted restart cannot turn a later quit into one.
static RESTART: AtomicBool = AtomicBool::new(false);
/// Set once the app has committed to exiting or relaunching.
static FINALIZING: AtomicBool = AtomicBool::new(false);

fn begin_finalization(finalizing: &AtomicBool) -> bool {
    !finalizing.swap(true, Ordering::SeqCst)
}

/// Ask every window what it has running, then decide once for all of them.
pub fn request_quit(app: &AppHandle) {
    start_run(app, false);
}

#[tauri::command]
pub fn request_app_quit(app: AppHandle) {
    request_quit(&app);
}

/// Quit through the same save-and-confirm run as a manual quit, then relaunch.
/// Settings that only take effect at window creation (Window glass) use this.
#[tauri::command]
pub fn request_app_restart(app: AppHandle) {
    start_run(&app, true);
}

/// Relaunch without polling the windows, for a dead webview that cannot answer.
/// The caller owns asking the user. A quit already finalizing stays a quit.
#[cfg(windows)]
pub fn restart_now(app: AppHandle) {
    if begin_finalization(&FINALIZING) {
        RESTART.store(true, Ordering::SeqCst);
        finalize(app);
    }
}

#[cfg(windows)]
pub(crate) fn is_finalizing() -> bool {
    FINALIZING.load(Ordering::SeqCst)
}

fn start_run(app: &AppHandle, restart: bool) {
    #[cfg(windows)]
    if crate::webview_recovery::is_rebuilding() {
        // The native windows still own work while their webviews are replaced.
        log::info!("quit request skipped during WebView2 recovery");
        return;
    }
    let mut labels = workspace_labels(app);
    if labels.is_empty() && crate::host_lifecycle::owned_pid().is_some() {
        // A dock-only app must still be able to ask before interrupting its Host.
        let _ = super::show_hidden_or_open_new(app);
        labels = workspace_labels(app);
    }
    if labels.is_empty() {
        RESTART.store(restart, Ordering::SeqCst);
        confirm_quit(app.clone());
        return;
    }
    let id = QUIT_COUNTER.fetch_add(1, Ordering::Relaxed);
    if !begin_run(
        &mut QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()),
        id,
        labels,
    ) {
        resurface_prompt(app);
        return;
    }
    RESTART.store(restart, Ordering::SeqCst);
    // One webview tearing down fails the whole emit, and exiting on that would
    // kill every other window's work without asking. Let the poll time out
    // instead: silence counts as busy, so the user is still asked.
    // ast-grep-ignore: rust-emit-broadcast -- the quit poll must reach every workspace window
    let _ = app.emit(QUIT_POLL, id);
    watch_stage(app, id, Stage::Polling, POLL_TIMEOUT);
}

/// Persist already happened in JS. Show windows so window-state doesn't save hidden.
pub fn confirm_quit(app: AppHandle) {
    if begin_finalization(&FINALIZING) {
        finalize(app);
    }
}

fn finalize(app: AppHandle) {
    crate::host_lifecycle::begin_quit();
    *QUIT_RUN.lock().unwrap_or_else(|error| error.into_inner()) = None;
    if crate::host_lifecycle::owned_pid().is_some() {
        for window in workspace_windows(&app) {
            let _ = window.hide();
        }
    }
    // Belt and braces. `RunEvent::Exit` reaps too, and it also runs before the
    // process is gone, but a macOS terminate that skips the run loop would not
    // reach it — and `kill_all`'s SIGKILL wait only works while we're alive.
    std::thread::spawn(move || {
        crate::host_lifecycle::finish_quit();
        if let Some(host) = app.try_state::<crate::harness::HarnessHost>() {
            host.kill_all();
        }
        if let Some(host) = app.try_state::<crate::pty::PtyHost>() {
            host.kill_all();
        }
        for window in workspace_windows(&app) {
            let _ = window.show();
        }
        ALLOW_EXIT.store(true, Ordering::SeqCst);
        if RESTART.load(Ordering::SeqCst) {
            app.restart();
        } else {
            app.exit(0);
        }
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
