//! Counting and bulk deletion of the saved conversations filed under a project.
//! Removing a project must not load full summaries (each one runs git and
//! provenance projection work) or pay one IPC round trip per conversation.
use super::{delete_with_images, validate_id, SessionStore};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Largest id list one call accepts, so a single call holds the native write
/// lane for a bounded time and the caller can report progress between calls.
const MAX_DELETE_BATCH: usize = 500;

/// The rows a project lists. `list_by_project_with_git` uses the same rule, so
/// counting and deleting never reach a conversation the project does not show.
pub(super) const LISTED_IN_PROJECT: &str = "cwd = ?1
           AND has_user_message = 1
           AND id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)
           AND id NOT IN (SELECT session_id FROM orchestration_workers) AND NOT EXISTS (SELECT 1 FROM delegated_session_ids d WHERE d.id=sessions.id)";

/// Ids only: no git lookup and no per-row projection.
fn listed_ids(conn: &Connection, cwd: &str) -> rusqlite::Result<Vec<String>> {
    conn.prepare(&format!(
        "SELECT id FROM sessions WHERE {LISTED_IN_PROJECT} ORDER BY id"
    ))?
    .query_map(params![cwd], |row| row.get(0))?
    .collect()
}

/// Whether the row is still listed under exactly this project.
pub(super) fn is_listed_in_project(
    conn: &Connection,
    cwd: &str,
    session_id: &str,
) -> rusqlite::Result<bool> {
    conn.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?2 AND {LISTED_IN_PROJECT})"),
        params![cwd, session_id],
        |row| row.get(0),
    )
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteFailure {
    session_id: String,
    error: String,
}

/// Every id lands in exactly one list, so a caller can settle each one.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteOutcome {
    deleted: Vec<String>,
    /// No longer listed under the project (gone, moved or reclassified): untouched.
    skipped: Vec<String>,
    /// The first failure. The batch stops there; later ids were not attempted.
    failed: Option<ProjectDeleteFailure>,
    not_attempted: Vec<String>,
}

fn delete_listed(
    store: &SessionStore,
    cwd: &str,
    session_ids: Vec<String>,
    cleanup: impl FnOnce(&[String]) -> Result<(), String>,
) -> (Result<ProjectDeleteOutcome, String>, Result<(), ()>) {
    let mut observation = Ok(());
    let mut outcome = ProjectDeleteOutcome::default();
    let mut images = Vec::new();
    let mut remaining = session_ids.into_iter();
    for session_id in remaining.by_ref() {
        match delete_with_images::delete_row(
            store,
            &session_id,
            Vec::new(),
            false,
            Some(cwd),
            &mut observation,
        ) {
            Ok(Some(paths)) => {
                images.extend(paths);
                outcome.deleted.push(session_id);
            }
            Ok(None) => outcome.skipped.push(session_id),
            Err(error) => {
                outcome.failed = Some(ProjectDeleteFailure { session_id, error });
                break;
            }
        }
    }
    outcome.not_attempted = remaining.collect();
    // One pass for the whole batch: finding unreferenced files parses every
    // stored transcript, which per conversation would be quadratic.
    images.sort();
    images.dedup();
    delete_with_images::clean_images(store, images, cleanup, &mut observation);
    (Ok(outcome), observation)
}

#[tauri::command]
pub async fn session_ids_by_project(app: AppHandle, cwd: String) -> Result<Vec<String>, String> {
    crate::harness::run_blocking("session_ids_by_project", move || {
        if cwd.trim().is_empty() {
            return Err("cwd is required".into());
        }
        let store = app.state::<SessionStore>();
        store.with_read_conn(|conn| listed_ids(conn, &cwd).map_err(|error| error.to_string()))
    })
    .await
}

