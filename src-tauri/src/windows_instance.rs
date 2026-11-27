//! A local named pipe is both the atomic instance lock and the relaunch signal.
//! GUI launches only: main.rs handles control/app/SSH askpass before this plugin.
use std::io::{self, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::sync::Arc;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::{Manager, RunEvent};
use windows_sys::Win32::{
    Foundation::{
        ERROR_ACCESS_DENIED, ERROR_IO_PENDING, ERROR_NO_DATA, ERROR_PIPE_BUSY,
        ERROR_PIPE_CONNECTED, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
        WAIT_TIMEOUT,
    },
    Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, ReadFile, FILE_FLAG_FIRST_PIPE_INSTANCE,
        FILE_FLAG_OVERLAPPED, OPEN_EXISTING, PIPE_ACCESS_INBOUND,
    },
    System::{
        Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeServerProcessId,
            WaitNamedPipeW, PIPE_REJECT_REMOTE_CLIENTS,
        },
        Threading::{CreateEventW, WaitForSingleObject},
        IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED},
    },
    UI::WindowsAndMessaging::AllowSetForegroundWindow,
};

/// Time one relaunch client may take to send its whole message. A stalled client
/// is disconnected after this, so the single pipe instance is never held forever.
const CLIENT_BUDGET: Duration = Duration::from_secs(5);
/// Pause after an unexpected pipe error so a persistent failure cannot spin a core.
const ERROR_BACKOFF: Duration = Duration::from_millis(100);
/// Largest session link a relaunch client may send.
const MAX_LINK_BYTES: usize = 4096;

struct InstancePipe(Arc<OwnedHandle>);

fn pipe_name(app: &tauri::AppHandle) -> Result<Vec<u16>, Box<dyn std::error::Error>> {
    let mut hash = Sha256::new();
    // Do not merge stable/dev, separate installations, data profiles or distinct
    // argument-bearing launches. Cwd alone is not a profile (shortcuts vary it).
    for value in [
        std::ffi::OsString::from(&app.config().identifier),
        app.path().app_data_dir()?.into_os_string(),
        std::env::current_exe()?.into_os_string(),
        std::ffi::OsString::from(if cfg!(debug_assertions) {
            "dev"
        } else {
            "release"
        }),
    ] {
        hash.update(value.to_string_lossy().to_lowercase().as_bytes());
        hash.update([0]);
    }
    for argument in std::env::args_os().skip(1) {
        // A navigation target must reach the existing profile, not create a
        // different instance lock for every session URL.
        if crate::session_links::is_session_link(&argument.to_string_lossy()) {
            continue;
        }
        let units: Vec<u16> = argument.encode_wide().collect();
        hash.update((units.len() as u64).to_le_bytes());
        for unit in units {
            hash.update(unit.to_le_bytes());
        }
    }
    if let Some(profile) = crate::debug_profile::profile_id() {
        hash.update(profile.as_bytes());
        hash.update([0]);
    }
    Ok(format!(r"\\.\pipe\bycoda-relaunch-{:x}", hash.finalize())
        .encode_utf16()
        .chain(Some(0))
        .collect())
}

fn notify_existing(name: &[u16]) -> io::Result<()> {
    let name = name.to_vec();
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let link = std::env::args_os()
        .skip(1)
        .filter_map(|argument| argument.into_string().ok())
        .find(|value| crate::session_links::is_session_link(value));
    std::thread::spawn(move || {
        let _ = send.send(send_relaunch(&name, link.as_deref()));
    });
    receive
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                "Running bycoda did not accept relaunch",
            )
        })?
}

fn send_relaunch(name: &[u16], link: Option<&str>) -> io::Result<()> {
    unsafe {
        let mut raw = CreateFileW(
            name.as_ptr(),
            GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        );
        if raw == INVALID_HANDLE_VALUE
            && io::Error::last_os_error().raw_os_error() == Some(ERROR_PIPE_BUSY as i32)
        {
            if WaitNamedPipeW(name.as_ptr(), 5_000) == 0 {
                return Err(io::Error::last_os_error());
            }
            raw = CreateFileW(
                name.as_ptr(),
                GENERIC_WRITE,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            );
        }
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut pipe = std::fs::File::from_raw_handle(raw);
        let mut pid = 0;
        if GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid) == 0 {
            return Err(io::Error::last_os_error());
        }
        // Give only the running instance permission to foreground its window.
        AllowSetForegroundWindow(pid);
        if let Some(link) = link {
            pipe.write_all(&[2])?;
            pipe.write_all(&(link.len() as u32).to_le_bytes())?;
            pipe.write_all(link.as_bytes())?;
        } else {
            pipe.write_all(&[1])?;
        }
        // Keep the client connected until Ready's listener consumes the signal.
        // Otherwise ConnectNamedPipe can see a closed client during startup.
        // The server may already have disconnected after reading it.
        FlushFileBuffers(pipe.as_raw_handle());
        Ok(())
    }
}

