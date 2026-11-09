//! Actual SQL and isolated connection-file writers behind Native Persistence admission.
use super::*;
use crate::native_window_lifecycle::{test_buffer_resources, test_persistence_write};
use crate::session_store::window_barrier::{BarrierError, WindowBarrier};
use std::cell::Cell;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(5);

struct Directory {
    base: PathBuf,
    root: PathBuf,
}
impl Directory {
    fn new() -> Self {
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(
            "temp/verification/2026-10-30-native-buffer-continuation/ssh-configuration/fixtures",
        );
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let root = base.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&root).unwrap();
        Self { base, root }
    }
    fn path(&self) -> PathBuf {
        self.root.join("remote-machines.json")
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let root = self.root.canonicalize().unwrap();
        assert_eq!(root.parent(), Some(self.base.as_path()));
        assert!(root.starts_with(&self.base));
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn profile() -> groups::GroupDefaults {
    serde_json::from_value(serde_json::json!({
        "id":"defaults-one", "revision":0, "name":"  Group defaults  ",
        "defaults":{"user":"group-user","port":2222},
        "environment":[{"name":"Z_LAST","value":"last"},{"name":"A_FIRST","value":"漢🦀"}],
        "shellKind":"posix"
    }))
    .unwrap()
}
fn binding() -> groups::Inheritance {
    groups::Inheritance {
        group_id: "defaults-one".into(),
        fields: vec![groups::InheritedField::User, groups::InheritedField::Port],
        environment: true,
    }
}
fn records() -> Vec<Value> {
    vec![
        serde_json::json!({"id":"connection-one","name":"Original server","kind":"ssh",
            "sshEndpoint":{"host":"fixture.invalid","port":22,"user":"local-user"},
            "metadata":{"group":"legacy-label","favorite":true,"tags":["retained"],"future":{"exact":"  漢🦀\r\n"}}}),
        serde_json::json!({"id":"other-server","name":"Other server","kind":"ssh",
            "sshEndpoint":{"host":"other.invalid","port":22},"metadata":{"future":{"keep":true}}}),
    ]
}
fn sql_snapshot(store: &SessionStore) -> Vec<(String, i64, String)> {
    let conn = store.lock_conn().unwrap();
    let mut statement = conn
        .prepare("SELECT id,revision,value FROM ssh_group_defaults ORDER BY id")
        .unwrap();
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>();
    drop(statement);
    drop(conn);
    rows.unwrap()
}
fn review(
    connections: &Mutex<()>,
    store: &SessionStore,
    path: &Path,
    inheritance: Option<&groups::Inheritance>,
) -> groups::Effective {
    let _guard = connections.lock().unwrap();
    let records = remote::read_store_values(path).unwrap();
    effective_with(store, &records[0], inheritance).unwrap()
}
fn change(
    inheritance: Option<groups::Inheritance>,
    expected: Option<groups::Inheritance>,
    digest: String,
) -> ReviewedInheritanceChange {
    ReviewedInheritanceChange {
        connection_id: "connection-one".into(),
        inheritance,
        expected_inheritance: expected,
        expected_configuration_digest: digest,
    }
}

#[test]
fn closed_selected_session_refuses_all_three_global_writers_before_sql_path_or_file_effects() {
    let directory = Directory::new();
    let path = directory.path();
    remote::write_store_values(&path, &records()).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    let saved = group_defaults_save_with(&connections, &store, profile(), None, || {}).unwrap();
    let before_sql = sql_snapshot(&store);
    let before_file = std::fs::read(&path).unwrap();
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let closed = barrier.close_target_admission("unrelated-session").unwrap();
    let effects = Cell::new(0);
    macro_rules! refused {
        ($work:expr) => {
            assert!(test_persistence_write(&resources, Some(&barrier), || {
                effects.set(effects.get() + 1);
                $work
            })
            .is_err());
        };
    }
    refused!(group_defaults_save_with(
        &connections,
        &store,
        saved.clone(),
        Some(saved.revision),
        || {}
    ));
    refused!(group_defaults_remove_with(
        &connections,
        &store,
        || panic!("closed work cannot resolve/read its config path"),
        saved.id,
        saved.revision,
        || {}
    ));
    refused!(inheritance_set_with(
        &connections,
        &store,
        || panic!("closed work cannot resolve/read its config path"),
        change(Some(binding()), None, "unconsumed review".into()),
        || {}
    ));
    assert_eq!(effects.get(), 0);
    assert_eq!(sql_snapshot(&store), before_sql);
    assert_eq!(std::fs::read(&path).unwrap(), before_file);
    barrier.reopen_target_admission(closed).unwrap();
}

#[test]
fn open_three_writer_workflow_preserves_sql_cas_file_metadata_and_unlocked_events() {
    let directory = Directory::new();
    let path = directory.path();
    let original = records();
    remote::write_store_values(&path, &original).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let notifications = Cell::new(0);
    let notify = || {
        assert!(connections.try_lock().is_ok());
        assert!(store.test_connection_unlocked());
        assert!(matches!(
            barrier.try_close_idle_target_admission("cut"),
            Err(BarrierError::PendingNativeOperations)
        ));
        notifications.set(notifications.get() + 1);
    };
    let saved = test_persistence_write(&resources, Some(&barrier), || {
        group_defaults_save_with(&connections, &store, profile(), None, notify)
    })
    .unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(saved.name, "Group defaults");
    assert_eq!(saved.environment[0].name, "A_FIRST");
    let inherited = review(&connections, &store, &path, Some(&binding()));
    test_persistence_write(&resources, Some(&barrier), || {
        inheritance_set_with(
            &connections,
            &store,
            || Ok(path.clone()),
            change(Some(binding()), None, inherited.digest.clone()),
            notify,
        )
    })
    .unwrap();
    let bound = remote::read_store_values(&path).unwrap();
    assert_eq!(selection(&bound[0]).unwrap(), Some(binding()));
    assert_eq!(bound[0]["sshEndpoint"], original[0]["sshEndpoint"]);
    assert_eq!(
        bound[0]["metadata"]["future"],
        original[0]["metadata"]["future"]
    );
    assert_eq!(bound[1], original[1]);
    let local = review(&connections, &store, &path, None);
    test_persistence_write(&resources, Some(&barrier), || {
        inheritance_set_with(
            &connections,
            &store,
            || Ok(path.clone()),
            change(None, Some(binding()), local.digest.clone()),
            notify,
        )
    })
    .unwrap();
    let mut expected = original;
    expected[0]["metadata"]["sshInheritance"] = Value::Null;
    assert_eq!(remote::read_store_values(&path).unwrap(), expected);
    test_persistence_write(&resources, Some(&barrier), || {
        group_defaults_remove_with(
            &connections,
            &store,
            || Ok(path.clone()),
            saved.id.clone(),
            saved.revision,
            notify,
        )
    })
    .unwrap();
    assert!(groups::get(&store.lock_conn().unwrap(), &saved.id)
        .unwrap()
        .is_none());
    assert_eq!(notifications.get(), 4);
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn stale_group_revision_preserves_exact_sql_and_never_emits() {
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    group_defaults_save_with(&connections, &store, profile(), None, || {}).unwrap();
    let before = sql_snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let result = test_persistence_write(&resources, Some(&barrier), || {
        group_defaults_save_with(&connections, &store, profile(), None, || {
            panic!("no failed-save event")
        })
    });
    assert_eq!(
        result.unwrap_err(),
        "SSH group changed or its collection is full; reload before saving"
    );
    assert_eq!(sql_snapshot(&store), before);
}

#[test]
fn referenced_group_refusal_keeps_actual_connection_file_and_sql_rows() {
    let directory = Directory::new();
    let path = directory.path();
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    let saved = group_defaults_save_with(&connections, &store, profile(), None, || {}).unwrap();
    let mut values = records();
    values[0]["metadata"]["sshInheritance"] = serde_json::to_value(binding()).unwrap();
    remote::write_store_values(&path, &values).unwrap();
    let before_file = std::fs::read(&path).unwrap();
    let before_sql = sql_snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let result = test_persistence_write(&resources, Some(&barrier), || {
        group_defaults_remove_with(
            &connections,
            &store,
            || Ok(path.clone()),
            saved.id,
            saved.revision,
            || panic!("no refused-delete event"),
        )
    });
    assert_eq!(
        result.unwrap_err(),
        "This SSH defaults group is still used by a connection"
    );
    assert_eq!(std::fs::read(&path).unwrap(), before_file);
    assert_eq!(sql_snapshot(&store), before_sql);
}

#[test]
fn sql_abort_keeps_original_error_and_rolls_back_without_notification() {
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    store.lock_conn().unwrap().execute_batch(
        "CREATE TRIGGER fail_defaults BEFORE INSERT ON ssh_group_defaults BEGIN SELECT RAISE(ABORT, 'original defaults SQL failure'); END;"
    ).unwrap();
    let before = sql_snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let result = test_persistence_write(&resources, Some(&barrier), || {
        group_defaults_save_with(&connections, &store, profile(), None, || {
            panic!("no failed SQL event")
        })
    });
    assert_eq!(result.unwrap_err(), "original defaults SQL failure");
    assert_eq!(sql_snapshot(&store), before);
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn stale_review_digest_does_not_write_file_or_overwrite_changed_group() {
    let directory = Directory::new();
    let path = directory.path();
    remote::write_store_values(&path, &records()).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    let mut saved = group_defaults_save_with(&connections, &store, profile(), None, || {}).unwrap();
    let old = review(&connections, &store, &path, Some(&binding()));
    saved.defaults.port = Some(2200);
    let revision = saved.revision;
    group_defaults_save_with(&connections, &store, saved, Some(revision), || {}).unwrap();
    let before_file = std::fs::read(&path).unwrap();
    let before_sql = sql_snapshot(&store);
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let result = test_persistence_write(&resources, Some(&barrier), || {
        inheritance_set_with(
            &connections,
            &store,
            || Ok(path.clone()),
            change(Some(binding()), None, old.digest),
            || panic!("no stale-review event"),
        )
    });
    assert_eq!(
        result.unwrap_err(),
        "SSH defaults or connection changed. Request a new preview"
    );
    assert_eq!(std::fs::read(&path).unwrap(), before_file);
    assert_eq!(sql_snapshot(&store), before_sql);
}

#[test]
fn malformed_config_refuses_original_write_without_replacing_unknown_bytes() {
    let directory = Directory::new();
    let path = directory.path();
    let original = b"  original unreadable config \r\n";
    std::fs::write(&path, original).unwrap();
    let store = SessionStore::open_in_memory().unwrap();
    let connections = Mutex::new(());
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let result = test_persistence_write(&resources, Some(&barrier), || {
        inheritance_set_with(
            &connections,
            &store,
            || Ok(path.clone()),
            change(None, None, String::new()),
            || panic!("no unknown-file event"),
        )
    });
    assert_eq!(result.unwrap_err(), "Remote connection store is invalid");
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(barrier.try_close_idle_target_admission("cut").is_err());
}

#[test]
fn accepted_sql_writer_keeps_original_store_order_and_admission_through_unlocked_notification() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let connections = Arc::new(Mutex::new(()));
    let conn = store.lock_conn().unwrap(); // The admitted worker must wait AFTER taking the store lock.
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let (entered, accepted) = mpsc::channel();
    let (notify, notified) = mpsc::channel();
    let (release_notify, notify_release) = mpsc::channel();
    let (result, waiter) = mpsc::channel();
    let actual_store = store.clone();
    let actual_connections = connections.clone();
    let actual_barrier = barrier.clone();
    let worker = std::thread::spawn(move || {
        let outcome = test_persistence_write(&resources, Some(&actual_barrier), || {
            entered.send(()).unwrap();
            group_defaults_save_with(&actual_connections, &actual_store, profile(), None, || {
                assert!(actual_connections.try_lock().is_ok());
                assert!(actual_store.test_connection_unlocked());
                notify.send(()).unwrap();
                notify_release.recv_timeout(WAIT).unwrap();
            })
        });
        let _ = result.send(outcome);
    });
    accepted.recv_timeout(WAIT).unwrap();
    drop(waiter);
    // While SQL is held here, the actual worker must first own the store mutex.
    let deadline = std::time::Instant::now() + WAIT;
    loop {
        match connections.try_lock() {
            Err(std::sync::TryLockError::WouldBlock) => break,
            Err(std::sync::TryLockError::Poisoned(_)) => panic!("store mutex poisoned"),
            Ok(guard) => drop(guard),
        }
        assert!(
            std::time::Instant::now() < deadline,
            "writer did not acquire the store before SQL"
        );
        std::thread::yield_now();
    }
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    drop(conn);
    notified.recv_timeout(WAIT).unwrap();
    assert_eq!(sql_snapshot(&store).len(), 1);
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release_notify.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(sql_snapshot(&store).len(), 1);
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}

#[test]
fn accepted_real_config_write_and_post_unlock_event_outlive_their_public_waiter() {
    let directory = Directory::new();
    let path = directory.path();
    remote::write_store_values(&path, &records()).unwrap();
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let connections = Arc::new(Mutex::new(()));
    group_defaults_save_with(&connections, &store, profile(), None, || {}).unwrap();
    let expected = review(&connections, &store, &path, Some(&binding()));
    let barrier = WindowBarrier::new();
    let resources = test_buffer_resources(&barrier, "configuration-window");
    let (notify, notified) = mpsc::channel();
    let (release, continuation) = mpsc::channel();
    let (result, waiter) = mpsc::channel();
    let actual_store = store.clone();
    let actual_connections = connections.clone();
    let actual_barrier = barrier.clone();
    let actual_path = path.clone();
    let worker = std::thread::spawn(move || {
        let outcome = test_persistence_write(&resources, Some(&actual_barrier), || {
            inheritance_set_with(
                &actual_connections,
                &actual_store,
                || Ok(actual_path),
                change(Some(binding()), None, expected.digest),
                || {
                    assert!(actual_connections.try_lock().is_ok());
                    assert!(actual_store.test_connection_unlocked());
                    notify.send(()).unwrap();
                    continuation.recv_timeout(WAIT).unwrap();
                },
            )
        });
        let _ = result.send(outcome);
    });
    drop(waiter);
    notified.recv_timeout(WAIT).unwrap();
    assert_eq!(
        selection(&remote::read_store_values(&path).unwrap()[0]).unwrap(),
        Some(binding())
    );
    assert!(matches!(
        barrier.try_close_idle_target_admission("cut"),
        Err(BarrierError::PendingNativeOperations)
    ));
    release.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(
        selection(&remote::read_store_values(&path).unwrap()[0]).unwrap(),
        Some(binding())
    );
    assert!(barrier.try_close_idle_target_admission("cut").is_ok());
}
