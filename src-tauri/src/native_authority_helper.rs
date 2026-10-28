//! Headless stdio/Windows-pipe bridge. No Store, Tauri, GUI, provider, writer
//! inventory, native actor qualification or migration grant is initialized here.
//! The parent owns blocking-stdio child deadlines/shutdown. Transport errors
//! never assert that a domain operation was cancelled or was not admitted.

use crate::native_authority_pipe::{
    AuthorityPipeAddress, AuthorityPipeConnection, PipeBudget, PipeCancellation, PipeError,
    MAX_CONTROL_FRAME,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::time::Duration;

const MODE: &str = "--native-authority-helper";
const MAX_ID: u64 = 9_007_199_254_740_991;
const PIPE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ErrorCode {
    InvalidBootstrap,
    InvalidCommand,
    InvalidFrame,
    FrameTooLarge,
    PeerRejected,
    PipeUnavailable,
    Deadline,
    Cancelled,
    PipeClosed,
    IoError,
    StdioError,
    Unsupported,
}
struct Failure {
    code: ErrorCode,
    id: Option<u64>,
}
impl From<ErrorCode> for Failure {
    fn from(code: ErrorCode) -> Self {
        Self { code, id: None }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bootstrap {
    version: u8,
    address: String,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum Command {
    Send { id: u64, value: Value },
    Receive { id: u64 },
    Close { id: u64 },
}
impl Command {
    fn id(&self) -> u64 {
        match self {
            Self::Send { id, .. } | Self::Receive { id } | Self::Close { id } => *id,
        }
    }
}

/// Root calls this before every ordinary native application initialization.
/// An exact mode plus any extra argument is an invalid helper invocation, not a
/// fallback to the GUI. No locator, PID or credential is accepted from argv/env.
pub(crate) fn maybe_run() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().collect();
    if !args
        .iter()
        .skip(1)
        .any(|arg| arg == std::ffi::OsStr::new(MODE))
    {
        return None;
    }
    if args.len() != 2 || args[1] != std::ffi::OsStr::new(MODE) {
        let _ = emit_error(
            &mut std::io::stdout().lock(),
            ErrorCode::InvalidBootstrap.into(),
        );
        return Some(2);
    }
    Some(run_stdio())
}

pub(crate) fn run_stdio() -> i32 {
    // Blocking stdio deliberately stays on this thread. The spawning Node owner
    // enforces the whole-child deadline; no orphan reader/writer worker exists.
    run(&mut std::io::stdin().lock(), &mut std::io::stdout().lock())
}

fn run(input: &mut impl Read, output: &mut impl Write) -> i32 {
    match bridge(input, output) {
        Ok(()) => 0,
        Err(failure) => {
            // A broken stdout cannot carry an error. Try once, never recurse or
            // print source/path/OS error details to stdout or stderr.
            let _ = emit_error(output, failure);
            2
        }
    }
}

fn bridge(input: &mut impl Read, output: &mut impl Write) -> Result<(), Failure> {
    let Some(frame) = read_frame(input)? else {
        return Ok(());
    };
    let bootstrap: Bootstrap =
        serde_json::from_slice(&frame).map_err(|_| ErrorCode::InvalidBootstrap)?;
    if bootstrap.version != 1 {
        return Err(ErrorCode::InvalidBootstrap.into());
    }
    let address = AuthorityPipeAddress::parse_local(&bootstrap.address)
        .map_err(|_| ErrorCode::InvalidBootstrap)?;
    let mut connection =
        AuthorityPipeConnection::connect_current_native_image(&address, &budget()?)
            .map_err(|error| Failure::from(pipe_code(error)))?;
    write_frame(output, &json!({"version":1,"kind":"ready"}))?;
    let mut last_id = 0;
    loop {
        let Some(frame) = read_frame(input)? else {
            connection.close();
            return Ok(());
        };
        let command: Command =
            serde_json::from_slice(&frame).map_err(|_| ErrorCode::InvalidCommand)?;
        let id = command.id();
        if id == 0 || id > MAX_ID || id <= last_id {
            return Err(ErrorCode::InvalidCommand.into());
        }
        last_id = id;
        let result = match command {
            Command::Send { value, .. } => connection
                .send_json(&value, &budget()?)
                .map_err(pipe_code)
                .and_then(|()| write_frame(output, &json!({"kind":"sent","id":id}))),
            Command::Receive { .. } => connection
                .read_json(&budget()?)
                .map_err(pipe_code)
                .and_then(|value| {
                    write_frame(output, &json!({"kind":"received","id":id,"value":value}))
                }),
            Command::Close { .. } => {
                connection.close();
                write_frame(output, &json!({"kind":"closed","id":id}))
                    .map_err(|code| Failure { code, id: Some(id) })?;
                // Never process queued/trailing commands after an explicit close.
                return Ok(());
            }
        };
        result.map_err(|code| Failure { code, id: Some(id) })?;
    }
}

fn budget() -> Result<PipeBudget, ErrorCode> {
    PipeBudget::new(PIPE_TIMEOUT, PipeCancellation::default()).map_err(pipe_code)
}

fn pipe_code(error: PipeError) -> ErrorCode {
    match error {
        PipeError::Unsupported => ErrorCode::Unsupported,
        PipeError::Peer(_) => ErrorCode::PeerRejected,
        PipeError::Unavailable => ErrorCode::PipeUnavailable,
        PipeError::Deadline => ErrorCode::Deadline,
        PipeError::Cancelled => ErrorCode::Cancelled,
        PipeError::Closed => ErrorCode::PipeClosed,
        PipeError::FrameTooLarge => ErrorCode::FrameTooLarge,
        PipeError::InvalidAddress
        | PipeError::InvalidBudget
        | PipeError::Truncated
        | PipeError::Malformed => ErrorCode::IoError,
    }
}

/// Return a clean EOF only before a new header. Reject oversized length before
/// allocating payload; validate JSON syntax separately so closed DTO parsing can
/// still detect duplicated outer fields rather than normalizing through Value.
fn read_frame(input: &mut impl Read) -> Result<Option<Vec<u8>>, ErrorCode> {
    let mut header = [0u8; 4];
    loop {
        match input.read(&mut header[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(ErrorCode::StdioError),
        }
    }
    read_remaining(input, &mut header[1..])?;
    let size = u32::from_le_bytes(header) as usize;
    if size > MAX_CONTROL_FRAME {
        return Err(ErrorCode::FrameTooLarge);
    }
    if size == 0 {
        return Err(ErrorCode::InvalidFrame);
    }
    let mut frame = vec![0u8; size];
    read_remaining(input, &mut frame)?;
    serde_json::from_slice::<serde::de::IgnoredAny>(&frame).map_err(|_| ErrorCode::InvalidFrame)?;
    Ok(Some(frame))
}

fn read_remaining(input: &mut impl Read, bytes: &mut [u8]) -> Result<(), ErrorCode> {
    input.read_exact(bytes).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            ErrorCode::InvalidFrame
        } else {
            ErrorCode::StdioError
        }
    })
}

struct BoundedFrame(Vec<u8>);
impl Write for BoundedFrame {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_CONTROL_FRAME.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("frame limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn write_frame(output: &mut impl Write, value: &impl Serialize) -> Result<(), ErrorCode> {
    let mut frame = BoundedFrame(Vec::with_capacity(MAX_CONTROL_FRAME));
    serde_json::to_writer(&mut frame, value).map_err(|_| ErrorCode::FrameTooLarge)?;
    output
        .write_all(&(frame.0.len() as u32).to_le_bytes())
        .and_then(|()| output.write_all(&frame.0))
        .and_then(|()| output.flush())
        .map_err(|_| ErrorCode::StdioError)
}

fn emit_error(output: &mut impl Write, failure: Failure) -> Result<(), ErrorCode> {
    match failure.id {
        Some(id) => write_frame(output, &json!({"kind":"error","id":id,"code":failure.code})),
        None => write_frame(output, &json!({"kind":"error","code":failure.code})),
    }
}

#[cfg(test)]
#[path = "native_authority_helper_tests.rs"]
mod tests;
