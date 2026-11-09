//! Original provider process resources and a private guardian transport.
//! Observed output, physical work completion and retirement proof stay separate.

pub mod build_receipt;
pub mod protocol;
pub mod runtime;
#[cfg(windows)]
pub mod windows_job;
