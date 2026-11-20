//! Bounded runner for the OS helpers an owner-started Termius import invokes (the system
//! keychain tool and the Windows account lookup). stdin is closed, stderr is discarded and
//! stdout is capped and held in zeroizing memory, so nothing the helper prints can reach an
//! error string. A deadline stops the helper's whole process tree and reaps it.
use std::{
    io::Read,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

/// Long enough to answer a keychain access prompt, short enough that the import dialog
/// never sits in its loading state behind a hidden prompt.
pub(crate) const HELPER_TIMEOUT: Duration = Duration::from_secs(10);
/// A local key or account line is tiny; anything larger is not what the helper should print.
pub(crate) const HELPER_OUTPUT_LIMIT: usize = 64 * 1024;
const POLL: Duration = Duration::from_millis(25);
/// After the helper exits, a surviving grandchild may keep the pipe open.
const OUTPUT_GRACE: Duration = Duration::from_secs(1);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum HelperFailure {
    /// The helper binary does not exist on this machine.
    Missing,
    /// The helper did not finish before the deadline and was stopped.
    TimedOut,
    /// The helper could not start, exited unsuccessfully or printed too much.
    Failed,
}

fn stop(child: &mut std::process::Child) {
    crate::harness::terminate_all(&[child.id()]);
    let _ = child.kill();
    let _ = child.wait();
}

/// Runs `command` and returns its stdout only when it exits successfully in time.
pub(crate) fn run_bounded(
    command: &mut Command,
    timeout: Duration,
    limit: usize,
) -> Result<Zeroizing<Vec<u8>>, HelperFailure> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            HelperFailure::Missing
        } else {
            HelperFailure::Failed
        }
    })?;
    let Some(mut stdout) = child.stdout.take() else {
        stop(&mut child);
        return Err(HelperFailure::Failed);
    };
    // Drain on its own thread so a full pipe cannot stall the helper, and never join it:
    // after a timeout the thread ends when the killed tree closes the pipe, and its buffer
    // zeroizes on drop. The capacity is reserved up front so no unzeroized copy is left
    // behind by a reallocation.
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::with_capacity(limit + 1));
        let read = (&mut stdout).take(limit as u64 + 1).read_to_end(&mut bytes);
        let _ = sender.send(read.is_ok().then_some(bytes));
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            Ok(None) => {
                stop(&mut child);
                return Err(HelperFailure::TimedOut);
            }
            Err(_) => {
                stop(&mut child);
                return Err(HelperFailure::Failed);
            }
        }
    };
    if !status.success() {
        return Err(HelperFailure::Failed);
    }
    match receiver.recv_timeout(OUTPUT_GRACE) {
        Ok(Some(bytes)) if bytes.len() <= limit => Ok(bytes),
        Ok(_) => Err(HelperFailure::Failed),
        Err(_) => {
            stop(&mut child);
            Err(HelperFailure::TimedOut)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    fn command(script: &str) -> Command {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd.exe");
        command.args(["/C", script]).creation_flags(0x08000000);
        command
    }

    #[cfg(not(windows))]
    fn command(script: &str) -> Command {
        let mut command = Command::new("sh");
        command.args(["-c", script]);
        command
    }

    #[cfg(windows)]
    const HANG: &str = "ping -n 30 127.0.0.1 >NUL";
    #[cfg(not(windows))]
    const HANG: &str = "sleep 30";

    #[test]
    fn stops_a_helper_that_outlives_its_deadline() {
        let started = Instant::now();
        let result = run_bounded(
            &mut command(HANG),
            Duration::from_millis(200),
            HELPER_OUTPUT_LIMIT,
        );
        assert_eq!(result.unwrap_err(), HelperFailure::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn returns_output_only_for_a_successful_helper() {
        let output =
            run_bounded(&mut command("echo ok"), HELPER_TIMEOUT, HELPER_OUTPUT_LIMIT).unwrap();
        assert_eq!(String::from_utf8_lossy(&output).trim(), "ok");
        assert_eq!(
            run_bounded(&mut command("exit 3"), HELPER_TIMEOUT, HELPER_OUTPUT_LIMIT).unwrap_err(),
            HelperFailure::Failed
        );
    }

    #[test]
    fn rejects_oversized_output_and_reports_a_missing_helper() {
        assert_eq!(
            run_bounded(&mut command("echo 0123456789"), HELPER_TIMEOUT, 4).unwrap_err(),
            HelperFailure::Failed
        );
        assert_eq!(
            run_bounded(
                &mut Command::new("bycoda-no-such-helper"),
                HELPER_TIMEOUT,
                HELPER_OUTPUT_LIMIT
            )
            .unwrap_err(),
            HelperFailure::Missing
        );
    }
}
