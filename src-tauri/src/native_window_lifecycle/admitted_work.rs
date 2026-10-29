//! Actual blocking work owns admission; observing IPC is a detachable waiter.
use super::NativeWriteAdmission;

pub(crate) fn run<T: Send + 'static>(
    admission: NativeWriteAdmission,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> + Send {
    // Schedule now rather than inside the returned future. A dropped waiter
    // cannot retire an operation whose permissions/effect are still running.
    let worker = tauri::async_runtime::spawn_blocking(move || admission.finish(work()));
    async move { worker.await.map_err(|error| error.to_string())? }
}

#[cfg(test)]
mod tests {
    use crate::native_window_lifecycle::{test_admit_window_buffers, test_buffer_resources};
    use crate::session_store::window_barrier::{BarrierError, WindowBarrier};

    #[test]
    fn authoritative_success_with_cleanup_failure_never_certifies_idle() {
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "cleanup-owner");
        let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
        let actual: Result<(), String> = admission.finish_observed(Ok(()), Err(()));
        assert_eq!(actual, Ok(()));
        assert!(matches!(
            barrier.try_close_idle_target_admission("A"),
            Err(BarrierError::FailedNativeOperation)
        ));
    }

    #[test]
    fn successful_observation_cannot_hide_original_operation_error() {
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "failed-owner");
        let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
        let actual: Result<(), String> =
            admission.finish_observed(Err("original CAS failure".into()), Ok(()));
        assert_eq!(actual.unwrap_err(), "original CAS failure");
        assert!(matches!(
            barrier.try_close_idle_target_admission("A"),
            Err(BarrierError::FailedNativeOperation)
        ));
    }
}
