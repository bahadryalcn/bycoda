//! The real blocking text worker owns admission independently of its IPC waiter.
pub(super) use crate::native_window_lifecycle::run_admitted_blocking as run;

#[cfg(test)]
use crate::native_window_lifecycle::NativeWriteAdmission;

#[cfg(test)]
mod tests;