/// Deletes the listed conversations that are still filed under `cwd`, each in
/// its own transaction with the same authority and tombstone rules as
/// `session_delete`. A failure is reported with what was already deleted.
#[tauri::command]
pub async fn session_delete_by_project(
    window: tauri::Window,
    app: AppHandle,
    cwd: String,
    session_ids: Vec<String>,
) -> Result<ProjectDeleteOutcome, String> {
    crate::harness::run_blocking("session_delete_by_project", move || {
        if cwd.trim().is_empty() {
            return Err("cwd is required".into());
        }
        if session_ids.len() > MAX_DELETE_BATCH {
            return Err(format!("At most {MAX_DELETE_BATCH} conversations per call"));
        }
        // Reject the whole call before deleting anything when an id is malformed.
        for session_id in &session_ids {
            validate_id(session_id, "session")?;
        }
        let store = app.state::<SessionStore>();
        crate::native_window_lifecycle::persistence_write_observed(&window, || {
            let cleanup = |paths: &[String]| crate::fs::delete_generated_images_sync(&app, paths);
            let result = delete_listed(&store, &cwd, session_ids, cleanup);
            if result
                .0
                .as_ref()
                .is_ok_and(|outcome| !outcome.deleted.is_empty())
            {
                let _ = app.emit(crate::reminders::CHANGED, ());
            }
            result
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::{get_session, upsert_session, SessionUpsert};
    use serde_json::json;
    use std::cell::RefCell;

    fn session(id: &str, cwd: &str, blocks: serde_json::Value) -> SessionUpsert {
        SessionUpsert {
            preserve_activity_at: false,
            managed_by: None,
            id: id.into(),
            cwd: cwd.into(),
            harness: "codex".into(),
            model: "test-only".into(),
            model_settings: json!({}),
            runtime_mode: "supervised".into(),
            title: id.into(),
            provider_session_id: None,
            provider_account_id: None,
            blocks,
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

    fn chat(id: &str, cwd: &str) -> SessionUpsert {
        session(
            id,
            cwd,
            json!([{"id": "u", "role": "user", "text": "hello"}]),
        )
    }

    fn chat_with_image(id: &str, cwd: &str, path: &str) -> SessionUpsert {
        session(
            id,
            cwd,
            json!([
                {"id": "u", "role": "user", "text": "hello"},
                {"id": "i", "role": "image", "image": {"path": path}}
            ]),
        )
    }

    fn seed(store: &SessionStore, rows: &[SessionUpsert]) {
        let conn = store.lock_conn().unwrap();
        for row in rows {
            upsert_session(&conn, row).unwrap();
        }
    }

    fn exists(store: &SessionStore, id: &str) -> bool {
        get_session(&store.lock_conn().unwrap(), id)
            .unwrap()
            .is_some()
    }

    #[test]
    fn ids_follow_the_project_list_rule_and_the_exact_path() {
        let store = SessionStore::open_in_memory().unwrap();
        seed(
            &store,
            &[
                chat("listed-a", "/isolated/project"),
                chat("listed-b", "/isolated/project"),
                chat("other-project", "/isolated/project-copy"),
                session("blank-draft", "/isolated/project", json!([])),
            ],
        );
        let ids = listed_ids(&store.lock_conn().unwrap(), "/isolated/project").unwrap();
        assert_eq!(ids, ["listed-a", "listed-b"]);
        assert!(
            is_listed_in_project(&store.lock_conn().unwrap(), "/isolated/project", "listed-a")
                .unwrap()
        );
        assert!(!is_listed_in_project(
            &store.lock_conn().unwrap(),
            "/isolated/project",
            "other-project"
        )
        .unwrap());
        assert!(!is_listed_in_project(
            &store.lock_conn().unwrap(),
            "/isolated/project",
            "blank-draft"
        )
        .unwrap());
    }

    #[test]
    fn deletes_only_listed_rows_of_the_project_and_cleans_images_once() {
        let store = SessionStore::open_in_memory().unwrap();
        seed(
            &store,
            &[
                chat_with_image("gone-a", "/isolated/project", "/images/shared.png"),
                chat_with_image("gone-b", "/isolated/project", "/images/shared.png"),
                chat_with_image("gone-c", "/isolated/project", "/images/unused.png"),
                chat_with_image("kept-other", "/isolated/project-copy", "/images/shared.png"),
                chat("moved-away", "/isolated/elsewhere"),
            ],
        );
        let cleanups = RefCell::new(Vec::<Vec<String>>::new());
        let (result, observed) = delete_listed(
            &store,
            "/isolated/project",
            ["gone-a", "gone-b", "gone-c", "moved-away", "missing"]
                .map(String::from)
                .to_vec(),
            |paths| {
                cleanups.borrow_mut().push(paths.to_vec());
                Ok(())
            },
        );
        assert_eq!(observed, Ok(()));
        let outcome = result.unwrap();
        assert_eq!(outcome.deleted, ["gone-a", "gone-b", "gone-c"]);
        assert_eq!(outcome.skipped, ["moved-away", "missing"]);
        assert_eq!(outcome.failed, None);
        assert!(outcome.not_attempted.is_empty());
        assert!(
            !exists(&store, "gone-a") && !exists(&store, "gone-b") && !exists(&store, "gone-c")
        );
        // Another project keeps its row and the image it still references.
        assert!(exists(&store, "kept-other") && exists(&store, "moved-away"));
        assert_eq!(
            &*cleanups.borrow(),
            &[vec!["/images/unused.png".to_string()]]
        );
    }

    #[test]
    fn a_failure_stops_the_batch_and_reports_what_was_deleted() {
        let store = SessionStore::open_in_memory().unwrap();
        seed(
            &store,
            &[
                chat("first", "/isolated/project"),
                chat("second", "/isolated/project"),
                chat("third", "/isolated/project"),
            ],
        );
        // An id the store refuses fails after `first` was already deleted.
        let (result, _) = delete_listed(
            &store,
            "/isolated/project",
            ["first", "not a valid id", "third"]
                .map(String::from)
                .to_vec(),
            |_| Ok(()),
        );
        let outcome = result.unwrap();
        assert_eq!(outcome.deleted, ["first"]);
        assert_eq!(
            outcome.failed.map(|failure| failure.session_id),
            Some("not a valid id".to_string())
        );
        assert_eq!(outcome.not_attempted, ["third"]);
        assert!(!exists(&store, "first"));
        assert!(exists(&store, "second") && exists(&store, "third"));
    }

    #[test]
    fn a_failed_image_cleanup_keeps_the_deletions_and_withholds_idle() {
        let store = SessionStore::open_in_memory().unwrap();
        seed(
            &store,
            &[chat_with_image(
                "gone",
                "/isolated/project",
                "/images/unused.png",
            )],
        );
        let (result, observed) =
            delete_listed(&store, "/isolated/project", vec!["gone".into()], |_| {
                Err("cleanup failure".into())
            });
        assert_eq!(result.unwrap().deleted, ["gone"]);
        assert_eq!(observed, Err(()));
        assert!(!exists(&store, "gone"));
    }
}
