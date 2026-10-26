//! A local named pipe is both the atomic instance lock and the relaunch signal.
//! GUI launches only: main.rs handles control/app/SSH askpass before this plugin.
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::sync::Arc;

use sha2::{Digest, Sha256};
use tauri::{Manager, RunEvent};
use windows_sys::Win32::{
    Foundation::{
        ERROR_ACCESS_DENIED, ERROR_NO_DATA, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, GENERIC_WRITE,
        INVALID_HANDLE_VALUE,
    },
    Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE,
        OPEN_EXISTING, PIPE_ACCESS_INBOUND,
    },
    System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeServerProcessId,
        WaitNamedPipeW, PIPE_REJECT_REMOTE_CLIENTS,
    },
    UI::WindowsAndMessaging::AllowSetForegroundWindow,
};

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
    std::thread::spawn(move || {
        let _ = send.send(send_relaunch(&name));
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

fn send_relaunch(name: &[u16]) -> io::Result<()> {
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
        let pipe = OwnedHandle::from_raw_handle(raw);
        let mut pid = 0;
        if GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid) == 0 {
            return Err(io::Error::last_os_error());
        }
        // Give only the running instance permission to foreground its window.
        AllowSetForegroundWindow(pid);
        let mut written = 0;
        if WriteFile(
            pipe.as_raw_handle(),
            &1u8,
            1,
            &mut written,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        // Keep the client connected until Ready's listener consumes the signal.
        // Otherwise ConnectNamedPipe can see a closed client during startup.
        // The server may already have disconnected after reading it.
        FlushFileBuffers(pipe.as_raw_handle());
        Ok(())
    }
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("windows-instance")
        .setup(|app, _| {
            let name = pipe_name(app)?;
            let raw = unsafe {
                CreateNamedPipeW(
                    name.as_ptr(),
                    PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
                    PIPE_REJECT_REMOTE_CLIENTS,
                    1,
                    0,
                    1,
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
                let connected = unsafe { ConnectNamedPipe(raw, std::ptr::null_mut()) } != 0
                    || io::Error::last_os_error().raw_os_error()
                        == Some(ERROR_PIPE_CONNECTED as i32);
                if !connected {
                    if io::Error::last_os_error().raw_os_error() == Some(ERROR_NO_DATA as i32) {
                        // A launching process may have crashed before signaling.
                        unsafe { DisconnectNamedPipe(raw) };
                        continue;
                    }
                    eprintln!(
                        "Could not receive bycoda relaunch: {}",
                        io::Error::last_os_error()
                    );
                    break;
                }
                let mut signal = 0u8;
                let mut read = 0;
                let received =
                    unsafe { ReadFile(raw, &mut signal, 1, &mut read, std::ptr::null_mut()) } != 0;
                unsafe { DisconnectNamedPipe(raw) };
                if received && read == 1 && signal == 1 {
                    let target = app.clone();
                    if let Err(error) = app.run_on_main_thread(move || {
                        if let Err(error) = crate::window::show_existing_or_open_new(&target) {
                            eprintln!("Could not show existing bycoda window: {error}");
                        }
                    }) {
                        eprintln!("Could not dispatch bycoda relaunch: {error}");
                    }
                }
            });
        })
        .build()
}
