//! Facts about this computer that the device registration sends: name, platform, OS
//! version, app version and channel. Nothing about the user's files or sessions.
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceInfo {
    pub name: String,
    /// windows | macos | linux
    pub platform: &'static str,
    pub os_version: String,
    pub app_version: String,
    /// stable | preview | dev
    pub channel: &'static str,
}

pub(crate) fn channel_for(version: &str, debug_build: bool) -> &'static str {
    if debug_build {
        "dev"
    } else if version.contains("-preview.") {
        "preview"
    } else {
        "stable"
    }
}

fn limited(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

#[cfg(windows)]
fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(unix)]
fn hostname() -> Option<String> {
    let mut buffer = [0u8; 256];
    // SAFETY: the buffer is writable for its full length; gethostname NUL-terminates it
    // within that length or fails.
    let status = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len() - 1) };
    if status != 0 {
        return None;
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    Some(String::from_utf8_lossy(&buffer[..end]).into_owned())
}

#[cfg(windows)]
fn os_version() -> String {
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
    }
    // SAFETY: `info` is zeroed with its size field set, which is all RtlGetVersion needs;
    // it only writes within that struct.
    unsafe {
        let mut info: OSVERSIONINFOW = std::mem::zeroed();
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        if RtlGetVersion(&mut info) == 0 {
            return format!(
                "Windows {}.{}.{}",
                info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
            );
        }
    }
    "Windows".into()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // -- parsed only on macOS; unit tested everywhere.
/// `ProductVersion` out of a macOS `SystemVersion.plist`.
pub(crate) fn parse_macos_plist(plist: &str) -> Option<String> {
    let after = plist.split("<key>ProductVersion</key>").nth(1)?;
    let value = after.split("<string>").nth(1)?.split("</string>").next()?;
    Some(format!("macOS {}", value.trim()))
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))] // -- parsed only on Linux; unit tested everywhere.
/// `PRETTY_NAME` out of `/etc/os-release`.
pub(crate) fn parse_os_release(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .map(|value| value.trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn os_version() -> String {
    std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist")
        .ok()
        .and_then(|plist| parse_macos_plist(&plist))
        .unwrap_or_else(|| "macOS".into())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn os_version() -> String {
    std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|text| parse_os_release(&text))
        .unwrap_or_else(|| "Linux".into())
}

pub(crate) fn current() -> DeviceInfo {
    let version = env!("CARGO_PKG_VERSION");
    DeviceInfo {
        name: hostname()
            .map(|name| limited(&name, 80))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "This computer".into()),
        platform: if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        },
        os_version: limited(&os_version(), 64),
        app_version: limited(version, 32),
        channel: channel_for(version, cfg!(debug_assertions)),
    }
}
