use super::{
    begin_run, resurface_prompt, watch_stage, workspace_labels, workspace_windows, Stage,
    ALLOW_EXIT, POLL_TIMEOUT, QUIT_COUNTER, QUIT_POLL, QUIT_RUN,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

/// Whether the run that finalizes relaunches instead of exiting. Each started run
/// stores its own kind, so an aborted restart cannot turn a later quit into one.
static RESTART: AtomicBool = AtomicBool::new(false);

fn begin_finalization(finalizing: &AtomicBool) -> bool {
    !finalizing.swap(true, Ordering::SeqCst)
}

/// Ask every window what it has running, then decide once for all of them.
pub fn request_quit(app: &AppHandle) {
    start_run(app, false);
}

/// Quit through the same save-and-confirm run as a manual quit, then relaunch.
/// Settings that only take effect at window creation (Window glass) use this.
#[tauri::command]
pub fn request_app_restart(app: AppHandle) {
    start_run(&app, true);
}

fn start_run(app: &AppHandle, restart: bool) {
    let labels = workspace_labels(app);
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
