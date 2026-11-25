//! Pure decision logic: failure kind plus attempt history gives an action.

#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::HashMap;

/// What failed, reduced to what changes the recovery.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FailureKind {
    /// The shared browser process died: every webview is dead and a reload
    /// cannot work.
    BrowserExited,
    /// This webview's renderer exited.
    RendererFailed,
    /// GPU, utility, sandbox helper and other processes WebView2 restarts itself.
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Action {
    Ignore,
    Reload,
    Recreate,
    /// The attempt budget is spent; recovering again would loop.
    GiveUp,
}

pub(super) const RELOAD_WINDOW_MS: u64 = 60_000;
pub(super) const MAX_RELOADS_PER_WINDOW: usize = 3;
pub(super) const RELAUNCH_WINDOW_MS: u64 = 10 * 60_000;
pub(super) const MAX_RELAUNCHES_PER_WINDOW: usize = 2;
const MAX_RECREATIONS_PER_WINDOW: usize = 2;

/// Maps `COREWEBVIEW2_PROCESS_FAILED_KIND`. An unresponsive renderer can recover
/// and a reload would discard its live state; a failed frame is only a subframe.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn classify(raw_kind: i32) -> (FailureKind, &'static str) {
    match raw_kind {
        0 => (FailureKind::BrowserExited, "browser process exited"),
        1 => (FailureKind::RendererFailed, "render process exited"),
        2 => (FailureKind::Other, "render process unresponsive"),
        3 => (FailureKind::Other, "frame render process exited"),
        4 => (FailureKind::Other, "utility process exited"),
        5 => (FailureKind::Other, "sandbox helper process exited"),
        6 => (FailureKind::Other, "GPU process exited"),
        _ => (FailureKind::Other, "other process exited"),
    }
}

/// Kind plus the attempts already made inside their windows gives the action.
fn decide(kind: FailureKind, recent_reloads: usize, recent_recreations: usize) -> Action {
    match kind {
        FailureKind::Other => Action::Ignore,
        FailureKind::RendererFailed if recent_reloads < MAX_RELOADS_PER_WINDOW => Action::Reload,
        FailureKind::BrowserExited if recent_recreations < MAX_RECREATIONS_PER_WINDOW => {
            Action::Recreate
        }
        FailureKind::RendererFailed | FailureKind::BrowserExited => Action::GiveUp,
    }
}

/// Timestamps (milliseconds) of recovery attempts. Relaunches are persisted
/// by the caller, because a relaunch resets the process and a crash loop
/// would otherwise never see its own history.
#[derive(Default)]
pub(super) struct History {
    reloads: HashMap<String, Vec<u64>>,
    recreations: Vec<u64>,
    relaunches: Vec<u64>,
}

fn recent(stamps: &mut Vec<u64>, now: u64, window: u64) -> usize {
    stamps.retain(|stamp| now.saturating_sub(*stamp) < window);
    stamps.len()
}

impl History {
    pub(super) fn with_relaunches(relaunches: Vec<u64>) -> Self {
        Self {
            relaunches,
            ..Self::default()
        }
    }

    pub(super) fn relaunches(&self) -> &[u64] {
        &self.relaunches
    }

    pub(super) fn record_relaunch(&mut self, now: u64) -> bool {
        if recent(&mut self.relaunches, now, RELAUNCH_WINDOW_MS) >= MAX_RELAUNCHES_PER_WINDOW {
            return false;
        }
        self.relaunches.push(now);
        true
    }

    /// Decides and records the attempt in one step so concurrent events for
    /// the same failure cannot both spend a stale budget.
    pub(super) fn record(&mut self, kind: FailureKind, label: &str, now: u64) -> Action {
        let reloads = self.reloads.entry(label.to_owned()).or_default();
        let action = decide(
            kind,
            recent(reloads, now, RELOAD_WINDOW_MS),
            recent(&mut self.recreations, now, RELAUNCH_WINDOW_MS),
        );
        match action {
            Action::Reload => reloads.push(now),
            Action::Recreate => self.recreations.push(now),
            Action::Ignore | Action::GiveUp => {}
        }
        action
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_failures_reload_and_browser_exit_recreates_webviews() {
        assert_eq!(decide(FailureKind::RendererFailed, 0, 0), Action::Reload);
        assert_eq!(decide(FailureKind::BrowserExited, 0, 0), Action::Recreate);
        assert_eq!(decide(FailureKind::Other, 0, 0), Action::Ignore);
    }

    #[test]
    fn only_a_dead_main_renderer_reloads() {
        assert_eq!(classify(0).0, FailureKind::BrowserExited);
        assert_eq!(classify(1).0, FailureKind::RendererFailed);
        for recoverable_or_partial in [2, 3, 4, 5, 6, 99] {
            assert_eq!(classify(recoverable_or_partial).0, FailureKind::Other);
        }
    }

    #[test]
    fn budgets_stop_a_crash_loop() {
        assert_eq!(
            decide(FailureKind::RendererFailed, MAX_RELOADS_PER_WINDOW, 0),
            Action::GiveUp
        );
        assert_eq!(
            decide(FailureKind::BrowserExited, 0, MAX_RECREATIONS_PER_WINDOW),
            Action::GiveUp
        );
        // A browser recovery budget does not block a renderer reload, nor the reverse.
        assert_eq!(
            decide(FailureKind::RendererFailed, 0, MAX_RECREATIONS_PER_WINDOW),
            Action::Reload
        );
        assert_eq!(
            decide(FailureKind::BrowserExited, MAX_RELOADS_PER_WINDOW, 0),
            Action::Recreate
        );
    }

    #[test]
    fn history_spends_and_recovers_its_budget() {
        let mut history = History::default();
        for tick in 0..MAX_RELOADS_PER_WINDOW as u64 {
            assert_eq!(
                history.record(FailureKind::RendererFailed, "main", tick),
                Action::Reload
            );
        }
        assert_eq!(
            history.record(FailureKind::RendererFailed, "main", 10),
            Action::GiveUp
        );
        // Another window has its own budget.
        assert_eq!(
            history.record(FailureKind::RendererFailed, "window-2", 10),
            Action::Reload
        );
        // The window slides: old attempts stop counting.
        assert_eq!(
            history.record(FailureKind::RendererFailed, "main", RELOAD_WINDOW_MS + 10),
            Action::Reload
        );
    }

    #[test]
    fn persisted_relaunches_count_after_a_restart() {
        let now = 5 * RELAUNCH_WINDOW_MS;
        let mut history = History::with_relaunches(vec![now - 1_000, now - 2_000]);
        assert_eq!(
            history.record(FailureKind::BrowserExited, "main", now),
            Action::Recreate
        );
        assert!(!history.record_relaunch(now));
        let mut aged = History::with_relaunches(vec![0, 1_000]);
        assert!(aged.record_relaunch(now));
        assert_eq!(aged.relaunches(), &[now]);
    }

    #[test]
    fn browser_recreation_is_bounded_across_window_labels() {
        let mut history = History::default();
        assert_eq!(
            history.record(FailureKind::BrowserExited, "main", 10),
            Action::Recreate
        );
        assert_eq!(
            history.record(FailureKind::BrowserExited, "quick-composer", 20),
            Action::Recreate
        );
        assert_eq!(
            history.record(FailureKind::BrowserExited, "window-1", 30),
            Action::GiveUp
        );
        assert!(history.relaunches().is_empty());
        assert_eq!(
            history.record(FailureKind::BrowserExited, "main", RELAUNCH_WINDOW_MS + 20),
            Action::Recreate
        );
    }
}
