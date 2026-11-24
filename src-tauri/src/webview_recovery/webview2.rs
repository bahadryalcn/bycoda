//! WebView2 `ProcessFailed` registration and the actions behind it.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment5, ICoreWebView2ProcessFailedEventArgs,
    ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND_FAILED,
    COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_REASON,
};
use webview2_com::{BrowserProcessExitedEventHandler, ProcessFailedEventHandler};
use windows::core::Interface;

use super::policy::{classify, Action, FailureKind, History};
use super::recreate::{self, BrowserView};

static HISTORY: Mutex<Option<History>> = Mutex::new(None);
static FALLBACK_STARTED: AtomicBool = AtomicBool::new(false);
const EXIT_EVENT_TIMEOUT: Duration = Duration::from_secs(8);
/// A declined relaunch is offered again, since the window stays dead until then.
const ASK_AGAIN: Duration = Duration::from_secs(5 * 60);

/// Registers the handler on one webview. Failures are logged, never fatal.
pub(super) fn register(webview: &Webview) {
    let app = webview.app_handle().clone();
    let label = webview.label().to_owned();
    let target = webview.clone();
    let registered = webview.with_webview(move |platform| {
        // SAFETY: this callback is on the controller's owning thread.
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                log::warn!("webview {label}: cannot access WebView2 controller: {error}");
                return;
            }
        };
        let mut pid = 0;
        // SAFETY: the out pointer is valid and the controller is live.
        let browser = unsafe { core.BrowserProcessId(&mut pid) }
            .ok()
            .filter(|()| pid != 0)
            .map(|()| recreate::register(&label, pid));
        if let Some(browser) = browser {
            let result = platform
                .environment()
                .cast::<ICoreWebView2Environment5>()
                .and_then(|environment| {
                    let event_app = app.clone();
                    let event_label = label.clone();
                    let handler =
                        BrowserProcessExitedEventHandler::create(Box::new(move |_, args| {
                            if let Some(args) = args {
                                let mut kind = Default::default();
                                let mut exited_pid = 0;
                                // SAFETY: args are live for the callback and both outputs are local.
                                let failed = unsafe {
                                    args.BrowserProcessExitKind(&mut kind).is_ok()
                                        && args.BrowserProcessId(&mut exited_pid).is_ok()
                                } && kind
                                    == COREWEBVIEW2_BROWSER_PROCESS_EXIT_KIND_FAILED;
                                if failed && exited_pid == browser.pid {
                                    schedule_recovery(
                                        event_app.clone(),
                                        event_label.clone(),
                                        browser,
                                        true,
                                    );
                                }
                            }
                            Ok(())
                        }));
                    // SAFETY: the live environment retains its own reference to the handler.
                    unsafe { environment.add_BrowserProcessExited(&handler, &mut 0) }
                });
            if let Err(error) = result {
                log::warn!("webview {label}: cannot watch for browser shutdown: {error}");
            }
        }
        let (handler_app, handler_label) = (app, label.clone());
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                on_failure(&handler_app, &target, &handler_label, browser, &args);
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the controller and handler are live COM objects; WebView2
        // keeps its own reference to the handler for the webview's lifetime.
        let result = unsafe { core.add_ProcessFailed(&handler, &mut token) };
        if let Err(error) = result {
            log::warn!("webview {label}: cannot watch for process failures: {error}");
        }
    });
    if let Err(error) = registered {
        log::warn!("webview recovery registration failed: {error}");
    }
}

fn on_failure(
    app: &AppHandle,
    webview: &Webview,
    label: &str,
    browser: Option<BrowserView>,
    args: &ICoreWebView2ProcessFailedEventArgs,
) {
    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
    // SAFETY: `args` is a live COM object and `kind` outlives the call.
    if unsafe { args.ProcessFailedKind(&mut kind) }.is_err() {
        log::warn!("webview {label}: process failure with unreadable kind");
        return;
    }
    let (failure, name) = classify(kind.0);
    let (mut exit_code, mut reason) = (None, None);
    if let Ok(args2) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
        let (mut code, mut why) = (0i32, COREWEBVIEW2_PROCESS_FAILED_REASON::default());
        // SAFETY: as above.
        unsafe {
            exit_code = args2.ExitCode(&mut code).ok().map(|()| code);
            reason = args2.Reason(&mut why).ok().map(|()| why.0);
        }
    }
    log::error!(
        "webview {label}: {name} (browser pid {:?}, exit code {exit_code:?}, reason {reason:?})",
        browser.map(|view| view.pid)
    );
    if browser.is_some_and(|browser| !recreate::active(label, browser)) {
        return;
    }
    if failure == FailureKind::BrowserExited {
        match browser {
            Some(browser) if recreate::wait_for_exit(label, browser) => {
                schedule_recovery(app.clone(), label.to_owned(), browser, false);
            }
            Some(_) => {}
            None => start_fallback(app.clone()),
        }
        return;
    }
    match with_history(app, |history, _| history.record(failure, label, now_ms())) {
        Action::Reload => {
            // Off the UI thread, which is the one delivering this event.
            let webview = webview.clone();
            let label = label.to_owned();
            std::thread::spawn(move || {
                if let Err(error) = webview.reload() {
                    log::error!("webview {label}: reload failed: {error}");
                }
            });
        }
        Action::GiveUp => {
            log::error!(
                "webview {label}: recovery budget spent; leaving the window as it is instead of looping"
            );
        }
        Action::Ignore | Action::Recreate => {}
    }
}