/// What one relaunch client asked for. `show` is false for unknown signal bytes.
struct Relaunch {
    show: bool,
    link: Option<String>,
    /// The local installer asks the app to quit through the normal save-and-confirm run, so a
    /// replaced build never leaves native buffers dirty the way a forced kill does.
    quit: bool,
}

/// Signal byte of a quit request. Older builds read it as an unknown signal and ignore it.
const QUIT_SIGNAL: u8 = 3;

/// Serves one relaunch client. The connect waits for the next client without a
/// limit; everything after it is bounded by `CLIENT_BUDGET`.
fn serve_client(raw: HANDLE) -> io::Result<Relaunch> {
    match overlapped_op(raw, None, |overlapped, _| unsafe {
        ConnectNamedPipe(raw, overlapped)
    }) {
        Ok(_) => {}
        Err(error) if error.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32) => {}
        Err(error) => return Err(error),
    }
    let deadline = Instant::now() + CLIENT_BUDGET;
    let mut signal = [0u8; 1];
    read_exact_by(raw, &mut signal, deadline)?;
    if signal[0] == QUIT_SIGNAL {
        return Ok(Relaunch {
            show: false,
            link: None,
            quit: true,
        });
    }
    if !matches!(signal[0], 1 | 2) {
        return Ok(Relaunch {
            show: false,
            link: None,
            quit: false,
        });
    }
    let link = if signal[0] == 2 {
        // The window still shows when the link is missing or stalls.
        match read_link(raw, deadline) {
            Ok(link) => link,
            Err(error) => {
                log::warn!("Could not read bycoda relaunch link: {error}");
                None
            }
        }
    } else {
        None
    };
    Ok(Relaunch {
        show: true,
        link,
        quit: false,
    })
}

fn read_link(raw: HANDLE, deadline: Instant) -> io::Result<Option<String>> {
    let mut size = [0; 4];
    read_exact_by(raw, &mut size, deadline)?;
    let size = u32::from_le_bytes(size) as usize;
    if size > MAX_LINK_BYTES {
        return Ok(None);
    }
    let mut bytes = vec![0; size];
    read_exact_by(raw, &mut bytes, deadline)?;
    Ok(String::from_utf8(bytes)
        .ok()
        .filter(|value| crate::session_links::is_session_link(value)))
}

fn read_exact_by(raw: HANDLE, buffer: &mut [u8], deadline: Instant) -> io::Result<()> {
    read_exact_with(buffer, |chunk| {
        let len = chunk.len() as u32;
        overlapped_op(raw, Some(deadline), |overlapped, read| unsafe {
            ReadFile(raw, chunk.as_mut_ptr().cast(), len, read, overlapped)
        })
    })
}

/// Fills `buffer` from `read_chunk`, which must return at most one completed read.
/// Stops at the first error, so a stalled client is never retried in a loop.
fn read_exact_with(
    buffer: &mut [u8],
    mut read_chunk: impl FnMut(&mut [u8]) -> io::Result<u32>,
) -> io::Result<()> {
    let mut filled = 0;
    while filled < buffer.len() {
        let read = read_chunk(&mut buffer[filled..])?;
        if read == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        filled += read as usize;
    }
    Ok(())
}

