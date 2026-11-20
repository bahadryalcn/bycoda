//! One bounded stderr line for a guardian abort. Stdout stays the private protocol
//! channel. The diagnostic uses the stage, error kind and raw OS error code.
use std::io::{self, Write};

pub fn failure_line(stage: &str, error: &io::Error) -> String {
    let kind = error.kind();
    match error.raw_os_error() {
        Some(code) => format!(
            "bycoda-provider-process-guardian: {stage} failed ({kind:?}, OS error {code})\n"
        ),
        None => format!("bycoda-provider-process-guardian: {stage} failed ({kind:?})\n"),
    }
}

/// Best effort: a closed or broken stderr must not change the exit status.
pub fn report_failure(stage: &str, error: &io::Error) {
    let _ = io::stderr().write_all(failure_line(stage, error).as_bytes());
}
