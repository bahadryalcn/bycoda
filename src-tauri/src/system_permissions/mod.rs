//! One place that reads and requests the OS privacy permissions bycoda uses.
//!
//! Reading never prompts. `system_permission_request` is the only path that may
//! show an OS prompt, and only after an explicit owner click. A state that
//! cannot be read is reported as `Unknown`, never as granted.

use serde::{Deserialize, Serialize};

pub mod helper_window;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
pub mod webview_permissions;
#[cfg(target_os = "windows")]
mod windows;

/// Emitted to the main window and the helper with a full report on change.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const CHANGED_EVENT: &str = "system-permissions-changed";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionId {
    Microphone,
    Camera,
    ScreenRecording,
    Accessibility,
    Notifications,
    FullDiskAccess,
}

const ALL: [PermissionId; 6] = [
    PermissionId::Microphone,
    PermissionId::Camera,
    PermissionId::ScreenRecording,
    PermissionId::Accessibility,
    PermissionId::Notifications,
    PermissionId::FullDiskAccess,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
    /// Policy, MDM or group policy blocks it; the owner cannot switch it on.
    Restricted,
    /// This OS has no gate for the capability.
    NotRequired,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEntry {
    pub id: PermissionId,
    pub state: PermissionState,
    /// An in-app OS prompt exists right now.
    pub can_request: bool,
    /// An allowlisted settings pane exists on this OS.
    pub can_open_settings: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPermissionsReport {
    pub version: u8,
    pub platform: &'static str,
    pub entries: Vec<PermissionEntry>,
    /// macOS: "ad-hoc" builds change identity on every update and lose grants.
    pub signing: &'static str,
    /// Windows: the process token is elevated (UIPI applies to other apps).
    pub elevated: Option<bool>,
}

type Reading = (PermissionState, Option<&'static str>);

fn read(id: PermissionId) -> Reading {
    #[cfg(target_os = "windows")]
    return windows::status(id);
    #[cfg(target_os = "macos")]
    return macos::status(id);
    #[cfg(target_os = "linux")]
    return linux::status(id);
    #[allow(unreachable_code)]
    (PermissionState::Unknown, None)
}

fn make_entry(id: PermissionId, (state, detail): Reading) -> PermissionEntry {
    PermissionEntry {
        id,
        state,
        can_request: cfg!(target_os = "macos") && state == PermissionState::NotDetermined,
        can_open_settings: settings_pane_exists(id),
        detail: detail.map(str::to_owned),
    }
}

/// Mirrors the allowlist in `privacy_settings::pane_url`.
fn settings_pane_exists(id: PermissionId) -> bool {
    let pane = pane_name(id);
    crate::privacy_settings::pane_supported(pane, std::env::consts::OS)
}

pub(crate) fn pane_name(id: PermissionId) -> &'static str {
    match id {
        PermissionId::Microphone => "microphone",
        PermissionId::Camera => "camera",
        PermissionId::ScreenRecording => "screen-recording",
        PermissionId::Accessibility => "accessibility",
        PermissionId::Notifications => "notifications",
        PermissionId::FullDiskAccess => "full-disk-access",
    }
}

/// Synchronous read of one permission. Notifications stay `Unknown` here; the
/// async command fills them from the notification centre.
pub fn entry(id: PermissionId) -> PermissionEntry {
    make_entry(id, read(id))
}

pub fn status_report() -> SystemPermissionsReport {
    #[cfg(target_os = "windows")]
    let elevated = windows::elevated();
    #[cfg(not(target_os = "windows"))]
    let elevated = None;
    SystemPermissionsReport {
        version: 1,
        platform: platform(),
        entries: ALL.into_iter().map(entry).collect(),
        signing: signing(),
        elevated,
    }
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// The local update and release builds pass the identity to `tauri build`,
/// which also compiles this crate, so the build-time env is the bundle identity.
fn signing() -> &'static str {
    if !cfg!(target_os = "macos") {
        return "unknown";
    }
    signing_from(
        option_env!("BYCODA_MACOS_SIGNING_IDENTITY"),
        option_env!("APPLE_SIGNING_IDENTITY"),
    )
}

fn signing_from(local: Option<&str>, release: Option<&str>) -> &'static str {
    let named =
        |value: Option<&str>| value.is_some_and(|v| !v.trim().is_empty() && v.trim() != "-");
    if named(local) || named(release) {
        "stable"
    } else {
        "ad-hoc"
    }
}

fn notification_state(value: crate::notifications::Permission) -> PermissionState {
    use crate::notifications::Permission;
    match value {
        Permission::Prompt => PermissionState::NotDetermined,
        Permission::Granted => PermissionState::Granted,
        Permission::Denied => PermissionState::Denied,
        Permission::Unsupported => PermissionState::Unknown,
    }
}

fn notification_entry(state: PermissionState) -> PermissionEntry {
    let mut item = make_entry(PermissionId::Notifications, (state, None));
    // macOS shows its own prompt once; Windows and Linux have none.
    item.can_request = cfg!(target_os = "macos") && state == PermissionState::NotDetermined;
    item
}

#[tauri::command(async)]
pub async fn system_permissions_status(
    app: tauri::AppHandle,
) -> Result<SystemPermissionsReport, String> {
    let mut report = tauri::async_runtime::spawn_blocking(status_report)
        .await
        .map_err(|error| error.to_string())?;
    let notifications =
        notification_state(crate::notifications::notification_permission(app).await);
    if let Some(item) = report
        .entries
        .iter_mut()
        .find(|item| item.id == PermissionId::Notifications)
    {
        *item = notification_entry(notifications);
    }
    Ok(report)
}

/// Shows the OS prompt when one exists; otherwise returns the current entry.
#[tauri::command(async)]
pub async fn system_permission_request(
    app: tauri::AppHandle,
    id: PermissionId,
) -> Result<PermissionEntry, String> {
    if id == PermissionId::Notifications {
        let state =
            notification_state(crate::notifications::request_notification_permission(app).await);
        return Ok(notification_entry(state));
    }
    #[cfg(target_os = "macos")]
    {
        let reading = tauri::async_runtime::spawn_blocking(move || macos::request(id))
            .await
            .map_err(|error| error.to_string())?;
        return Ok(make_entry(id, reading));
    }
    #[allow(unreachable_code)]
    Ok(entry(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_contract_casing() {
        let item = make_entry(
            PermissionId::ScreenRecording,
            (PermissionState::NotDetermined, None),
        );
        let json = serde_json::to_value(item).unwrap();
        assert_eq!(json["id"], "screen-recording");
        assert_eq!(json["state"], "not-determined");
        assert!(json.get("canOpenSettings").is_some());
        assert!(json.get("detail").is_none());
    }

    #[test]
    fn ad_hoc_unless_a_named_identity_was_built_in() {
        assert_eq!(signing_from(None, None), "ad-hoc");
        assert_eq!(signing_from(Some("-"), None), "ad-hoc");
        assert_eq!(signing_from(Some("  "), None), "ad-hoc");
        assert_eq!(
            signing_from(None, Some("Developer ID Application: A (T)")),
            "stable"
        );
        assert_eq!(signing_from(Some("bycoda local"), None), "stable");
    }

    #[test]
    fn report_lists_every_permission_once() {
        let report = status_report();
        assert_eq!(report.entries.len(), ALL.len());
        for id in ALL {
            assert_eq!(report.entries.iter().filter(|e| e.id == id).count(), 1);
        }
    }
}
