//! Notes production boundaries with the real native resource admission/SQL/I/O.
//! No app profile, WebView, provider or caller-selected owner is constructed.
use super::*;
use crate::native_window_lifecycle::{
    test_admit_window_buffers, test_buffer_resources, test_reload_buffer_resources,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);

fn input(id: &str) -> NoteUpsert {
    NoteUpsert {
        expected_updated_at: Some(0),
        id: id.into(),
        title: "Original note".into(),
        body: "  original\r\n漢🦀\n".into(),
        tags: vec!["Exact".into()],
        source_session_id: None,
        source_cwd: None,
        finalize_slug: false,
    }
}

struct Directory {
    base: PathBuf,
    root: PathBuf,
}
impl Directory {
    fn new() -> Self {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-29-buffer-actors-notes-native/fixtures");
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(format!("notes-admission-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self { base, root }
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        if let Ok(root) = self.root.canonicalize() {
            assert_eq!(root.parent(), Some(self.base.as_path()));
            assert!(root.starts_with(&self.base));
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}

#[test]
fn closed_native_window_refuses_notes_before_sql_effects_even_for_other_session_metadata() {
    let store = SessionStore::open_in_memory().unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes");
    let closed = barrier.close_target_admission("A").unwrap();
    let calls = std::cell::Cell::new(0);
    let mut value = input("closed");
    value.source_session_id = Some("B".into());
    let result = (|| {
        let admission = test_admit_window_buffers(&resources, Some(&barrier))?;
        with_admitted_note_connection(admission, &store, |conn| {
            calls.set(calls.get() + 1);
            checked_upsert_note(conn, &value)
        })
    })();
    assert!(result.is_err());
    assert_eq!(calls.get(), 0);
    assert!(get_note(&store.lock_conn().unwrap(), "closed")
        .unwrap()
        .is_none());
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn admitted_explicit_session_link_preserves_note_content_and_data_association() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = checked_upsert_note(&store.lock_conn().unwrap(), &input("linked")).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-link");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let linked = with_admitted_note_connection(admission, &store, |conn| {
        link_note_session(conn, &original.id, "B").map_err(|error| error.to_string())
    })
    .unwrap();
    assert_eq!(linked.source_session_id.as_deref(), Some("B"));
    assert_eq!(linked.body, original.body);
    assert_eq!(linked.slug, original.slug);
    assert_eq!(linked.content_updated_at, original.content_updated_at);
    assert!(linked.updated_at > original.updated_at);
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn notes_sql_lock_wait_is_already_admitted_and_finishes_with_actual_cas_result() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let conn = store.lock_conn().unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-sql");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let (started, entered) = mpsc::channel();
    let target = store.clone();
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        with_admitted_note_connection(admission, &target, |conn| {
            checked_upsert_note(conn, &input("blocked-sql"))
        })
    });
    entered.recv_timeout(WAIT).unwrap();
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::PendingNativeOperations)
    ));
    assert!(get_note(&conn, "blocked-sql").unwrap().is_none());
    drop(conn);
    let actual = worker.join().unwrap().unwrap();
    assert_eq!(actual.body, "  original\n漢🦀\n");
    assert_eq!(
        get_note(&store.lock_conn().unwrap(), "blocked-sql")
            .unwrap()
            .unwrap()
            .updated_at,
        actual.updated_at
    );
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn admitted_stale_note_save_keeps_exact_conflict_and_original_sql_without_retry() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = checked_upsert_note(&store.lock_conn().unwrap(), &input("stale")).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-cas");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let mut stale = input("stale");
    stale.body = "must not replace original".into();
    let actual =
        with_admitted_note_connection(admission, &store, |conn| checked_upsert_note(conn, &stale));
    assert_eq!(
        actual.unwrap_err(),
        "This note changed elsewhere. Your draft is preserved; refresh before retrying."
    );
    let kept = get_note(&store.lock_conn().unwrap(), "stale")
        .unwrap()
        .unwrap();
    assert_eq!(kept.body, original.body);
    assert_eq!(kept.updated_at, original.updated_at);
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::FailedNativeOperation)
    ));
}

#[test]
fn delete_releases_sql_lock_but_stays_admitted_through_actual_asset_cleanup() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let original = checked_upsert_note(&store.lock_conn().unwrap(), &input("delete")).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-cleanup");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let (read, received) = mpsc::channel();
    let reader_store = store.clone();
    let reader_barrier = barrier.clone();
    let (begin, ready) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        ready.recv_timeout(WAIT).unwrap();
        let conn = reader_store.lock_conn().unwrap();
        assert!(get_note(&conn, "delete").unwrap().is_none());
        assert!(matches!(
            reader_barrier.try_close_idle_target_admission("A"),
            Err(BarrierError::PendingNativeOperations)
        ));
        read.send(()).unwrap();
    });
    let actual = delete_admitted_note(admission, &store, "delete", original.updated_at, || {
        begin.send(()).map_err(|error| error.to_string())?;
        received
            .recv_timeout(WAIT)
            .map_err(|error| error.to_string())
    });
    reader.join().unwrap();
    assert_eq!(actual, Ok(()));
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn committed_delete_preserves_public_success_when_asset_cleanup_cannot_certify_idle() {
    let store = SessionStore::open_in_memory().unwrap();
    let original =
        checked_upsert_note(&store.lock_conn().unwrap(), &input("delete-failed-assets")).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-failed-cleanup");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let actual = delete_admitted_note(admission, &store, &original.id, original.updated_at, || {
        Err("original cleanup failure after SQL commit".into())
    });
    assert_eq!(actual, Ok(()));
    assert!(get_note(&store.lock_conn().unwrap(), &original.id)
        .unwrap()
        .is_none());
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::FailedNativeOperation)
    ));
}