/// Runs one overlapped pipe operation and waits for it until `deadline` (`None`
/// waits indefinitely). On timeout the operation is cancelled and drained, so the
/// OVERLAPPED, event and buffers stay valid until the kernel is done with them.
fn overlapped_op(
    raw: HANDLE,
    deadline: Option<Instant>,
    start: impl FnOnce(*mut OVERLAPPED, *mut u32) -> i32,
) -> io::Result<u32> {
    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if event.is_null() {
        return Err(io::Error::last_os_error());
    }
    let event = unsafe { OwnedHandle::from_raw_handle(event) };
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    overlapped.hEvent = event.as_raw_handle();
    let mut transferred = 0;
    if start(&mut overlapped, &mut transferred) != 0 {
        return Ok(transferred);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
        return Err(error);
    }
    let wait = unsafe { WaitForSingleObject(event.as_raw_handle(), wait_ms(deadline)) };
    if wait != WAIT_OBJECT_0 {
        let error = if wait == WAIT_TIMEOUT {
            io::Error::new(io::ErrorKind::TimedOut, "bycoda relaunch client stalled")
        } else {
            io::Error::last_os_error()
        };
        unsafe {
            CancelIoEx(raw, &overlapped);
            // Let the cancelled operation finish before its buffers are released.
            GetOverlappedResult(raw, &overlapped, &mut transferred, 1);
        }
        return Err(error);
    }
    if unsafe { GetOverlappedResult(raw, &overlapped, &mut transferred, 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(transferred)
}

fn wait_ms(deadline: Option<Instant>) -> u32 {
    match deadline {
        None => u32::MAX, // INFINITE
        Some(deadline) => deadline
            .saturating_duration_since(Instant::now())
            .as_millis()
            .min(u32::MAX as u128 - 1) as u32,
    }
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("windows-instance")
        .setup(|app, _| {
            let name = pipe_name(app)?;
            let raw = unsafe {
                CreateNamedPipeW(
                    name.as_ptr(),
                    PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                    PIPE_REJECT_REMOTE_CLIENTS,
                    1,
                    0,
                    8192,
                    5_000,
                    std::ptr::null(),
                )
            };
            if raw == INVALID_HANDLE_VALUE {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_ACCESS_DENIED as i32)
                    && error.raw_os_error() != Some(ERROR_PIPE_BUSY as i32)
                {
                    return Err(error.into());
                }
                // Failed forwarding must not fall through and start another tray.
                notify_existing(&name)?;
                app.cleanup_before_exit();
                std::process::exit(0);
            }
            let pipe = Arc::new(unsafe { OwnedHandle::from_raw_handle(raw) });
            app.manage(InstancePipe(pipe));
            Ok(())
        })
        .on_event(|app, event| {
            if !matches!(event, RunEvent::Ready) {
                return;
            }
            // Start after setup/Ready; a relaunch during startup is buffered by
            // the pipe and cannot create a workspace before stores are ready.
            let pipe = app.state::<InstancePipe>().0.clone();
            let app = app.clone();
            std::thread::spawn(move || loop {
                let raw = pipe.as_raw_handle();
                let result = serve_client(raw);
                // Always release the client, even after an error, so the next launch can connect.
                unsafe { DisconnectNamedPipe(raw) };
                match result {
                    Ok(Relaunch { quit: true, .. }) => {
                        let target = app.clone();
                        if let Err(error) =
                            app.run_on_main_thread(move || crate::window::request_quit(&target))
                        {
                            log::warn!("Could not dispatch bycoda quit request: {error}");
                        }
                    }
                    Ok(Relaunch { show, link, .. }) => {
                        if let Some(link) = link {
                            crate::session_links::enqueue(&app, [link]);
                        }
                        if show {
                            let target = app.clone();
                            if let Err(error) = app.run_on_main_thread(move || {
                                if let Err(error) =
                                    crate::window::show_existing_or_open_new(&target)
                                {
                                    log::warn!("Could not show existing bycoda window: {error}");
                                }
                            }) {
                                log::warn!("Could not dispatch bycoda relaunch: {error}");
                            }
                        }
                    }
                    // A launching process may have crashed before signaling.
                    Err(error) if error.raw_os_error() == Some(ERROR_NO_DATA as i32) => {}
                    Err(error) => {
                        log::warn!("Could not receive bycoda relaunch: {error}");
                        std::thread::sleep(ERROR_BACKOFF);
                    }
                }
            });
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_exact_assembles_partial_reads() {
        let mut chunks = vec![vec![1u8, 2], vec![3u8]].into_iter();
        let mut buffer = [0u8; 3];
        read_exact_with(&mut buffer, |chunk| {
            let next = chunks.next().unwrap();
            chunk[..next.len()].copy_from_slice(&next);
            Ok(next.len() as u32)
        })
        .unwrap();
        assert_eq!(buffer, [1, 2, 3]);
    }

    #[test]
    fn read_exact_stops_at_first_timeout() {
        let mut calls = 0;
        let mut buffer = [0u8; 4];
        let error = read_exact_with(&mut buffer, |_| {
            calls += 1;
            Err(io::Error::new(io::ErrorKind::TimedOut, "stalled"))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert_eq!(calls, 1);
    }

    #[test]
    fn read_exact_rejects_closed_client() {
        let mut buffer = [0u8; 1];
        let error = read_exact_with(&mut buffer, |_| Ok(0)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }
}
