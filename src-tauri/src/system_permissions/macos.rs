//! macOS TCC reads and prompts.
//!
//! Reads use the preflight APIs, which never prompt. Prompts run only from
//! `request`, after an explicit owner click. TCC keys grants on the code
//! signature, so ad-hoc builds lose them after an update (see `signing`).

use super::{PermissionId, PermissionState};
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Bool};
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

pub fn status(id: PermissionId) -> (PermissionState, Option<&'static str>) {
    let state = match id {
        PermissionId::Microphone | PermissionId::Camera => capture_status(id),
        PermissionId::ScreenRecording if screen_granted() => PermissionState::Granted,
        PermissionId::ScreenRecording => ungranted(prompted(&SCREEN_PROMPTED)),
        PermissionId::Accessibility if accessibility_granted() => PermissionState::Granted,
        PermissionId::Accessibility => ungranted(prompted(&AX_PROMPTED)),
        // TCC offers no read for Full Disk Access; never claim it.
        PermissionId::FullDiskAccess => PermissionState::Unknown,
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
    fn missing_grant_is_denied_only_after_a_prompt() {
        assert_eq!(ungranted(false), PermissionState::NotDetermined);
        assert_eq!(ungranted(true), PermissionState::Denied);
    }
}
