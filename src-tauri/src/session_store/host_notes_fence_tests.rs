use super::*;
use std::path::PathBuf;
#[cfg(windows)]
use std::{
    fs::File,
    sync::{mpsc, Arc},
    time::Duration,
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("bycoda-host-notes-fence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn database(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
    fn store(&self, name: &str) -> SessionStore {
        SessionStore::open(self.database(name)).unwrap()
    }
    #[cfg(windows)]
    fn host(&self, name: &str) -> PhysicalStore {
        let actual = std::fs::canonicalize(self.database(name)).unwrap();
        Registry::open(&database_registry_root(&actual).unwrap())
            .unwrap()
            .bind(File::open(actual).unwrap())
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn in_memory_capture_stays_explicitly_unattested() {
    let store = SessionStore::open_in_memory().unwrap();
    let owner = HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&store).unwrap()]);
    let generation = owner.generation();
    assert!(owner.cooperative_only(generation).unwrap());
    owner.close_ingress(generation).unwrap();
    assert!(owner.try_drained(generation).unwrap());
    assert!(owner.retire_if_drained(generation).unwrap());
}

#[cfg(windows)]
#[test]
fn another_sqlite_connection_cannot_borrow_the_original_store_path_for_a_fence() {
    let fixture = Fixture::new();
    let store = fixture.store("original.db");
    {
        let mut connection = store.lock_conn().unwrap();
        **connection = rusqlite::Connection::open(fixture.database("different.db")).unwrap();
    }
    assert!(CapturedHostNotesStore::capture(&store).is_err());
}

#[cfg(windows)]
#[test]
fn actual_connection_captures_dedupe_and_keep_original_host_writer_until_real_release() {
    let fixture = Fixture::new();
    let store = fixture.store("sessions.db");
    let host = fixture.host("sessions.db");
    let writer = host.try_writer().unwrap();
    let owner = HostNotesFenceOwner::new(vec![
        CapturedHostNotesStore::capture(&store).unwrap(),
        CapturedHostNotesStore::capture(&store).unwrap(),
    ]);
    {
        let loan = owner.loan(owner.generation()).unwrap();
        assert_eq!(loan.set.as_ref().unwrap().entries.len(), 1);
    }
    let generation = owner.generation();
    assert!(!owner.cooperative_only(generation).unwrap());
    owner.close_ingress(generation).unwrap();
    assert!(!owner.try_drained(generation).unwrap());
    assert!(matches!(
        host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    assert!(!owner.retire_if_drained(generation).unwrap());
    drop(writer);
    assert!(owner.try_drained(generation).unwrap());
    assert!(matches!(
        host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    assert!(owner.retire_if_drained(generation).unwrap());
    drop(host.try_writer().unwrap());
}

#[cfg(windows)]
#[test]
fn physical_closing_and_drain_do_not_hold_or_reborrow_native_sql() {
    let fixture = Fixture::new();
    let store = Arc::new(fixture.store("sessions.db"));
    let owner = HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&store).unwrap()]);
    let connection = store.lock_conn().unwrap();
    let cloned = Arc::clone(&owner);
    let (send, receive) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let generation = cloned.generation();
        cloned.close_ingress(generation).unwrap();
        send.send(cloned.try_drained(generation)).unwrap();
    });
    let result = receive.recv_timeout(Duration::from_secs(2));
    // The original SQLite connection is still usable, never adopted/closed by
    // the duplicate OS file. Native lanes have their separate WindowBarrier.
    connection.execute_batch("CREATE TABLE host_fence_connection_alive(value INTEGER); INSERT INTO host_fence_connection_alive VALUES(7);").unwrap();
    drop(connection);
    worker.join().unwrap();
    assert!(result.unwrap().unwrap());
    assert!(owner.retire_if_drained(owner.generation()).unwrap());
}

