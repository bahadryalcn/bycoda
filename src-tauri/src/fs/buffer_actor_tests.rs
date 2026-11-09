use super::*;
use crate::native_window_lifecycle::{
    test_admit_window_buffers, test_buffer_resources, test_reload_buffer_resources,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use sha2::{Digest, Sha256};
use std::sync::atomic::AtomicUsize;

const WAIT: Duration = Duration::from_secs(10);

struct Directory {
    base: PathBuf,
    root: PathBuf,
}

impl Directory {
    fn new() -> Self {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-29-buffer-actors-fs/fixtures");
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(format!("fs-actor-{}", Uuid::new_v4()));
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
            .starts_with("fs-actor-"));
        std::fs::remove_dir_all(target).unwrap();
    }
}

// A detached worker drops its output after admission.finish has completed. This
// observes actual settlement rather than racing a signal sent inside the work.
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
fn detached_attachment_reader_keeps_real_reads_admitted_until_settlement() {
    let directory = Directory::new();
    let path = directory.root.join("original.bin");
    let bytes = b"\0binary\xff\r\nexact bytes".to_vec();
    std::fs::write(&path, &bytes).unwrap();
    let size = bytes.len() as u64;
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "attachment-reader");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let (finished, settled) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let actual_calls = calls.clone();
    let waiter = run_admitted_blocking(admission, move || {
        actual_calls.fetch_add(1, Ordering::AcqRel);
        started.send(()).map_err(|error| error.to_string())?;
        held.recv_timeout(WAIT).map_err(|error| error.to_string())?;
        let path_text = path.to_string_lossy();
        let raw = read_binary_file_sync(&path_text)?;
        let base64 = read_file_base64_sync(&path_text)?;
        let chunk = attachment_reads::read_chunk(&path, size, 2, 5)?;
        let hash = attachment_reads::hash_prefix(&path, size, 7)?;
        Ok(Completion {
            value: Some((raw, base64, serde_json::to_value(chunk).unwrap(), hash)),
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
    let (raw, base64, chunk, hash) = settled.recv_timeout(WAIT).unwrap();
    assert_eq!(raw, bytes);
    assert_eq!(
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64).unwrap(),
        bytes
    );
    assert_eq!(
        chunk,
        serde_json::json!({
            "data": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes[2..7]),
            "offset": 7,
            "size": size,
        })
    );
    assert_eq!(hash, format!("{:x}", Sha256::digest(&bytes[..7])));
    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn dropped_copy_waiter_cannot_release_during_validation_or_recursive_copy() {
    let directory = Directory::new();
    let source = directory.root.join("source");
    let parent = directory.root.join("destination");
    std::fs::create_dir_all(source.join("nested")).unwrap();
    std::fs::create_dir(&parent).unwrap();
    std::fs::write(source.join("nested/exact.txt"), "  retained\r\n漢🦀\n").unwrap();
    let destination = parent.join("source");
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "tree-copy");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let (finished, settled) = mpsc::channel();
    let waiter = run_admitted_blocking(admission, move || {
        let copied = copy_path_checked(
            &source.to_string_lossy(),
            &parent.to_string_lossy(),
            |_, _| {
                started.send(()).map_err(|error| error.to_string())?;
                held.recv_timeout(WAIT).map_err(|error| error.to_string())
            },
        )?;
        Ok(Completion {
            value: Some(copied),
            finished,
        })
    });
    entered.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(!destination.exists());
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release.send(()).unwrap();
    assert_eq!(
        PathBuf::from(settled.recv_timeout(WAIT).unwrap()),
        destination
    );
    assert_eq!(
        std::fs::read_to_string(destination.join("nested/exact.txt")).unwrap(),
        "  retained\r\n漢🦀\n"
    );
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn actual_move_success_survives_owner_reload_without_replay_or_old_owner_proof() {
    let directory = Directory::new();
    let source = directory.root.join("move.txt");
    let parent = directory.root.join("destination");
    std::fs::write(&source, "original move body\r\n").unwrap();
    std::fs::create_dir(&parent).unwrap();
    let destination = parent.join("move.txt");
    let original = source.clone();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "moving-owner");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let (finished, settled) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let actual_calls = calls.clone();
    let waiter = run_admitted_blocking(admission, move || {
        started.send(()).map_err(|error| error.to_string())?;
        held.recv_timeout(WAIT).map_err(|error| error.to_string())?;
        actual_calls.fetch_add(1, Ordering::AcqRel);
        let moved = move_path_sync(&source.to_string_lossy(), &parent.to_string_lossy())?;
        Ok(Completion {
            value: Some(moved),
            finished,
        })
    });
    entered.recv_timeout(WAIT).unwrap();
    drop(waiter);
    test_reload_buffer_resources(&resources);
    release.send(()).unwrap();
    assert_eq!(
        PathBuf::from(settled.recv_timeout(WAIT).unwrap()),
        destination
    );
    assert_eq!(
        std::fs::read_to_string(&destination).unwrap(),
        "original move body\r\n"
    );
    assert!(!original.exists());
    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert!(barrier.try_close_idle_target_admission("A").is_err());
}

#[test]
fn copy_validation_failure_keeps_original_error_and_performs_no_copy() {
    let directory = Directory::new();
    let source = directory.root.join("source.txt");
    let parent = directory.root.join("destination");
    std::fs::write(&source, "original").unwrap();
    std::fs::create_dir(&parent).unwrap();
    let destination = parent.join("source.txt");
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "validation-failure");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let error = tauri::async_runtime::block_on(run_admitted_blocking(admission, move || {
        copy_path_checked(
            &source.to_string_lossy(),
            &parent.to_string_lossy(),
            |_, _| Err("original copy permission failure".into()),
        )
    }))
    .unwrap_err();
    assert_eq!(error, "original copy permission failure");
    assert!(!destination.exists());
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::FailedNativeOperation)
    ));
}

#[test]
fn closed_gate_rejects_attribution_and_missing_observation_before_any_file_effect() {
    let directory = Directory::new();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "closed-file-owner");
    let missing = tauri::ResourceTable::default();
    let _closed = barrier.try_close_idle_target_admission("A").unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    for (index, resource) in [&resources, &missing].into_iter().enumerate() {
        let target = directory.root.join(format!("forbidden-{index}.txt"));
        let effect = target.clone();
        let actual_calls = calls.clone();
        let result = test_admit_window_buffers(resource, Some(&barrier)).and_then(|admission| {
            tauri::async_runtime::block_on(run_admitted_blocking(admission, move || {
                actual_calls.fetch_add(1, Ordering::AcqRel);
                std::fs::write(effect, "must not happen").map_err(|error| error.to_string())
            }))
        });
        assert!(result.is_err());
        assert!(!target.exists());
    }
    assert_eq!(calls.load(Ordering::Acquire), 0);
}

#[test]
fn missing_open_observation_preserves_real_preview_result_but_never_certifies_idle() {
    let directory = Directory::new();
    let path = directory.root.join("preview.txt");
    std::fs::write(&path, "first\r\n  exact second  \r\nthird\r\n").unwrap();
    let barrier = WindowBarrier::new();
    let resources = tauri::ResourceTable::default();
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let lines = tauri::async_runtime::block_on(run_admitted_blocking(admission, move || {
        read_file_preview_sync(&path.to_string_lossy(), 1, Some(2))
    }))
    .unwrap();
    assert_eq!(lines, vec!["  exact second  "]);
    assert!(barrier.try_close_idle_target_admission("A").is_err());
}
