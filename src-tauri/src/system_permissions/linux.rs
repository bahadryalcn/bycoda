//! Linux has no app-level privacy database. Microphone, camera and screen
//! capture go through PipeWire and xdg-desktop-portal, which ask per request,
//! so there is nothing to read ahead of time.

use super::{PermissionId, PermissionState};

pub fn status(id: PermissionId) -> (PermissionState, Option<&'static str>) {
    match id {
        PermissionId::Accessibility | PermissionId::FullDiskAccess => {
            (PermissionState::NotRequired, None)
        }
        PermissionId::Microphone | PermissionId::Camera | PermissionId::ScreenRecording => {
            (PermissionState::Unknown, Some("portal"))
        }
        // Filled from the notification backend by the async status command.
        PermissionId::Notifications => (PermissionState::Unknown, None),
    }
}
