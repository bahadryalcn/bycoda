//! macOS TCC reads and prompts.
//!
//! Reads use the preflight APIs, which never prompt. Prompts run only from
//! `request`, after an explicit owner click. TCC keys grants on the code
//! signature, so ad-hoc builds lose them after an update (see `signing`).

use super::{PermissionId, PermissionState, RESTART_REQUIRED};
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::NSString;
use std::ffi::c_void;
use std::sync::mpsc;
use std::time::Duration;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const AnyObject;
}

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {
    static AVMediaTypeAudio: *const AnyObject;
    static AVMediaTypeVideo: *const AnyObject;
}

/// How long `request` waits for the owner to answer a capture prompt.
const PROMPT_DEADLINE: Duration = Duration::from_secs(60);

pub fn screen_granted() -> bool {
    // SAFETY: takes no arguments and only reads this process's TCC grant.
    unsafe { CGPreflightScreenCaptureAccess() }
}

fn accessibility_granted() -> bool {
    // SAFETY: takes no arguments and only reads this process's trust.
    unsafe { AXIsProcessTrusted() }
}

fn media_type(id: PermissionId) -> Option<*const AnyObject> {
    // SAFETY: AVFoundation exports these NSString constants for the process lifetime.
    unsafe {
        match id {
            PermissionId::Microphone => Some(AVMediaTypeAudio),
            PermissionId::Camera => Some(AVMediaTypeVideo),
            _ => None,
        }
    }
}

fn capture_device() -> Option<&'static AnyClass> {
    AnyClass::get(c"AVCaptureDevice")
}

/// AVAuthorizationStatus: 0 not determined, 1 restricted, 2 denied, 3 authorized.
fn map_av_status(status: isize) -> PermissionState {
    match status {
        0 => PermissionState::NotDetermined,
        1 => PermissionState::Restricted,
        2 => PermissionState::Denied,
        3 => PermissionState::Granted,
        _ => PermissionState::Unknown,
    }
}

fn capture_status(id: PermissionId) -> PermissionState {
    let (Some(class), Some(media)) = (capture_device(), media_type(id)) else {
        return PermissionState::Unknown;
    };
    // SAFETY: class method with one NSString argument, returning NSInteger.
    let status: isize = unsafe { msg_send![class, authorizationStatusForMediaType: media] };
    map_av_status(status)
}

/// Screen Recording and Accessibility have no "not asked yet" read, so a
/// missing grant reads as not determined until this launch has prompted once.
fn ungranted(prompted: bool) -> PermissionState {
    if prompted {
        PermissionState::Denied
    } else {
        PermissionState::NotDetermined
    }
}

static SCREEN_PROMPTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static AX_PROMPTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn prompted(flag: &std::sync::atomic::AtomicBool) -> bool {
    flag.load(std::sync::atomic::Ordering::SeqCst)
}

/// The system TCC database: present on every install, readable only with Full
/// Disk Access.
const SYSTEM_TCC_DB: &str = "/Library/Application Support/com.apple.TCC/TCC.db";
/// `auth_value` System Settings stores for a switched-on grant.
const TCC_ALLOWED: i64 = 2;

/// TCC offers no read for Full Disk Access, so opening a file it guards
/// answers instead. A missing file or any other error proves nothing.
fn full_disk_access() -> PermissionState {
    file_access_state(std::fs::File::open(SYSTEM_TCC_DB).map(drop))
}

fn file_access_state(opened: std::io::Result<()>) -> PermissionState {
    match opened {
        Ok(()) => PermissionState::Granted,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            PermissionState::Denied
        }
        Err(_) => PermissionState::Unknown,
    }
}

fn bundle_identifier() -> Option<String> {
    let class = AnyClass::get(c"NSBundle")?;
    objc2::rc::autoreleasepool(|_| unsafe {
        // SAFETY: class and instance methods without arguments; the returned
        // NSString is autoreleased into this pool and copied before it drains.
        let bundle: *mut AnyObject = msg_send![class, mainBundle];
        if bundle.is_null() {
            return None;
        }
        let id: *mut NSString = msg_send![bundle, bundleIdentifier];
        id.as_ref().map(|id| id.to_string())
    })
}

