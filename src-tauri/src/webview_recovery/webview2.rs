//! WebView2 `ProcessFailed` registration and the actions behind it.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2ProcessFailedEventArgs, ICoreWebView2ProcessFailedEventArgs2,
    COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_REASON,
};
use webview2_com::ProcessFailedEventHandler;
use windows::core::Interface;

use super::policy::{classify, Action, FailureKind, History};

static HISTORY: Mutex<Option<History>> = Mutex::new(None);
/// Every webview reports the same browser exit; only the first one acts.
static BROWSER_EXIT_HANDLED: AtomicBool = AtomicBool::new(false);
/// A declined relaunch is offered again, since the window stays dead until then.
const ASK_AGAIN: Duration = Duration::from_secs(5 * 60);

/// Registers the handler on one webview. Failures are logged, never fatal.
pub(super) fn register(webview: &Webview) {
    let app = webview.app_handle().clone();
    let label = webview.label().to_owned();
    let target = webview.clone();
    let registered = webview.with_webview(move |platform| {
        let (handler_app, handler_label) = (app, label.clone());
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                on_failure(&handler_app, &target, &handler_label, &args);
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: the controller and handler are live COM objects; WebView2
        // keeps its own reference to the handler for the webview's lifetime.
        let result = unsafe {
            platform
                .controller()
                .CoreWebView2()
                .and_then(|core| core.add_ProcessFailed(&handler, &mut token))
        };
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
    let action = if failure == FailureKind::BrowserExited
        && BROWSER_EXIT_HANDLED.swap(true, Ordering::SeqCst)
    {
        Action::Ignore
    } else {
        record(app, failure, label)
    };
    log::error!(
        "webview {label}: {name} (exit code {exit_code:?}, reason {reason:?}) -> {action:?}"
    );
    match action {
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
        Action::Relaunch => {
            let app = app.clone();
            std::thread::spawn(move || relaunch_when_allowed(app));
        }
        Action::GiveUp => {
            log::error!(
                "webview {label}: recovery budget spent; leaving the window as it is instead of looping"
            );
            if failure == FailureKind::BrowserExited {
                let app = app.clone();
                std::thread::spawn(move || offer_quit(app));
            }
        }
        Action::Ignore => {}
    }
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

/// Decides under one lock and persists a relaunch before it happens, so a
/// crash loop across restarts still meets its limit.
fn record(app: &AppHandle, failure: FailureKind, label: &str) -> Action {
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
    let action = history.record(failure, label, now_ms());
    if action == Action::Relaunch {
        if let Some(path) = path {
            if let Err(error) = persist(&path, history.relaunches()) {
                log::warn!("cannot persist webview relaunch history: {error}");
            }
        }
    }
    action
}

fn persist(path: &std::path::Path, stamps: &[u64]) -> std::io::Result<()> {
    let text: String = stamps.iter().map(|stamp| format!("{stamp}\n")).collect();
    crate::diagnostics::write_atomic(path, text.as_bytes())
}
