use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{LazyLock, Mutex};
use tauri::utils::config::WindowConfig;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Manager, PhysicalPosition, Webview};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct BrowserView {
    pub(super) pid: u32,
    instance: Uuid,
}

#[derive(Default)]
struct Registry {
    configs: HashMap<String, WindowConfig>,
    views: HashMap<String, BrowserView>,
    waiting: HashMap<u32, BrowserView>,
}

impl Registry {
    fn active(&self, label: &str, view: BrowserView) -> bool {
        self.views.get(label) == Some(&view)
    }

    fn wait_for_exit(&mut self, label: &str, view: BrowserView) -> bool {
        if !self.active(label, view) || self.waiting.contains_key(&view.pid) {
            return false;
        }
        self.waiting.insert(view.pid, view);
        true
    }

    fn forget(&mut self, label: &str) {
        self.configs.remove(label);
        if let Some(view) = self.views.remove(label) {
            if !self
                .views
                .values()
                .any(|registered| registered.pid == view.pid)
            {
                self.waiting.remove(&view.pid);
            }
        }
    }

    fn take_failed_group(&mut self, label: &str, view: BrowserView, exited: bool) -> Vec<String> {
        let matches = if exited {
            self.active(label, view)
        } else {
            self.waiting.get(&view.pid) == Some(&view)
        };
        if !matches {
            return Vec::new();
        }
        self.waiting.remove(&view.pid);
        let mut labels = Vec::new();
        self.views.retain(|label, registered| {
            if registered.pid != view.pid {
                return true;
            }
            labels.push(label.clone());
            false
        });
        labels.sort_unstable();
        labels
    }
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));
static REBUILDING: AtomicUsize = AtomicUsize::new(0);

pub(super) fn is_rebuilding() -> bool {
    REBUILDING.load(Ordering::Acquire) != 0
}

/// Keep the native quit poll from seeing a temporarily empty workspace.
pub(super) struct RebuildGuard;

impl RebuildGuard {
    pub(super) fn begin() -> Self {
        REBUILDING.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

impl Drop for RebuildGuard {
    fn drop(&mut self) {
        REBUILDING.fetch_sub(1, Ordering::AcqRel);
    }
}

fn registry() -> std::sync::MutexGuard<'static, Registry> {
    REGISTRY.lock().unwrap_or_else(|error| error.into_inner())
}

pub(super) fn remember_config(config: &WindowConfig) {
    registry()
        .configs
        .insert(config.label.clone(), config.clone());
}

pub(super) fn forget(label: &str) {
    registry().forget(label);
}

pub(super) fn register(label: &str, pid: u32) -> BrowserView {
    let view = BrowserView {
        pid,
        instance: Uuid::new_v4(),
    };
    registry().views.insert(label.to_owned(), view);
    view
}

pub(super) fn active(label: &str, view: BrowserView) -> bool {
    registry().active(label, view)
}

pub(super) fn wait_for_exit(label: &str, view: BrowserView) -> bool {
    registry().wait_for_exit(label, view)
}

pub(super) fn take_failed_group(label: &str, view: BrowserView, exited: bool) -> Vec<String> {
    registry().take_failed_group(label, view, exited)
}

pub(super) struct Replacement {
    dead: Webview,
    config: WindowConfig,
}

/// Run on the event loop after the browser exit callback returns. Close all
/// controllers before creating a new environment for their shared profile.
pub(super) fn close_failed_views(
    app: &AppHandle,
    labels: &[String],
) -> Result<Vec<Replacement>, String> {
    let replacements = {
        let registry = registry();
        labels
            .iter()
            .filter_map(|label| {
                let dead = app.get_webview(label)?;
                let config = registry.configs.get(label).or_else(|| {
                    app.config()
                        .app
                        .windows
                        .iter()
                        .find(|config| config.label == *label)
                });
                Some(
                    config
                        .cloned()
                        .map(|config| Replacement { dead, config })
                        .ok_or_else(|| format!("missing recovery configuration for {label}")),
                )
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    for replacement in &replacements {
        replacement
            .dead
            .close()
            .map_err(|error| error.to_string())?;
    }
    Ok(replacements)
}

/// Tauri's Windows webview builder must be called from outside an event handler.
pub(super) fn rebuild(replacements: Vec<Replacement>) -> Result<usize, String> {
    let count = replacements.len();
    let mut failure = None;
    for replacement in replacements {
        let label = replacement.config.label.clone();
        if let Err(error) = replacement.build() {
            log::error!("webview {label}: could not recreate controller: {error}");
            failure = Some(error);
        }
    }
    failure.map_or(Ok(count), |error| Err(error.to_string()))
}

impl Replacement {
    fn build(mut self) -> tauri::Result<()> {
        let window = self.dead.window();
        let focused = window.is_focused().unwrap_or(false);
        let mut size = window.inner_size()?;
        size.width = size.width.max(1);
        size.height = size.height.max(1);
        self.config.focus = false;
        let child = window.add_child(
            WebviewBuilder::from_config(&self.config).auto_resize(),
            PhysicalPosition::new(0, 0),
            size,
        )?;
        if focused {
            let _ = child.set_focus();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(pid: u32) -> BrowserView {
        BrowserView {
            pid,
            instance: Uuid::new_v4(),
        }
    }

    #[test]
    fn one_failure_retires_its_entire_group_and_leaves_other_browsers_alive() {
        let mut registry = Registry::default();
        let main = view(10);
        let popup = view(10);
        let other = view(20);
        registry.views.insert("main".into(), main);
        registry.views.insert("popup".into(), popup);
        registry.views.insert("other".into(), other);
        assert!(registry.wait_for_exit("main", main));
        assert!(!registry.wait_for_exit("popup", popup));
        assert_eq!(
            registry.take_failed_group("popup", popup, true),
            ["main", "popup"]
        );
        assert!(registry.take_failed_group("main", main, false).is_empty());
        assert!(registry.active("other", other));
    }

    #[test]
    fn stale_exit_cannot_retire_a_replacement_with_the_same_label_and_pid() {
        let mut registry = Registry::default();
        let first = view(10);
        let next = view(10);
        registry.views.insert("main".into(), first);
        assert!(registry.wait_for_exit("main", first));
        registry.forget("main");
        registry.views.insert("main".into(), next);
        assert!(registry.take_failed_group("main", first, true).is_empty());
        assert!(registry.wait_for_exit("main", next));
        assert_eq!(registry.take_failed_group("main", next, true), ["main"]);
    }

    #[test]
    fn timeout_still_covers_the_group_when_the_first_window_closes() {
        let mut registry = Registry::default();
        let main = view(10);
        registry.views.insert("main".into(), main);
        registry.views.insert("popup".into(), view(10));
        assert!(registry.wait_for_exit("main", main));
        registry.forget("main");
        assert_eq!(registry.take_failed_group("main", main, false), ["popup"]);
    }

    #[test]
    fn native_quit_stays_guarded_until_all_replacements_settle() {
        let first = RebuildGuard::begin();
        let second = RebuildGuard::begin();
        drop(first);
        assert!(is_rebuilding());
        drop(second);
        assert!(!is_rebuilding());
    }
}
