//! Live, in-memory registry of the editor buffers each window has open.
//!
//! Nothing here is persisted: a window replaces its list on every report and
//! the list is dropped when the window reloads or is destroyed. A window that
//! has not reported yet counts as having no open editor (never "unknown");
//! local editor drafts are the safety net for that gap.
use super::BufferState;
use crate::session_store::project_path_key;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub(crate) struct EditorBuffers {
    windows: Mutex<HashMap<String, Vec<BufferState>>>,
}

/// One buffer of one window, as returned by [`EditorBuffers::snapshot`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OpenBuffer {
    pub(crate) window: String,
    pub(crate) path: String,
    pub(crate) dirty: bool,
}

impl EditorBuffers {
    fn windows(&self) -> std::sync::MutexGuard<'_, HashMap<String, Vec<BufferState>>> {
        // A poisoned lock still holds a consistent map: every write is one insert/remove.
        self.windows.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Replaces the whole list of `window`; an empty report clears it.
    pub(crate) fn report(&self, window: &str, buffers: &[BufferState]) {
        let mut windows = self.windows();
        if buffers.is_empty() {
            windows.remove(window);
        } else {
            windows.insert(window.to_owned(), buffers.to_vec());
        }
    }

    pub(crate) fn clear(&self, window: &str) {
        self.windows().remove(window);
    }

    /// Dirty buffer paths equal to or inside `path`, sorted and de-duplicated.
    pub(crate) fn dirty_under(&self, path: &str) -> Vec<String> {
        let root = project_path_key(path);
        let mut found: Vec<String> = self
            .windows()
            .values()
            .flatten()
            .filter(|buffer| buffer.dirty && is_within(&root, &project_path_key(&buffer.path)))
            .map(|buffer| buffer.path.clone())
            .collect();
        found.sort();
        found.dedup();
        found
    }

    /// Every reported buffer, ordered by window then path.
    pub(crate) fn snapshot(&self) -> Vec<OpenBuffer> {
        self.with_snapshot(std::convert::identity)
    }

    /// Keep reports and window clears serialized with a commit using this snapshot.
    pub(crate) fn with_snapshot<T>(&self, use_snapshot: impl FnOnce(Vec<OpenBuffer>) -> T) -> T {
        let windows = self.windows();
        let mut all: Vec<OpenBuffer> = windows
            .iter()
            .flat_map(|(window, buffers)| {
                buffers.iter().map(|buffer| OpenBuffer {
                    window: window.clone(),
                    path: buffer.path.clone(),
                    dirty: buffer.dirty,
                })
            })
            .collect();
        all.sort_unstable_by(|a, b| {
            (&a.window, &a.path, a.dirty).cmp(&(&b.window, &b.path, b.dirty))
        });
        let result = use_snapshot(all);
        drop(windows);
        result
    }
}

/// Both arguments are `project_path_key` forms (no trailing slash).
fn is_within(root: &str, candidate: &str) -> bool {
    if candidate == root {
        return true;
    }
    let prefix = if root.ends_with('/') {
        root.to_owned()
    } else {
        format!("{root}/")
    };
    candidate.starts_with(&prefix)
}

#[cfg(test)]
#[path = "editor_buffers_tests.rs"]
mod tests;