/// System Settings stores a Screen Recording grant at once, but this process
/// keeps its launch-time answer until it restarts. With Full Disk Access the
/// system TCC database shows the stored switch, so the owner learns a restart
/// applies it instead of seeing "not requested".
fn screen_allowed_in_settings() -> bool {
    use rusqlite::{Connection, OpenFlags};
    let Some(client) = bundle_identifier() else {
        return false;
    };
    let read_only = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    // The live file first; `immutable` reads it without the WAL index this
    // process may not be allowed to create.
    let connection = Connection::open_with_flags(SYSTEM_TCC_DB, read_only).or_else(|_| {
        Connection::open_with_flags(
            format!("file:{SYSTEM_TCC_DB}?immutable=1"),
            read_only | OpenFlags::SQLITE_OPEN_URI,
        )
    });
    let Ok(connection) = connection else {
        return false;
    };
    let _ = connection.busy_timeout(Duration::from_millis(200));
    connection
        .query_row(
            "SELECT auth_value FROM access WHERE service = 'kTCCServiceScreenCapture' AND client = ?1",
            [client],
            |row| row.get::<_, i64>(0),
        )
        .is_ok_and(|value| value == TCC_ALLOWED)
}

pub fn status(id: PermissionId) -> (PermissionState, Option<&'static str>) {
    let state = match id {
        PermissionId::Microphone | PermissionId::Camera => capture_status(id),
        PermissionId::ScreenRecording if screen_granted() => PermissionState::Granted,
        // Never granted for this process: capture fails until it restarts.
        PermissionId::ScreenRecording if screen_allowed_in_settings() => {
            return (PermissionState::Denied, Some(RESTART_REQUIRED));
        }
        PermissionId::ScreenRecording => ungranted(prompted(&SCREEN_PROMPTED)),
        PermissionId::Accessibility if accessibility_granted() => PermissionState::Granted,
        PermissionId::Accessibility => ungranted(prompted(&AX_PROMPTED)),
        PermissionId::FullDiskAccess => full_disk_access(),
        // Filled from UNUserNotificationCenter by the async status command.
        PermissionId::Notifications => PermissionState::Unknown,
    };
    (state, None)
}

/// Marks that this launch already showed the Screen Recording prompt.
/// macOS shows it once per process; later attempts go to System Settings.
pub fn note_screen_prompted() -> bool {
    SCREEN_PROMPTED.swap(true, std::sync::atomic::Ordering::SeqCst)
}

fn request_capture(id: PermissionId) -> PermissionState {
    let (Some(class), Some(media)) = (capture_device(), media_type(id)) else {
        return PermissionState::Unknown;
    };
    if capture_status(id) != PermissionState::NotDetermined {
        return capture_status(id);
    }
    let (sender, receiver) = mpsc::channel::<bool>();
    let handler = block2::RcBlock::new(move |granted: Bool| {
        let _ = sender.send(granted.as_bool());
    });
    // SAFETY: AVFoundation copies the completion block and calls it once on an
    // arbitrary queue; the block only sends on a channel.
    unsafe {
        let _: () = msg_send![
            class,
            requestAccessForMediaType: media,
            completionHandler: &*handler
        ];
    }
    match receiver.recv_timeout(PROMPT_DEADLINE) {
        Ok(_) => capture_status(id),
        Err(_) => PermissionState::NotDetermined,
    }
}

