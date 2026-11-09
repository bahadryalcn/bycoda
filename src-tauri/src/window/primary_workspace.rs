//! Which workspace window owns the persisted workspace state, and the event that
//! tells the other workspace windows when that owner changes.
use tauri::{AppHandle, Emitter};

use super::workspace_labels;

/// Window event carrying the new primary label (a plain string payload).
pub const PRIMARY_WORKSPACE_CHANGED: &str = "workspace-primary-changed";

/// Session windows are numbered from a monotonic counter, so a lower number is older.
fn workspace_age(label: &str) -> u64 {
    label
        .strip_prefix("window-")
        .and_then(|id| id.parse::<u64>().ok())
        .unwrap_or(u64::MAX)
}

fn primary_workspace_label_excluding(app: &AppHandle, excluded: Option<&str>) -> Option<String> {
    let labels: Vec<String> = workspace_labels(app)
        .into_iter()
        .filter(|label| Some(label.as_str()) != excluded)
        .collect();
    if labels.iter().any(|label| label == "main") {
        return Some("main".into());
    }
    labels
        .into_iter()
        .min_by_key(|label| (workspace_age(label), label.clone()))
}

/// The window that owns the persisted workspace state: `main` while it exists,
/// otherwise the oldest remaining workspace window.
pub fn primary_workspace_label(app: &AppHandle) -> Option<String> {
    primary_workspace_label_excluding(app, None)
}

pub fn is_primary_workspace(app: &AppHandle, label: &str) -> bool {
    primary_workspace_label(app).as_deref() == Some(label)
}

/// Called after `label` was destroyed: if it held primary ownership, tell the
/// remaining workspace windows who owns the state now.
pub(super) fn announce_after_destroy(app: &AppHandle, label: &str, before: Option<String>) {
    let after = primary_workspace_label_excluding(app, Some(label));
    if before == after {
        return;
    }
    let Some(primary) = after else {
        return;
    };
    for other in workspace_labels(app)
        .into_iter()
        .filter(|other| other.as_str() != label)
    {
        let _ = app.emit_to(other.as_str(), PRIMARY_WORKSPACE_CHANGED, primary.clone());
    }
}