#[test]
fn admitted_recovery_cleanup_never_removes_a_persisted_notes_assets() {
    let store = SessionStore::open_in_memory().unwrap();
    let original = checked_upsert_note(&store.lock_conn().unwrap(), &input("persisted")).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-recovery");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let result = with_admitted_note_connection(admission, &store, |conn| {
        checked_discard_recovery_assets(conn, &original.id, || panic!("stored assets must survive"))
    });
    assert_eq!(result, Ok(false));
    assert_eq!(
        get_note(&store.lock_conn().unwrap(), &original.id)
            .unwrap()
            .unwrap()
            .body,
        original.body
    );
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn abandoned_recovery_cleanup_keeps_actual_failure_and_no_retry_or_idle_proof() {
    let store = SessionStore::open_in_memory().unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-abandoned-recovery");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let calls = std::cell::Cell::new(0);
    let result = with_admitted_note_connection(admission, &store, |conn| {
        checked_discard_recovery_assets(conn, "abandoned", || {
            calls.set(calls.get() + 1);
            assert!(matches!(
                barrier.try_close_idle_target_admission("A"),
                Err(BarrierError::PendingNativeOperations)
            ));
            Err("original recovery cleanup failure".into())
        })
    });
    assert_eq!(result.unwrap_err(), "original recovery cleanup failure");
    assert_eq!(calls.get(), 1);
    assert!(get_note(&store.lock_conn().unwrap(), "abandoned")
        .unwrap()
        .is_none());
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::FailedNativeOperation)
    ));
}

struct ImageCompletion {
    value: Option<NoteImageAsset>,
    finished: mpsc::Sender<NoteImageAsset>,
}
impl Drop for ImageCompletion {
    fn drop(&mut self) {
        if let Some(value) = self.value.take() {
            let _ = self.finished.send(value);
        }
    }
}

#[test]
fn dropped_note_image_waiter_keeps_copy_and_post_copy_grant_in_the_original_worker() {
    let directory = Directory::new();
    let source = directory.root.join("original.png");
    let bytes = b"original note image fixture bytes";
    std::fs::write(&source, bytes).unwrap();
    let root = directory.root.clone();
    let dir = root.join(NOTE_ASSET_DIR).join("image-note");
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-image");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let (entered, started) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let (finished, settled) = mpsc::channel();
    let calls = Arc::new(AtomicUsize::new(0));
    let effect_calls = calls.clone();
    let waiter = run_admitted_blocking(admission, move || {
        let names = note_image_names(&source)?;
        let value = copy_note_image(&source, &dir, &root, "image-note", names, |target| {
            assert_eq!(std::fs::read(target).unwrap(), bytes);
            effect_calls.fetch_add(1, Ordering::AcqRel);
            entered.send(()).map_err(|error| error.to_string())?;
            held.recv_timeout(WAIT).map_err(|error| error.to_string())
        })?;
        Ok(ImageCompletion {
            value: Some(value),
            finished,
        })
    });
    started.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release.send(()).unwrap();
    let actual = settled.recv_timeout(WAIT).unwrap();
    assert_eq!(actual.name, "original.png");
    assert!(actual.markdown_path.starts_with("/note-assets/image-note/"));
    assert_eq!(
        std::fs::read(
            directory
                .root
                .join(actual.markdown_path.trim_start_matches('/'))
        )
        .unwrap(),
        bytes
    );
    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert!(barrier.try_close_idle_target_admission("A").is_ok());
}

#[test]
fn note_image_grant_failure_preserves_original_error_and_uncertain_copied_asset_without_retry() {
    let directory = Directory::new();
    let source = directory.root.join("original.png");
    std::fs::write(&source, b"copied before grant failure").unwrap();
    let root = directory.root.clone();
    let dir = root.join(NOTE_ASSET_DIR).join("grant-failed");
    let saved_dir = dir.clone();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-image-error");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    let actual = tauri::async_runtime::block_on(run_admitted_blocking(admission, move || {
        let names = note_image_names(&source)?;
        copy_note_image(&source, &dir, &root, "grant-failed", names, |_| {
            Err("original native grant error".into())
        })
    }));
    assert_eq!(actual.unwrap_err(), "original native grant error");
    assert_eq!(std::fs::read_dir(saved_dir).unwrap().count(), 1);
    assert!(matches!(
        barrier.try_close_idle_target_admission("A"),
        Err(BarrierError::FailedNativeOperation)
    ));
}

#[test]
fn original_notes_write_result_survives_owner_reload_without_inheriting_idle_proof() {
    let store = SessionStore::open_in_memory().unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "notes-reloaded");
    let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
    test_reload_buffer_resources(&resources);
    let actual = with_admitted_note_connection(admission, &store, |conn| {
        checked_upsert_note(conn, &input("original-reloaded"))
    })
    .unwrap();
    assert_eq!(actual.body, "  original\n漢🦀\n");
    assert!(get_note(&store.lock_conn().unwrap(), &actual.id)
        .unwrap()
        .is_some());
    assert!(barrier.try_close_idle_target_admission("A").is_err());
}
