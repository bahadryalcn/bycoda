//! Actual Control SQL/scratch bodies behind resource-owned Native admission.
use super::*;
use crate::native_window_lifecycle::{
    test_admit_window_buffers, test_buffer_resources, test_persistence_write,
};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use crate::session_store::SessionStore;
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};

const OWNER: &str = "original-control-window";
const WAIT: Duration = Duration::from_secs(5);

struct Fixture {
    base: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("temp/verification/2026-10-30-native-buffer-continuation/control/fixtures");
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(format!("control-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self { base, root }
    }
    fn store(&self) -> SessionStore {
        SessionStore::open(self.root.join("sessions.db")).unwrap()
    }
    fn host(&self) -> ControlHost {
        let mut inner = Inner::default();
        inner.grants.insert(
            "lead".into(),
            Grant {
                window: OWNER.into(),
                session: "lead".into(),
                cwd: comparison_path(&self.root),
                token: "fixture-only-control-token".into(),
                generation: uuid::Uuid::new_v4().to_string(),
                issuer: None,
            },
        );
        inner.prepare_app_grant("worker", OWNER, &comparison_path(&self.root));
        ControlHost {
            endpoint: "fixture-only-no-listener".into(),
            inner: Arc::new(Mutex::new(inner)),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let target = self.root.canonicalize().unwrap();
        assert_eq!(target.parent(), Some(self.base.as_path()));
        assert!(target
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("control-"));
        std::fs::remove_dir_all(target).unwrap();
    }
}

fn state(worker: &str, title: &str) -> String {
    json!({
        "status": "active", "original": "  exact\r\n漢🦀\n",
        "tasks": [{"sessionId":worker,"title":title,"harness":"codex","model":"original","status":"queued"}]
    })
    .to_string()
}

fn snapshot(store: &SessionStore) -> Vec<Vec<(String, String)>> {
    let conn = store.lock_conn().unwrap();
    [
        "SELECT lead_id,state FROM orchestration_runs ORDER BY lead_id",
        "SELECT session_id,lead_id FROM orchestration_workers ORDER BY session_id",
        "SELECT lead_id,summary FROM orchestration_sidebar ORDER BY lead_id",
    ]
    .into_iter()
    .map(|sql| {
        conn.prepare(sql)
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    })
    .collect()
}

#[test]
fn closed_global_save_refuses_before_parse_and_preserves_all_three_sql_indexes() {
    let fixture = Fixture::new();
    let store = fixture.store();
    control_save_with(&store, "lead", &state("original-worker", "Original")).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let closed = barrier.close_target_admission("unrelated-session").unwrap();
    let entered = Cell::new(false);
    let result = test_persistence_write(&resources, Some(&barrier), || {
        entered.set(true);
        control_save_with(&store, "lead", "invalid JSON")
    });
    assert!(result.is_err());
    assert!(!entered.get());
    assert_eq!(snapshot(&store), before);
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn successful_save_preserves_exact_state_and_existing_worker_index_semantics() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    for input in [
        state("earlier-worker", "Earlier"),
        state("worker", "  exact title\r\n"),
    ] {
        test_persistence_write(&resources, Some(&barrier), || {
            control_save_with(&store, "lead", &input)
        })
        .unwrap();
        assert!(store.test_connection_unlocked());
    }
    let rows = snapshot(&store);
    let saved: Value = serde_json::from_str(&rows[0][0].1).unwrap();
    assert_eq!(
        saved,
        serde_json::from_str::<Value>(&state("worker", "  exact title\r\n")).unwrap()
    );
    assert_eq!(
        rows[1],
        vec![
            ("earlier-worker".into(), "lead".into()),
            ("worker".into(), "lead".into())
        ]
    );
    let summary: Value = serde_json::from_str(&rows[2][0].1).unwrap();
    assert_eq!(summary["tasks"][0]["title"], "  exact title\r\n");
    assert_eq!(summary["tasks"][0]["sessionId"], "worker");
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn real_sql_abort_rolls_back_run_worker_and_sidebar_and_withholds_idle() {
    let fixture = Fixture::new();
    let store = fixture.store();
    control_save_with(&store, "lead", &state("original-worker", "Original")).unwrap();
    store.lock_conn().unwrap().execute_batch(
        "CREATE TRIGGER reject_control_sidebar BEFORE INSERT ON orchestration_sidebar BEGIN SELECT RAISE(ABORT, 'original Control SQL failure'); END;",
    ).unwrap();
    let before = snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let result = test_persistence_write(&resources, Some(&barrier), || {
        control_save_with(&store, "lead", &state("new-worker", "New"))
    });
    assert_eq!(result.unwrap_err(), "original Control SQL failure");
    assert_eq!(snapshot(&store), before);
    assert!(store.test_connection_unlocked());
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn original_sql_transaction_outlives_dropped_waiter_and_commits_during_closure_once() {
    let fixture = Fixture::new();
    let store = Arc::new(fixture.store());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let fresh = test_buffer_resources(&barrier, "fresh-control-window");
    let (inside_sql, sql_started) = mpsc::channel();
    let (release_sql, sql_release) = mpsc::channel();
    let writes = Arc::new(AtomicUsize::new(0));
    let observed = writes.clone();
    store
        .lock_conn()
        .unwrap()
        .update_hook(Some(move |_, _: &str, table: &str, _| {
            if table == "orchestration_sidebar" {
                observed.fetch_add(1, Ordering::SeqCst);
                inside_sql.send(()).unwrap();
                sql_release.recv_timeout(WAIT).unwrap();
            }
        }))
        .unwrap();
    let (result, waiter) = mpsc::channel();
    let actual_store = store.clone();
    let actual_barrier = barrier.clone();
    let worker = std::thread::spawn(move || {
        let actual = test_persistence_write(&resources, Some(&actual_barrier), || {
            control_save_with(&actual_store, "lead", &state("worker", "Original accepted"))
        });
        assert!(actual_store.test_connection_unlocked());
        let _ = result.send(actual);
    });
    sql_started.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    let closed = barrier.close_target_admission("cut").unwrap();
    assert!(test_persistence_write::<()>(&fresh, Some(&barrier), || {
        panic!("a fresh save must not reach SQL")
    })
    .is_err());
    release_sql.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(writes.load(Ordering::SeqCst), 1);
    let rows = snapshot(&store);
    assert_eq!(rows[0].len(), 1);
    assert_eq!(rows[1], vec![("worker".into(), "lead".into())]);
    barrier.reopen_target_admission(closed).unwrap();
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn closed_attach_creates_no_scratch_or_worker_authority() {
    let fixture = Fixture::new();
    let host = fixture.host();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let closed = barrier.close_target_admission("unrelated-session").unwrap();
    let entered = Cell::new(false);
    let result = test_admit_window_buffers(&resources, Some(&barrier)).and_then(|admission| {
        admission.finish(control_attach_worker_with(
            &host,
            OWNER,
            "lead".into(),
            "worker".into(),
            || {
                entered.set(true);
                create_worker_scratch_in(&fixture.root)
            },
        ))
    });
    assert!(result.is_err());
    assert!(!entered.get());
    assert_eq!(std::fs::read_dir(&fixture.root).unwrap().count(), 0);
    let inner = host.inner.lock().unwrap();
    assert!(inner.workers.is_empty() && inner.scratch.is_empty());
    assert!(inner.app_grants.contains_key("worker"));
    drop(inner);
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn attach_preserves_actual_lead_window_check_private_scope_and_same_worker_retry() {
    let fixture = Fixture::new();
    let host = fixture.host();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let created = Cell::new(0);
    let create = || {
        created.set(created.get() + 1);
        create_worker_scratch_in(&fixture.root)
    };
    let original = test_admit_window_buffers(&resources, Some(&barrier))
        .unwrap()
        .finish(control_attach_worker_with(
            &host,
            OWNER,
            "lead".into(),
            "worker".into(),
            create,
        ))
        .unwrap();
    let retried = test_admit_window_buffers(&resources, Some(&barrier))
        .unwrap()
        .finish(control_attach_worker_with(
            &host,
            OWNER,
            "lead".into(),
            "worker".into(),
            create,
        ))
        .unwrap();
    assert_eq!(original, retried);
    assert_eq!(created.get(), 1);
    let scratch = PathBuf::from(original);
    assert_eq!(scratch.parent(), Some(fixture.root.as_path()));
    assert!(scratch.is_dir());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&scratch).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    let denied = control_attach_worker_with(
        &host,
        "foreign-window",
        "lead".into(),
        "foreign-worker".into(),
        create,
    );
    assert_eq!(denied.unwrap_err(), "Lead connection is inactive");
    assert_eq!(created.get(), 1);
    let inner = host.inner.lock().unwrap();
    assert_eq!(
        inner.workers.get("worker").map(String::as_str),
        Some("lead")
    );
    assert!(!inner.app_grants.contains_key("worker"));
    assert_eq!(inner.scratch.get("worker"), Some(&scratch));
    assert!(!inner.workers.contains_key("foreign-worker"));
    drop(inner);
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn actual_scratch_creation_failure_preserves_grants_and_withholds_idle() {
    let fixture = Fixture::new();
    let host = fixture.host();
    let blocker = fixture.root.join("not-a-directory");
    std::fs::write(&blocker, b"fixture-owned blocker").unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let result = test_admit_window_buffers(&resources, Some(&barrier))
        .unwrap()
        .finish(control_attach_worker_with(
            &host,
            OWNER,
            "lead".into(),
            "worker".into(),
            || create_worker_scratch_in(&blocker),
        ));
    assert!(result.is_err());
    let inner = host.inner.lock().unwrap();
    assert!(inner.workers.is_empty() && inner.scratch.is_empty());
    assert!(inner.app_grants.contains_key("worker"));
    drop(inner);
    assert_eq!(std::fs::read(&blocker).unwrap(), b"fixture-owned blocker");
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn accepted_attach_keeps_original_buffers_admission_through_real_creation_after_waiter_drop() {
    let fixture = Fixture::new();
    let host = Arc::new(fixture.host());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, OWNER);
    let fresh = test_buffer_resources(&barrier, "fresh-control-window");
    let (creating, started) = mpsc::channel();
    let (release, allowed) = mpsc::channel();
    let (result, waiter) = mpsc::channel();
    let actual_host = host.clone();
    let actual_barrier = barrier.clone();
    let root = fixture.root.clone();
    let worker = std::thread::spawn(move || {
        let admission = test_admit_window_buffers(&resources, Some(&actual_barrier)).unwrap();
        let actual = admission.finish(control_attach_worker_with(
            &actual_host,
            OWNER,
            "lead".into(),
            "worker".into(),
            || {
                creating.send(()).unwrap();
                allowed.recv_timeout(WAIT).unwrap();
                create_worker_scratch_in(&root)
            },
        ));
        assert!(actual.is_ok());
        assert!(actual_host.inner.try_lock().is_ok());
        let _ = result.send(actual);
    });
    started.recv_timeout(WAIT).unwrap();
    drop(waiter);
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    let closed = barrier.close_target_admission("cut").unwrap();
    assert!(test_admit_window_buffers(&fresh, Some(&barrier)).is_err());
    assert_eq!(std::fs::read_dir(&fixture.root).unwrap().count(), 0);
    release.send(()).unwrap();
    worker.join().unwrap();
    let inner = host.inner.lock().unwrap();
    assert_eq!(
        inner.workers.get("worker").map(String::as_str),
        Some("lead")
    );
    assert!(inner.scratch.get("worker").unwrap().is_dir());
    assert_eq!(std::fs::read_dir(&fixture.root).unwrap().count(), 1);
    drop(inner);
    barrier.reopen_target_admission(closed).unwrap();
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}
