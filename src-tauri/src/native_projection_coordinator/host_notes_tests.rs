//! Actual Store/Core plus the production Preparation retirement gate. No GUI,
//! all-actor discovery or SQL-authority claim is made from these local fixtures.
use super::*;
use crate::session_store::SessionStore;
use bycoda_physical_store_admission::{database_registry_root, BusyResource, Error, Registry};
use std::{fs::File, path::PathBuf, sync::mpsc};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "bycoda-projection-host-fence-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn database(&self) -> PathBuf {
        self.0.join("sessions.db")
    }
    fn store(&self) -> Arc<SessionStore> {
        Arc::new(SessionStore::open(self.database()).unwrap())
    }
    fn host(&self) -> bycoda_physical_store_admission::PhysicalStore {
        let canonical = std::fs::canonicalize(self.database()).unwrap();
        Registry::open(&database_registry_root(&canonical).unwrap())
            .unwrap()
            .bind(File::open(canonical).unwrap())
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn preparation(store: &SessionStore) -> Arc<Preparation> {
    let host_notes =
        HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(store).unwrap()]);
    let host_generation = host_notes.generation();
    Arc::new(Preparation {
        id: uuid::Uuid::new_v4().to_string(),
        scope: NativeCheckpointScope::new(
            "host-fence-native-fixture",
            "target",
            "fixture-migration",
            1,
        )
        .unwrap(),
        deadline: Instant::now() - Duration::from_millis(1),
        state: Mutex::new(State {
            recipients: HashMap::new(),
            cancelled: false,
            reason: None,
            challenging: false,
            in_flight: 0,
            round: None,
            release_ready: false,
        }),
        changed: Condvar::new(),
        host_notes,
        host_generation,
    })
}

#[test]
fn an_active_preparation_cannot_be_retired_by_an_observer_deadline_alone() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let host = fixture.host();
    let issued = preparation(&store);
    issued
        .host_notes
        .close_ingress(issued.host_generation)
        .unwrap();
    assert!(issued
        .host_notes
        .try_drained(issued.host_generation)
        .unwrap());
    assert!(Instant::now() >= issued.deadline);
    assert!(!issued.try_retire_host_notes().unwrap());
    assert!(matches!(
        host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    issued.state.lock().unwrap().cancelled = true;
    assert!(issued.try_retire_host_notes().unwrap());
    drop(host.try_writer().unwrap());
}

#[test]
fn cancelled_observer_retains_original_fence_through_actual_sql_and_host_worker_retirement() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let host = fixture.host();
    let accepted_host_writer = host.try_writer().unwrap();
    let observer = preparation(&store);
    observer
        .host_notes
        .close_ingress(observer.host_generation)
        .unwrap();
    {
        let mut state = observer.state.lock().unwrap();
        state.in_flight = 1; // Same private counter admitted by production verify.
        state.cancelled = true;
        state.reason = Some(error("CANCELLED"));
    }
    let retained = Arc::clone(&observer);
    let actual_worker = Arc::clone(&observer);
    let actual_store = Arc::clone(&store);
    let (started, ready) = mpsc::channel();
    let (finish, resume) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        {
            let connection = actual_store.lock_conn().unwrap();
            connection.execute_batch("CREATE TABLE held_projection_sql(value INTEGER); INSERT INTO held_projection_sql VALUES(1);").unwrap();
            started.send(()).unwrap();
            resume.recv_timeout(Duration::from_secs(5)).unwrap();
        } // Real SQL/connection borrow retires BEFORE the owner counter settles.
        let mut state = actual_worker.state.lock().unwrap();
        state.in_flight -= 1;
        actual_worker.changed.notify_all();
    });
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    drop(observer); // Dropped public observer cannot own actual work retirement.
    assert!(!retained.try_retire_host_notes().unwrap());
    assert!(!retained.state.lock().unwrap().release_ready);
    assert!(matches!(
        host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    finish.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(retained.state.lock().unwrap().in_flight, 0);
    // Native SQL finished, but an original separately admitted Host job is live.
    assert!(!retained.try_retire_host_notes().unwrap());
    assert!(matches!(
        host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(accepted_host_writer);
    assert!(retained.try_retire_host_notes().unwrap());
    drop(host.try_writer().unwrap());
    assert_eq!(
        store
            .lock_conn()
            .unwrap()
            .query_row("SELECT value FROM held_projection_sql", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn a_new_native_generation_cannot_borrow_or_retire_an_original_physical_fence() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let host = fixture.host();
    let original = preparation(&store);
    let replacement = preparation(&store);
    original
        .host_notes
        .close_ingress(original.host_generation)
        .unwrap();
    assert!(original
        .host_notes
        .retire_if_drained(replacement.host_generation)
        .is_err());
    assert!(replacement
        .host_notes
        .close_ingress(replacement.host_generation)
        .is_err());
    assert!(matches!(
        host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    original.state.lock().unwrap().cancelled = true;
    assert!(original.try_retire_host_notes().unwrap());
    replacement
        .host_notes
        .close_ingress(replacement.host_generation)
        .unwrap();
    replacement.state.lock().unwrap().cancelled = true;
    assert!(replacement.try_retire_host_notes().unwrap());
    drop(host.try_writer().unwrap());
}

#[test]
fn hard_error_preparation_drop_cannot_reopen_an_original_gate_with_a_live_host_writer() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let host = fixture.host();
    let accepted_writer = host.try_writer().unwrap();
    let issued = preparation(&store);
    issued
        .host_notes
        .close_ingress(issued.host_generation)
        .unwrap();
    issued.state.lock().unwrap().cancelled = true;
    let canonical = std::fs::canonicalize(fixture.database()).unwrap();
    let root = database_registry_root(&canonical).unwrap();
    let namespace = std::fs::read_dir(root)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::hard_link(
        namespace.join("writers.lock"),
        fixture.0.join("unsafe-writer-alias"),
    )
    .unwrap();
    // The real production retirement path fails and must conserve ownership.
    assert!(issued.try_retire_host_notes().is_err());
    let gate = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(namespace.join("turnstile.lock"))
        .unwrap();
    assert!(matches!(
        gate.try_lock(),
        Err(std::fs::TryLockError::WouldBlock)
    ));
    let original_owner = Arc::downgrade(&issued.host_notes);
    // Models the final original Preparation Arc disappearing when the old
    // CurrentCheckpoints/coordinator is cleared during process re-association.
    drop(issued);
    assert!(
        original_owner.upgrade().is_some(),
        "the original native owner/accounting must survive, not merely a leaked descriptor"
    );
    assert!(matches!(gate.try_lock(), Err(std::fs::TryLockError::WouldBlock)), "old coordinator/Preparation Drop reopened an owned fence before actual Host writer retirement");
    drop(accepted_writer);
    assert!(matches!(gate.try_lock(), Err(std::fs::TryLockError::WouldBlock)), "an unverified hard-error owner requires explicit matching retirement, never a guessed idle cleanup");
    drop(gate);
}
