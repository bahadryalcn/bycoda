//! Claude's login command requires a real terminal even when its browser handles
//! the callback. Keep that terminal hidden and its OAuth transcript private.
use std::io::{Read, Write};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

pub(super) fn login(
    binary: PathBuf,
    args: Vec<String>,
    cwd: String,
    timeout: Duration,
) -> Result<(), String> {
    let workdir = crate::fs::expand_home(&cwd);
    if !workdir.is_dir() {
        return Err("Project directory does not exist".into());
    }
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize::default())
        .map_err(|_| "Could not prepare the MCP sign-in terminal".to_string())?;
    let mut command = portable_pty::CommandBuilder::new(binary);
    command.args(args);
    command.cwd(workdir);
    command.env("PATH", super::gui_search_path());
    command.env("TERM", "xterm-256color");
    command.env(super::HARNESS_PARENT_ENV, std::process::id().to_string());
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|_| "Could not read the MCP sign-in terminal".to_string())?;
    // Holding stdin open is essential: Claude checks isTTY before authentication.
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|_| "Could not open the MCP sign-in terminal input".to_string())?;
    // Give this one authentication attempt its own original job handle, so a
    // timeout stops exactly its descendants without relying on recycled PIDs.
    let job = crate::owned_process_job::OwnedProcessJob::new()
        .map_err(|_| "Could not own the MCP sign-in process".to_string())?;
    let mut child = pair
        .slave
        .spawn_command_in_job(command, job.as_handle())
        .map_err(|_| "Could not start the MCP sign-in terminal".to_string())?;
    job.observe();
    drop(pair.slave);
    // Drain continuously to avoid blocking a verbose CLI. Do not retain, log or
    // return browser URLs, callback parameters, tokens or terminal escape codes.
    // Act as the hidden terminal: ConPTY inherits the cursor by sending a
    // cursor-position query and, on some hosts (e.g. Windows Server), stalls
    // the child's console output until it is answered. The drain owns stdin
    // until the terminal closes.
    thread::spawn(move || {
        const CURSOR_QUERY: &[u8] = b"\x1b[6n";
        let mut buffer = [0_u8; 4096];
        let mut matched = 0;
        while let Ok(count @ 1..) = reader.read(&mut buffer) {
            for &byte in &buffer[..count] {
                matched = if byte == CURSOR_QUERY[matched] {
                    matched + 1
                } else {
                    usize::from(byte == CURSOR_QUERY[0])
                };
                if matched == CURSOR_QUERY.len() {
                    let _ = writer.write_all(b"\x1b[1;1R");
                    matched = 0;
                }
            }
        }
    });
    let started = Instant::now();
    let mut completed = false;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                completed = true;
                break if status.success() { Ok(()) } else {
                    Err("MCP sign-in did not complete. Retry and finish authorization in your browser.".into())
                };
            }
            Err(_) => break Err("Could not confirm the MCP sign-in result. Refresh connections before retrying.".into()),
            Ok(None) if started.elapsed() >= timeout => break Err("MCP sign-in timed out. Retry and finish authorization in your browser. If the browser does not open or requests a pasted callback, run `claude mcp login <server-name>` in an interactive terminal.".into()),
            Ok(None) => thread::sleep(Duration::from_millis(40)),
        }
    };
    if !completed {
        job.terminate();
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(pair.master);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn powershell(script: &str, timeout: Duration) -> Result<(), String> {
        login(
            "powershell.exe".into(),
            vec!["-NoProfile".into(), "-Command".into(), script.into()],
            std::env::current_dir()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            timeout,
        )
    }

    #[test]
    fn login_has_terminal_stdin_and_drains_output() {
        // 256 KiB is several times any pty pipe buffer, so an undrained terminal
        // still blocks the child. Older Server ConPTY renders far slower than a
        // desktop one; the bound only catches a hang, a healthy run returns at exit.
        powershell("if ([Console]::IsInputRedirected) { exit 21 }; [Console]::Write(('x' * 262144)); exit 0", Duration::from_secs(60)).unwrap();
    }

    #[test]
    fn failed_login_does_not_disclose_oauth_output() {
        let error = powershell(
            "Write-Output 'https://example.test/authorize?state=private&code=secret'; exit 9",
            Duration::from_secs(20),
        )
        .unwrap_err();
        assert!(!error.contains("private"));
        assert!(!error.contains("secret"));
        assert!(!error.contains("https://"));
    }

    #[test]
    fn stalled_login_times_out() {
        let started = Instant::now();
        let error = powershell("Start-Sleep -Seconds 60", Duration::from_millis(150)).unwrap_err();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
