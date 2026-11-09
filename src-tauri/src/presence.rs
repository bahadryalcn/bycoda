//! Read-only presence for the voice lifecycle. This never opens a microphone or
//! changes session state. Query the caller's Windows session, not the console
//! session, so a disconnected remote desktop cannot appear present.

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPresence {
    idle_ms: u64,
    locked: bool,
    supported: bool,
}

#[tauri::command]
pub fn get_user_presence() -> Result<UserPresence, String> {
    platform_presence()
}

#[cfg(not(windows))]
fn platform_presence() -> Result<UserPresence, String> {
    Ok(UserPresence {
        idle_ms: 0,
        locked: false,
        supported: false,
    })
}

#[cfg(windows)]
fn platform_presence() -> Result<UserPresence, String> {
    use std::{mem::size_of, ptr};
    use windows_sys::Win32::{
        System::{
            RemoteDesktop::{
                ProcessIdToSessionId, WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx,
                WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE,
            },
            SystemInformation::GetTickCount,
            Threading::GetCurrentProcessId,
        },
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };

    let native_error = |operation| format!("{operation}: {}", std::io::Error::last_os_error());
    let mut input = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: input is a correctly sized writable Win32 structure.
    if unsafe { GetLastInputInfo(&mut input) } == 0 {
        return Err(native_error("GetLastInputInfo"));
    }
    // Both clocks are milliseconds since boot in the same wrapping u32 domain.
    let idle_ms = elapsed_input_ms(unsafe { GetTickCount() }, input.dwTime);
    let mut session_id = 0;
    // SAFETY: querying our own process with a valid output pointer.
    if unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session_id) } == 0 {
        return Err(native_error("ProcessIdToSessionId"));
    }
    let mut buffer = ptr::null_mut();
    let mut bytes = 0;
    // A snapshot includes initial lock state and avoids a window event hook and
    // its registration lifetime. Polling callers observe unlock on the next read.
    // SAFETY: all output pointers are valid; the OS allocates buffer on success.
    if unsafe {
        WTSQuerySessionInformationW(
            WTS_CURRENT_SERVER_HANDLE,
            session_id,
            WTSSessionInfoEx,
            &mut buffer,
            &mut bytes,
        )
    } == 0
    {
        return Err(native_error("WTSQuerySessionInformationW"));
    }
    let info = if !buffer.is_null() && bytes as usize >= size_of::<WTSINFOEXW>() {
        // SAFETY: size checked above; unaligned read avoids assuming alignment
        // of the API's generic string-typed allocation.
        Some(unsafe { ptr::read_unaligned(buffer.cast::<WTSINFOEXW>()) })
    } else {
        None
    };
    // SAFETY: release the allocation with its owning API on every success path.
    unsafe { WTSFreeMemory(buffer.cast()) };
    let info = info.ok_or("Windows returned incomplete session presence")?;
    if info.Level != 1 {
        return Err("Windows returned an unsupported session presence level".to_owned());
    }
    // SAFETY: Level 1 identifies this union member.
    let session = unsafe { info.Data.WTSInfoExLevel1 };
    let locked = session_unavailable(session.SessionState, session.SessionFlags)
        .ok_or("Windows session lock state is unknown")?;
    Ok(UserPresence {
        idle_ms,
        locked,
        supported: true,
    })
}

#[cfg(any(windows, test))]
fn elapsed_input_ms(now: u32, last_input: u32) -> u64 {
    u64::from(now.wrapping_sub(last_input))
}

#[cfg(any(windows, test))]
fn session_unavailable(state: i32, flags: i32) -> Option<bool> {
    // WTSActive = 0, WTS_SESSIONSTATE_LOCK = 0, UNLOCK = 1 (Windows 8+).
    // Tauri's supported Windows versions do not include Windows 7, where the
    // documented flag values were reversed. Unknown is never treated as active.
    match flags {
        0 => Some(true),
        1 => Some(state != 0),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_clock_survives_tick_wrap() {
        assert_eq!(elapsed_input_ms(1000, 800), 200);
        assert_eq!(elapsed_input_ms(20, u32::MAX - 79), 100);
    }

    #[test]
    fn only_active_unlocked_sessions_are_available() {
        assert_eq!(session_unavailable(0, 1), Some(false));
        assert_eq!(session_unavailable(0, 0), Some(true));
        assert_eq!(session_unavailable(4, 1), Some(true)); // WTSDisconnected
        assert_eq!(session_unavailable(0, -1), None);
    }

    #[test]
    fn wire_fields_are_camel_case() {
        let value = serde_json::to_value(UserPresence {
            idle_ms: 1234,
            locked: true,
            supported: true,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "idleMs": 1234, "locked": true, "supported": true })
        );
    }
}
