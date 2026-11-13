//! Windows privacy consent from the capability access manager.
//!
//! Windows has no runtime prompt for desktop apps; Settings owns the decision.
//! Screen capture and UI automation have no consent gate, but UIPI blocks input
//! into windows of a higher integrity level, so `elevated` is reported too.

use super::{PermissionId, PermissionState};
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
};

const CONSENT_STORE: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

/// Reads the `Value` string of a consent key; `None` when the key is missing.
fn read_value(root: HKEY, path: &str) -> Option<String> {
    let path = wide(path);
    let name = wide("Value");
    let mut data = [0u16; 64];
    let mut size = std::mem::size_of_val(&data) as u32;
    // SAFETY: every pointer refers to a live, correctly sized local buffer.
    let result = unsafe {
        RegGetValueW(
            root,
            path.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            data.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if result != 0 {
        return None;
    }
    let chars = (size as usize / 2).saturating_sub(1).min(data.len());
    Some(String::from_utf16_lossy(&data[..chars]))
}

/// `global` is the per-user switch, `desktop` the "Let desktop apps access"
/// switch (`NonPackaged`), `policy` the machine-wide value set by policy.
fn mapping(
    global: Option<&str>,
    desktop: Option<&str>,
    policy: Option<&str>,
) -> (PermissionState, Option<&'static str>) {
    match (policy, global, desktop) {
        (Some("Deny"), _, _) => (PermissionState::Restricted, None),
        (_, Some("Deny"), _) => (PermissionState::Denied, None),
        (_, Some("Allow"), Some("Deny")) => (PermissionState::Denied, Some("desktop-apps-off")),
        (_, Some("Allow"), Some("Allow") | None) => (PermissionState::Granted, None),
        _ => (PermissionState::Unknown, None),
    }
}

pub fn status(id: PermissionId) -> (PermissionState, Option<&'static str>) {
    let capability = match id {
        PermissionId::Microphone => "microphone",
        PermissionId::Camera => "webcam",
        PermissionId::ScreenRecording
        | PermissionId::Accessibility
        | PermissionId::FullDiskAccess => return (PermissionState::NotRequired, None),
        // Filled from the toast notifier by the async status command.
        PermissionId::Notifications => return (PermissionState::Unknown, None),
    };
    let path = format!(r"{CONSENT_STORE}\{capability}");
    let global = read_value(HKEY_CURRENT_USER, &path);
    let desktop = read_value(HKEY_CURRENT_USER, &format!(r"{path}\NonPackaged"));
    let policy = read_value(HKEY_LOCAL_MACHINE, &path);
    mapping(global.as_deref(), desktop.as_deref(), policy.as_deref())
}

/// Whether this process token is elevated; `None` when Windows cannot tell.
pub fn elevated() -> Option<bool> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // SAFETY: the token handle is opened, queried into a local struct of the
    // documented size and closed on every path.
    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
        let mut size = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        CloseHandle(token);
        (ok != 0).then_some(elevation.TokenIsElevated != 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_consent_store_values() {
        assert_eq!(
            mapping(Some("Allow"), Some("Deny"), None),
            (PermissionState::Denied, Some("desktop-apps-off"))
        );
        assert_eq!(
            mapping(Some("Allow"), Some("Allow"), None).0,
            PermissionState::Granted
        );
        assert_eq!(
            mapping(Some("Allow"), None, None).0,
            PermissionState::Granted
        );
        assert_eq!(
            mapping(Some("Deny"), Some("Allow"), None).0,
            PermissionState::Denied
        );
        assert_eq!(
            mapping(Some("Allow"), Some("Allow"), Some("Deny")).0,
            PermissionState::Restricted
        );
        assert_eq!(mapping(None, None, None).0, PermissionState::Unknown);
        assert_eq!(
            mapping(Some("Prompt"), None, None).0,
            PermissionState::Unknown
        );
    }

    #[test]
    fn gateless_capabilities_are_not_required() {
        for id in [
            PermissionId::ScreenRecording,
            PermissionId::Accessibility,
            PermissionId::FullDiskAccess,
        ] {
            assert_eq!(status(id).0, PermissionState::NotRequired);
        }
    }
}