fn schedule_recovery(app: AppHandle, label: String, browser: BrowserView, exited: bool) {
    // Posting from another thread lets the COM callback return before Wry closes
    // its controller. The timeout retains the native fallback if no exit arrives.
    std::thread::spawn(move || {
        if !exited {
            std::thread::sleep(EXIT_EVENT_TIMEOUT);
        }
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if crate::window::quit_finalization::is_finalizing() {
                return;
            }
            let labels = recreate::take_failed_group(&label, browser, exited);
            if labels.is_empty() {
                return;
            }
            let action = with_history(&handle, |history, _| {
                history.record(FailureKind::BrowserExited, &label, now_ms())
            });
            if exited && action == Action::Recreate {
                let rebuilding = recreate::RebuildGuard::begin();
                match recreate::close_failed_views(&handle, &labels) {
                    Ok(views) => {
                        std::thread::spawn(move || {
                            let result = recreate::rebuild(views);
                            drop(rebuilding);
                            match result {
                            Ok(count) => log::info!(
                                "webview browser {}: recreated {count} controller(s)",
                                browser.pid
                            ),
                            Err(error) => {
                                log::error!("webview browser {}: recreation failed: {error}", browser.pid);
                                start_fallback(handle);
                            }
                            }
                        });
                        return;
                    }
                    Err(error) => log::error!("webview browser {}: could not close failed controllers: {error}", browser.pid),
                }
            } else {
                log::warn!(
                    "webview browser {}: cannot recreate controllers (exit confirmed: {exited}, action: {action:?})",
                    browser.pid
                );
            }
            start_fallback(handle);
        }) {
            log::warn!("webview recovery dispatch failed: {error}");
            start_fallback(app);
        }
    });
}

fn start_fallback(app: AppHandle) {
    if FALLBACK_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        if crate::window::quit_finalization::is_finalizing() {
            return;
        }
        let can_relaunch = with_history(&app, |history, path| {
            if !history.record_relaunch(now_ms()) {
                return false;
            }
            if let Some(path) = path {
                if let Err(error) = persist(path, history.relaunches()) {
                    log::warn!("cannot persist webview relaunch history: {error}");
                }
            }
            true
        });
        if can_relaunch {
            relaunch_when_allowed(app);
        } else {
            offer_quit(app);
        }
    });
}

/// A relaunch stops an app-owned Host, desktop agents and terminals, so it asks
/// first when any exist. The dead webview cannot, hence a native dialog.
fn relaunch_when_allowed(app: AppHandle) {
    use crate::window::quit_finalization::{is_finalizing, restart_now};
    loop {
        if is_finalizing() {
            return;
        }
        if !has_interruptible_work(&app)
            || confirm(
                &app,
                "bycoda's interface stopped unexpectedly. Restart now? Running terminals and desktop agents will stop.",
                "Restart",
                "Later",
            )
        {
            restart_now(app);
            return;
        }
        std::thread::sleep(ASK_AGAIN);
    }
}

fn offer_quit(app: AppHandle) {
    if confirm(
        &app,
        "bycoda's interface keeps stopping and could not recover. Quit now? Running terminals and desktop agents will stop.",
        "Quit",
        "Keep open",
    ) {
        crate::window::quit_finalization::confirm_quit(app);
    }
}

fn has_interruptible_work(app: &AppHandle) -> bool {
    crate::host_lifecycle::owned_pid().is_some()
        || app
            .try_state::<crate::harness::HarnessHost>()
            .is_some_and(|host| host.has_live_children())
        || app
            .try_state::<crate::pty::PtyHost>()
            .is_some_and(|host| host.has_sessions())
}

fn confirm(app: &AppHandle, message: &str, accept: &str, decline: &str) -> bool {
    app.dialog()
        .message(message)
        .title("bycoda")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            accept.to_owned(),
            decline.to_owned(),
        ))
        .blocking_show()
}

fn history_path(app: &AppHandle) -> Option<PathBuf> {
    let directory = app.path().app_data_dir().ok()?;
    Some(directory.join("diagnostics").join("webview-relaunches.txt"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn with_history<T>(
    app: &AppHandle,
    use_history: impl FnOnce(&mut History, Option<&std::path::Path>) -> T,
) -> T {
    let path = history_path(app);
    let mut guard = HISTORY.lock().unwrap_or_else(|error| error.into_inner());
    let history = guard.get_or_insert_with(|| {
        let stamps = path
            .as_deref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .map(|text| {
                text.lines()
                    .filter_map(|line| line.trim().parse().ok())
                    .collect()
            })
            .unwrap_or_default();
        History::with_relaunches(stamps)
    });
    use_history(history, path.as_deref())
}

fn persist(path: &std::path::Path, stamps: &[u64]) -> std::io::Result<()> {
    let text: String = stamps.iter().map(|stamp| format!("{stamp}\n")).collect();
    crate::diagnostics::write_atomic(path, text.as_bytes())
}
