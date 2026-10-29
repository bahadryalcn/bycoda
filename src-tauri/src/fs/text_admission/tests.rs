use super::*;
use crate::native_window_lifecycle::{
    test_buffer_owner, test_buffer_resources, test_reload_buffer_resources,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);
struct Directory {
    base: PathBuf,
    root: PathBuf,
}
impl Directory {
    fn new() -> Self {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-29-input-admission-native/fixtures");
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(format!("text-admission-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self { base, root }
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let target = self.root.canonicalize().unwrap();
        assert_eq!(target.parent(), Some(self.base.as_path()));
        assert!(target
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("text-admission-"));
        std::fs::remove_dir_all(target).unwrap();
    }
}

// The detached worker's output is dropped only after admission.finish returned.
// This observes real settlement without racing a signal sent inside work().
struct Completion<T> {
    value: Option<T>,
    finished: mpsc::Sender<T>,
}
impl<T> Drop for Completion<T> {
    fn drop(&mut self) {
        if let Some(value) = self.value.take() {
            let _ = self.finished.send(value);
        }
    }
}

#[test]
fn detached_read_waiter_keeps_actual_worker_admitted_until_real_file_read_settles() {
    let directory = Directory::new();
    let path = directory.root.join("input.txt");
    let original = "  original\r\n漢🦀\n";
    std::fs::write(&path, original).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "reader");
    let (_, operation) = test_buffer_owner(&resources, uuid::Uuid::new_v4()).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let (finished, settled) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let actual_calls = calls.clone();
    let waiter = run(NativeWriteAdmission::Tracked(operation), move || {
        actual_calls.fetch_add(1, Ordering::AcqRel);
        started.send(()).map_err(|error| error.to_string())?;
        held.recv_timeout(WAIT).map_err(|error| error.to_string())?;
        let value = super::super::read_text_file_sync(&path.to_string_lossy())?;
        Ok(Completion {
            value: Some(value),
            finished,
        })
    });
    entered.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release.send(()).unwrap();
    assert_eq!(settled.recv_timeout(WAIT).unwrap(), original);
    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn detached_write_returns_actual_io_success_even_if_original_owner_reloads() {
    let directory = Directory::new();
    let path = directory.root.join("output.txt");
    std::fs::write(&path, "original").unwrap();
    let target = path.clone();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "writer");
    let (_, operation) = test_buffer_owner(&resources, uuid::Uuid::new_v4()).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let (finished, settled) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let actual_calls = calls.clone();
    let waiter = run(NativeWriteAdmission::Tracked(operation), move || {
        actual_calls.fetch_add(1, Ordering::AcqRel);
        started.send(()).map_err(|error| error.to_string())?;
        held.recv_timeout(WAIT).map_err(|error| error.to_string())?;
        super::super::write_text_file_sync(&target.to_string_lossy(), "saved\r\n漢🦀")?;
        Ok(Completion {
            value: Some(()),
            finished,
        })
    });
    entered.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::PendingNativeOperations)
    ));
    test_reload_buffer_resources(&resources);
    release.send(()).unwrap();
    settled.recv_timeout(WAIT).unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), "saved\r\n漢🦀");
    assert_eq!(calls.load(Ordering::Acquire), 1);
    // Actual write success is preserved; a reloaded owner still cannot inherit
    // a successful idle/checkpoint proof for the old physical context.
    assert!(barrier.try_close_idle_target_admission("A").is_err());
}

#[test]
fn original_worker_error_is_preserved_and_taints_native_qualification() {
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "formatter");
    let (_, operation) = test_buffer_owner(&resources, uuid::Uuid::new_v4()).unwrap();
    let original = "original formatter or file-access error";
    let result: Result<(), String> =
        tauri::async_runtime::block_on(run(NativeWriteAdmission::Tracked(operation), move || {
            Err(original.into())
        }));
    assert_eq!(result.unwrap_err(), original);
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::FailedNativeOperation)
    ));
}

#[test]
fn unqualified_open_admission_still_preserves_ordinary_file_result() {
    let directory = Directory::new();
    let path = directory.root.join("fallback.txt");
    std::fs::write(&path, "ordinary fallback text\n").unwrap();
    let result =
        tauri::async_runtime::block_on(run(NativeWriteAdmission::Unqualified, move || {
            super::super::read_text_file_sync(&path.to_string_lossy())
        }))
        .unwrap();
    assert_eq!(result, "ordinary fallback text\n");
}
