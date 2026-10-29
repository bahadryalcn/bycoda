//! The real blocking text worker owns admission independently of its IPC waiter.
use crate::native_window_lifecycle::NativeWriteAdmission;

pub(super) fn run<T: Send + 'static>(
    admission: NativeWriteAdmission,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> + Send {
    // Schedule before returning the detachable waiter. The accepted operation
    // belongs to the actual worker through permissions, I/O or formatter result.
    let worker = tauri::async_runtime::spawn_blocking(move || admission.finish(work()));
    async move { worker.await.map_err(|error| error.to_string())? }
}

#[cfg(test)]
mod tests;
