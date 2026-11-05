//! Bounded mechanical Windows process identity lookup. No signaling authority.
use napi_derive::napi;

#[napi(object)]
pub struct WindowsProcessBirth {
    pub pid: u32,
    pub state: String,
    pub started_at: Option<String>,
}

#[napi]
pub fn windows_process_births(pids: Vec<u32>) -> napi::Result<Vec<WindowsProcessBirth>> {
    if pids.len() > 4096 || pids.iter().any(|pid| *pid == 0) {
        return Err(napi::Error::from_reason("Invalid Windows process identity batch"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::Foundation::{GetLastError, ERROR_INVALID_PARAMETER, FILETIME, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        Ok(pids.into_iter().map(|pid| {
            let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
            if handle.is_null() {
                let state = if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER { "missing" } else { "unknown" };
                return WindowsProcessBirth { pid, state: state.into(), started_at: None };
            }
            let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
            let mut exit = 0;
            let mut created = FILETIME::default();
            let mut exited = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            if unsafe { GetExitCodeProcess(handle.as_raw_handle() as _, &mut exit) } == 0 {
                return WindowsProcessBirth { pid, state: "unknown".into(), started_at: None };
            }
            if exit != STILL_ACTIVE as u32 {
                return WindowsProcessBirth { pid, state: "missing".into(), started_at: None };
            }
            if unsafe { GetProcessTimes(handle.as_raw_handle() as _, &mut created, &mut exited, &mut kernel, &mut user) } == 0 {
                return WindowsProcessBirth { pid, state: "unknown".into(), started_at: None };
            }
            let filetime = ((created.dwHighDateTime as u64) << 32) | u64::from(created.dwLowDateTime);
            let Some(ticks) = filetime.checked_add(504_911_232_000_000_000) else {
                return WindowsProcessBirth { pid, state: "unknown".into(), started_at: None };
            };
            WindowsProcessBirth { pid, state: "alive".into(), started_at: Some(ticks.to_string()) }
        }).collect())
    }
    #[cfg(not(windows))]
    { let _ = pids; Err(napi::Error::from_reason("Windows process identities are unavailable")) }
}
#[napi(object)]
pub struct WindowsListener {
    pub pid: u32,
    pub address: String,
    pub port: u32,
}

#[napi]
pub fn windows_listeners() -> napi::Result<Vec<WindowsListener>> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
        use windows_sys::Win32::NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCP6ROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER};
        use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};
        let mut result = Vec::new();
        for family in [AF_INET, AF_INET6] {
            let mut bytes = 0u32;
            let status = unsafe { GetExtendedTcpTable(std::ptr::null_mut(), &mut bytes, 0, family as u32, TCP_TABLE_OWNER_PID_LISTENER, 0) };
            if status != ERROR_INSUFFICIENT_BUFFER || bytes < 4 || bytes > 8 * 1024 * 1024 { return Err(napi::Error::from_reason("Windows listener table is unavailable")); }
            let mut storage = vec![0u64; (bytes as usize + 7) / 8];
            if unsafe { GetExtendedTcpTable(storage.as_mut_ptr().cast(), &mut bytes, 0, family as u32, TCP_TABLE_OWNER_PID_LISTENER, 0) } != 0 { return Err(napi::Error::from_reason("Windows listener table changed")); }
            let base = storage.as_ptr().cast::<u8>();
            let count = unsafe { std::ptr::read_unaligned(base.cast::<u32>()) } as usize;
            let row_size = if family == AF_INET { std::mem::size_of::<MIB_TCPROW_OWNER_PID>() } else { std::mem::size_of::<MIB_TCP6ROW_OWNER_PID>() };
            if count > 65536 || 4usize.checked_add(count.saturating_mul(row_size)).is_none_or(|required| required > bytes as usize) { return Err(napi::Error::from_reason("Windows listener table is invalid")); }
            for index in 0..count {
                let row = unsafe { base.add(4 + index * row_size) };
                let (pid, address, raw_port) = if family == AF_INET {
                    let row = unsafe { std::ptr::read_unaligned(row.cast::<MIB_TCPROW_OWNER_PID>()) };
                    (row.dwOwningPid, std::net::Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).to_string(), row.dwLocalPort)
                } else {
                    let row = unsafe { std::ptr::read_unaligned(row.cast::<MIB_TCP6ROW_OWNER_PID>()) };
                    (row.dwOwningPid, std::net::Ipv6Addr::from(row.ucLocalAddr).to_string(), row.dwLocalPort)
                };
                result.push(WindowsListener { pid, address, port: u16::from_be(raw_port as u16) as u32 });
            }
        }
        Ok(result)
    }
    #[cfg(not(windows))]
    { Err(napi::Error::from_reason("Windows listener table is unavailable")) }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn native_listener_snapshot_reports_current_process_and_stable_birth() {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = u32::from(listener.local_addr().unwrap().port());
        let pid = std::process::id();
        let before = windows_process_births(vec![pid]).unwrap().remove(0);
        assert_eq!(before.state, "alive");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let rows = windows_listeners().unwrap();
            if rows.iter().any(|row| row.pid == pid && row.port == port && row.address == "127.0.0.1") { break; }
            assert!(std::time::Instant::now() < deadline, "native listener snapshot did not include the owned socket");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let after = windows_process_births(vec![pid]).unwrap().remove(0);
        assert_eq!(after.state, "alive");
        assert_eq!(before.started_at, after.started_at);
    }

    #[test]
    fn current_process_birth_is_stable() {
        let pid = std::process::id();
        let first = windows_process_births(vec![pid]).unwrap();
        let second = windows_process_births(vec![pid]).unwrap();
        assert_eq!(first[0].state, "alive");
        assert_eq!(first[0].started_at, second[0].started_at);
        assert!(first[0].started_at.as_deref().is_some_and(|value| value.bytes().all(|b| b.is_ascii_digit())));
    }
}