fn request_accessibility() -> PermissionState {
    AX_PROMPTED.store(true, std::sync::atomic::Ordering::SeqCst);
    let Some(dictionary) = AnyClass::get(c"NSDictionary") else {
        return status(PermissionId::Accessibility).0;
    };
    let Some(number) = AnyClass::get(c"NSNumber") else {
        return status(PermissionId::Accessibility).0;
    };
    // SAFETY: builds an autoreleased NSDictionary { prompt: YES }, which is
    // toll-free bridged to the CFDictionary AXIsProcessTrustedWithOptions reads.
    let trusted = objc2::rc::autoreleasepool(|_| unsafe {
        let yes: *mut AnyObject = msg_send![number, numberWithBool: Bool::YES];
        let options: *mut AnyObject = msg_send![
            dictionary,
            dictionaryWithObject: yes,
            forKey: kAXTrustedCheckOptionPrompt
        ];
        AXIsProcessTrustedWithOptions(options as *const c_void)
    });
    if trusted {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

fn request_screen() -> PermissionState {
    if screen_granted() {
        return PermissionState::Granted;
    }
    if !note_screen_prompted() {
        // SAFETY: takes no arguments; shows the system prompt at most once.
        let _ = unsafe { CGRequestScreenCaptureAccess() };
    }
    if screen_granted() {
        PermissionState::Granted
    } else {
        PermissionState::Denied
    }
}

/// Shows the OS prompt for `id` when one exists and returns the new reading.
pub fn request(id: PermissionId) -> (PermissionState, Option<&'static str>) {
    let state = match id {
        PermissionId::Microphone | PermissionId::Camera => request_capture(id),
        PermissionId::ScreenRecording => request_screen(),
        PermissionId::Accessibility => request_accessibility(),
        PermissionId::FullDiskAccess | PermissionId::Notifications => return status(id),
    };
    (state, None)
}

/// Finds the installed bundle containing the running executable.
fn bundle_path(executable: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    is_bundle.then(|| bundle.to_path_buf())
}

pub(super) fn running_app_bundle() -> Result<std::path::PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    bundle_path(&executable).ok_or_else(|| "bycoda is not running from an app bundle.".to_string())
}

/// Selects the installed app in Finder without changing its permissions.
pub fn reveal_app() -> Result<(), String> {
    let bundle = running_app_bundle()?;
    let workspace =
        AnyClass::get(c"NSWorkspace").ok_or_else(|| "Finder is unavailable.".to_string())?;
    let revealed = objc2::rc::autoreleasepool(|_| unsafe {
        // SAFETY: NSWorkspace class and instance methods with NSString
        // arguments that live until the call returns.
        let path = NSString::from_str(&bundle.to_string_lossy());
        let root = NSString::from_str("");
        let shared: *mut AnyObject = msg_send![workspace, sharedWorkspace];
        let ok: Bool = msg_send![shared, selectFile: &*path, inFileViewerRootedAtPath: &*root];
        ok.as_bool()
    });
    if revealed {
        Ok(())
    } else {
        Err("Could not reveal bycoda in Finder.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_av_authorization_status() {
        assert_eq!(map_av_status(0), PermissionState::NotDetermined);
        assert_eq!(map_av_status(1), PermissionState::Restricted);
        assert_eq!(map_av_status(2), PermissionState::Denied);
        assert_eq!(map_av_status(3), PermissionState::Granted);
        assert_eq!(map_av_status(9), PermissionState::Unknown);
    }

    #[test]
    fn full_disk_access_reads_only_a_refused_open_as_denied() {
        use std::io::{Error, ErrorKind};
        assert_eq!(file_access_state(Ok(())), PermissionState::Granted);
        assert_eq!(
            file_access_state(Err(Error::from(ErrorKind::PermissionDenied))),
            PermissionState::Denied
        );
        assert_eq!(
            file_access_state(Err(Error::from(ErrorKind::NotFound))),
            PermissionState::Unknown
        );
    }

    #[test]
    fn missing_grant_is_denied_only_after_a_prompt() {
        assert_eq!(ungranted(false), PermissionState::NotDetermined);
        assert_eq!(ungranted(true), PermissionState::Denied);
    }

    #[test]
    fn finds_the_app_bundle_of_the_executable() {
        assert_eq!(
            bundle_path(std::path::Path::new(
                "/Applications/bycoda.app/Contents/MacOS/bycoda"
            )),
            Some(std::path::Path::new("/Applications/bycoda.app").to_path_buf())
        );
        assert_eq!(
            bundle_path(std::path::Path::new("/usr/local/bin/bycoda")),
            None
        );
        assert_eq!(
            bundle_path(std::path::Path::new("/tmp/Contents/MacOS/bycoda")),
            None
        );
    }
}