#[cfg(windows)]
#[test]
fn partial_multi_store_close_retains_its_original_gate_and_never_releases_the_other_owner() {
    let fixture = Fixture::new();
    let first = fixture.store("first.db");
    let second = fixture.store("second.db");
    let host_first = fixture.host("first.db");
    let host_second = fixture.host("second.db");
    let accepted = host_first.try_writer().unwrap();
    let unrelated = host_second.try_begin_close().unwrap();
    let owner = HostNotesFenceOwner::new(vec![
        CapturedHostNotesStore::capture(&first).unwrap(),
        CapturedHostNotesStore::capture(&second).unwrap(),
    ]);
    let generation = owner.generation();
    assert!(owner.close_ingress(generation).is_err());
    assert!(matches!(
        host_first.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    assert!(!owner.retire_if_drained(generation).unwrap());
    drop(accepted);
    assert!(owner.retire_if_drained(generation).unwrap());
    drop(host_first.try_writer().unwrap());
    assert!(matches!(
        host_second.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(unrelated);
    drop(host_second.try_writer().unwrap());
}

#[cfg(windows)]
#[test]
fn hard_error_restores_same_closing_and_wrong_generation_cannot_release_it() {
    let fixture = Fixture::new();
    let store = fixture.store("sessions.db");
    let owner = HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&store).unwrap()]);
    let another = HostNotesFenceOwner::new(Vec::new());
    let generation = owner.generation();
    owner.close_ingress(generation).unwrap();
    let root =
        database_registry_root(&std::fs::canonicalize(fixture.database("sessions.db")).unwrap())
            .unwrap();
    let namespace = std::fs::read_dir(&root)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::hard_link(
        namespace.join("writers.lock"),
        fixture.0.join("unsafe-sidecar-alias"),
    )
    .unwrap();
    assert!(owner.try_drained(generation).is_err());
    assert!(owner.retire_if_drained(another.generation()).is_err());
    assert!(owner.retire_if_drained(generation).is_err());
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(namespace.join("turnstile.lock"))
        .unwrap();
    assert!(matches!(
        held.try_lock(),
        Err(std::fs::TryLockError::WouldBlock)
    ));
    drop(held);
}

#[cfg(not(windows))]
#[test]
fn ordinary_native_store_remains_cooperative_without_sql_fd_attestation() {
    let fixture = Fixture::new();
    let store = fixture.store("sessions.db");
    let owner = HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&store).unwrap()]);
    assert!(owner.cooperative_only(owner.generation()).unwrap());
    store
        .lock_conn()
        .unwrap()
        .execute_batch("CREATE TABLE ordinary_dev_still_works(value INTEGER);")
        .unwrap();
}

#[cfg(windows)]
#[test]
fn process_keeper_capacity_child() {
    if std::env::var("BYCODA_NATIVE_HOST_FENCE_CAPACITY_CHILD").as_deref() != Ok("1") {
        return;
    }
    assert!(process_owners().unwrap().owners.is_empty());
    let fixture = Fixture::new();
    let original = fixture.store("original.db");
    let other = fixture.store("other.db");
    let original_host = fixture.host("original.db");
    let other_host = fixture.host("other.db");
    let retained =
        HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&original).unwrap()]);
    let refused = HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&other).unwrap()]);
    retained.close_ingress(retained.generation()).unwrap();
    let mut fillers = Vec::new();
    for _ in 1..MAX_PROCESS_OWNERS {
        let owner = HostNotesFenceOwner::new(Vec::new());
        owner.close_ingress(owner.generation()).unwrap();
        fillers.push(owner);
    }
    assert_eq!(process_owners().unwrap().owners.len(), MAX_PROCESS_OWNERS);
    assert!(refused
        .close_ingress(refused.generation())
        .unwrap_err()
        .contains("CAPACITY"));
    // Refusal happened before the other physical turnstile was ever closed.
    drop(other_host.try_writer().unwrap());
    assert!(matches!(
        original_host.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    assert_eq!(process_owners().unwrap().owners.len(), MAX_PROCESS_OWNERS);
    for owner in fillers {
        assert!(owner.retire_if_drained(owner.generation()).unwrap());
    }
    assert!(retained.retire_if_drained(retained.generation()).unwrap());
    assert!(refused.retire_if_drained(refused.generation()).unwrap());
    assert!(process_owners().unwrap().owners.is_empty());
    assert!(retained.close_ingress(retained.generation()).is_err());
    assert!(process_owners().unwrap().owners.is_empty());
    drop(original_host.try_writer().unwrap());
}

#[cfg(windows)]
#[test]
fn bounded_process_keeper_refuses_before_close_without_evicting_original_owners() {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::Instant;
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "session_store::host_notes_fence::tests::process_keeper_capacity_child",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("BYCODA_NATIVE_HOST_FENCE_CAPACITY_CHILD", "1")
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if Instant::now() >= until {
            let _ = child.kill(); // This test's uniquely owned child only.
            let _ = child.wait();
            panic!("isolated native capacity fixture did not exit");
        }
        std::thread::yield_now();
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
