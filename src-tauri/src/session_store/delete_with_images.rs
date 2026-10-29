//! Authoritative session deletion and its separately observed asset cleanup.
use super::{
    cleanup_unreferenced_generated_images, delete_session, generated_image_paths, get_session,
    validate_id, SessionStore,
};

pub(super) fn run(
    store: &SessionStore,
    session_id: &str,
    mut image_paths: Vec<String>,
    cleanup: impl FnOnce(&[String]) -> Result<(), String>,
) -> (Result<(), String>, Result<(), ()>) {
    let mut observation = Ok(());
    let result = (|| {
        validate_id(session_id, "session")?;
        let conn = store.conn.lock().map_err(|_| "Session store is locked")?;
        let persisted_paths = match get_session(&conn, session_id) {
            Ok(record) => record
                .map(|record| generated_image_paths(&record.blocks))
                .unwrap_or_default(),
            Err(_) => {
                observation = Err(());
                Vec::new()
            }
        };
        image_paths.extend(persisted_paths);
        delete_session(&conn, session_id).map_err(|error| error.to_string())?;
        if !image_paths.is_empty() {
            if let Err(error) = cleanup_unreferenced_generated_images(&conn, &image_paths, cleanup)
            {
                observation = Err(());
                eprintln!("Generated image cleanup will need a retry: {error}");
            }
        }
        Ok(())
    })();
    // The connection/cleanup reservation is released before any native finish.
    (result, observation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_window_lifecycle::{test_admit_window_buffers, test_buffer_resources};
    use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
    use crate::session_store::{upsert_session, SessionUpsert};
    use serde_json::json;

    fn session(id: &str, image_paths: &[&str]) -> SessionUpsert {
        SessionUpsert {
            id: id.into(),
            cwd: "/isolated/delete-regression".into(),
            harness: "codex".into(),
            model: "test-only".into(),
            model_settings: json!({}),
            runtime_mode: "supervised".into(),
            title: id.into(),
            provider_session_id: None,
            provider_account_id: None,
            blocks: json!(image_paths.iter().enumerate().map(|(index, path)| {
                json!({"id": format!("image-{index}"), "role": "image", "image": {"path": path}})
            }).collect::<Vec<_>>()),
            context_used: None,
            context_window: None,
            branch: None,
            worktree_cwd: None,
            workspace_mode: None,
            workspace_id: None,
            workspace_revision: None,
            worktree_removed: false,
            linked_work_item: None,
            automation_id: None,
            rewind_history: None,
            pending_context_replay: None,
            adopted_divergence: None,
            adopted_base: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn authoritative_delete_with_failed_cleanup_keeps_success_but_withholds_idle() {
        let store = SessionStore::open_in_memory().unwrap();
        upsert_session(
            &store.lock_conn().unwrap(),
            &session("deleted", &["/images/unused.png"]),
        )
        .unwrap();
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "session-cleanup");
        let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
        let (result, observed) = run(&store, "deleted", vec![], |paths| {
            assert_eq!(paths, &["/images/unused.png"]);
            assert!(matches!(
                barrier.try_close_idle_target_admission("A"),
                Err(BarrierError::PendingNativeOperations)
            ));
            Err("original cleanup failure".into())
        });
        assert_eq!(result, Ok(()));
        assert_eq!(observed, Err(()));
        assert!(store.conn.try_lock().is_ok());
        assert!(get_session(&store.lock_conn().unwrap(), "deleted")
            .unwrap()
            .is_none());
        assert_eq!(admission.finish_observed(result, observed), Ok(()));
        assert!(matches!(
            barrier.try_close_idle_target_admission("A"),
            Err(BarrierError::FailedNativeOperation)
        ));
    }

    #[test]
    fn unreadable_original_snapshot_does_not_hide_deleted_row_or_supply_idle_proof() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            upsert_session(&conn, &session("corrupt", &[])).unwrap();
            conn.execute(
                "UPDATE sessions SET model_settings='invalid-json' WHERE id='corrupt'",
                [],
            )
            .unwrap();
            assert!(get_session(&conn, "corrupt").is_err());
        }
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "corrupt-session");
        let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
        let (result, observed) = run(&store, "corrupt", vec![], |_| {
            panic!("unknown original images must not invent cleanup work")
        });
        assert_eq!(result, Ok(()));
        assert_eq!(observed, Err(()));
        assert!(get_session(&store.lock_conn().unwrap(), "corrupt")
            .unwrap()
            .is_none());
        assert_eq!(admission.finish_observed(result, observed), Ok(()));
        assert!(matches!(
            barrier.try_close_idle_target_admission("A"),
            Err(BarrierError::FailedNativeOperation)
        ));
    }

    #[test]
    fn discovered_images_respect_surviving_references_and_keep_original_work_pending() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            upsert_session(
                &conn,
                &session("deleted", &["/images/shared.png", "/images/unused.png"]),
            )
            .unwrap();
            upsert_session(&conn, &session("survivor", &["/images/shared.png"])).unwrap();
        }
        let barrier = WindowBarrier::new();
        let resources = test_buffer_resources(&barrier, "session-images");
        let admission = test_admit_window_buffers(&resources, Some(&barrier)).unwrap();
        let (result, observed) = run(&store, "deleted", vec![], |paths| {
            assert_eq!(paths, &["/images/unused.png"]);
            assert!(matches!(
                barrier.try_close_idle_target_admission("A"),
                Err(BarrierError::PendingNativeOperations)
            ));
            Ok(())
        });
        assert_eq!(result, Ok(()));
        assert_eq!(observed, Ok(()));
        assert!(store.conn.try_lock().is_ok());
        assert!(get_session(&store.lock_conn().unwrap(), "survivor")
            .unwrap()
            .is_some());
        assert_eq!(admission.finish_observed(result, observed), Ok(()));
        assert!(barrier.try_close_idle_target_admission("A").is_ok());
    }
}
