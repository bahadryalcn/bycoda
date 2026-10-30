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

#[cfg(windows)]
mod actual_node {
    use super::{CapturedHostNotesStore, Fixture, HostNotesFenceOwner};
    use serde_json::{json, Value};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};

    const PEER: &str = include_str!("../../../host/fixtures/host-notes-native-fence.mjs");

    struct Peer {
        child: Child,
        input: Option<ChildStdin>,
        events: mpsc::Receiver<Result<Value, String>>,
        errors: Arc<Mutex<String>>,
        readers: Vec<JoinHandle<()>>,
    }

    impl Peer {
        fn spawn(
            node: &Path,
            repository: &Path,
            database: &Path,
            addon: &Path,
            script: &Path,
        ) -> Self {
            std::fs::write(script, PEER).unwrap();
            let mut child = Command::new(node)
                .arg("--experimental-transform-types")
                .arg(script)
                .arg(repository)
                .arg(database)
                .arg(addon)
                .creation_flags(0x08000000)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("the explicit owned Node runtime must start");
            let input = child.stdin.take();
            let output = child.stdout.take().unwrap();
            let mut error_output = child.stderr.take().unwrap();
            let (send, events) = mpsc::channel();
            let output_reader = std::thread::spawn(move || {
                for line in BufReader::new(output).lines() {
                    let value = line.map_err(|error| error.to_string()).and_then(|line| {
                        if line.len() > 16384 {
                            return Err("owned Node peer emitted an oversized event".into());
                        }
                        serde_json::from_str(&line).map_err(|error| error.to_string())
                    });
                    if send.send(value).is_err() {
                        return;
                    }
                }
            });
            let errors = Arc::new(Mutex::new(String::new()));
            let captured = Arc::clone(&errors);
            let error_reader = std::thread::spawn(move || {
                let mut bytes = [0_u8; 2048];
                loop {
                    let Ok(length) = error_output.read(&mut bytes) else {
                        return;
                    };
                    if length == 0 {
                        return;
                    }
                    let mut text = captured.lock().unwrap();
                    text.push_str(&String::from_utf8_lossy(&bytes[..length]));
                    if text.len() > 32768 {
                        let mut start = text.len() - 32768;
                        while !text.is_char_boundary(start) {
                            start += 1;
                        }
                        text.drain(..start);
                    }
                }
            });
            Self {
                child,
                input,
                events,
                errors,
                readers: vec![output_reader, error_reader],
            }
        }

        fn command(&mut self, command: &str) {
            let input = self.input.as_mut().unwrap();
            writeln!(input, "{}", json!({ "command": command })).unwrap();
            input.flush().unwrap();
        }

        fn event(&self, name: &str) -> Value {
            let received = self
                .events
                .recv_timeout(Duration::from_secs(15))
                .unwrap_or_else(|error| {
                    panic!(
                        "owned Node peer did not emit {name}: {error}; stderr: {}",
                        self.errors.lock().unwrap()
                    )
                })
                .unwrap_or_else(|error| panic!("owned Node peer protocol: {error}"));
            assert_eq!(
                received["event"],
                name,
                "unexpected Node event {received}; stderr: {}",
                self.errors.lock().unwrap()
            );
            received
        }

        fn finish(&mut self) {
            self.input.take();
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                if let Some(status) = self.child.try_wait().unwrap() {
                    assert!(
                        status.success(),
                        "owned Node peer failed: {status}; {}",
                        self.errors.lock().unwrap()
                    );
                    break;
                }
                assert!(Instant::now() < deadline, "owned Node peer did not exit");
                std::thread::sleep(Duration::from_millis(10));
            }
            for reader in self.readers.drain(..) {
                reader.join().unwrap();
            }
        }
    }

    impl Drop for Peer {
        fn drop(&mut self) {
            self.input.take();
            if self.child.try_wait().ok().flatten().is_none() {
                // Only this test's uniquely spawned child, never a process search.
                let _ = self.child.kill();
            }
            let _ = self.child.wait();
            for reader in self.readers.drain(..) {
                let _ = reader.join();
            }
        }
    }

    #[test]
    #[ignore = "requires explicit Node runtime and built physical admission addon"]
    fn real_host_sql_jobs_drain_across_the_original_native_fence() {
        let node = PathBuf::from(
            std::env::var_os("BYCODA_NATIVE_HOST_NOTES_NODE")
                .expect("set the explicit isolated Node runtime"),
        );
        let addon = PathBuf::from(
            std::env::var_os("BYCODA_NATIVE_HOST_NOTES_ADDON")
                .expect("set the explicit trusted built admission addon"),
        );
        assert!(node.is_absolute() && node.is_file());
        assert!(addon.is_absolute() && addon.is_file());
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let fixture = Fixture::new();
        let database = fixture.database("sessions.db");
        let store = fixture.store("sessions.db");
        let mut peer = Peer::spawn(
            &node,
            repository,
            &database,
            &addon,
            &fixture.0.join("node-host-fence-peer.mjs"),
        );
        let accepted = peer.event("accepted");
        assert_eq!(accepted["originals"], 2);

        let owner =
            HostNotesFenceOwner::new(vec![CapturedHostNotesStore::capture(&store).unwrap()]);
        let generation = owner.generation();
        assert!(!owner.cooperative_only(generation).unwrap());
        owner.close_ingress(generation).unwrap();
        assert!(process_owns_original(&owner));
        assert!(!owner.try_drained(generation).unwrap());
        assert!(!owner.retire_if_drained(generation).unwrap());

        peer.command("try-new");
        let rejected = peer.event("new-rejected");
        assert_eq!(rejected["code"], "HOST_NOTES_ADMISSION_BUSY");
        peer.command("commit");
        let committed = peer.event("committed");
        assert_eq!(committed["first"]["body"], "first");
        assert_eq!(committed["second"]["body"], "second");
        assert_eq!(committed["newAbsent"], true);
        let deadline = Instant::now() + Duration::from_secs(5);
        while !owner.try_drained(generation).unwrap() {
            assert!(
                Instant::now() < deadline,
                "original Host SQL jobs never retired"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        peer.command("try-new");
        let still_closed = peer.event("new-rejected");
        assert_eq!(still_closed["code"], "HOST_NOTES_ADMISSION_BUSY");
        assert!(process_owns_original(&owner));
        // Reads and actual Native SQL access remain independent of Host writer
        // closure. No SQL/owner mutex is held while the peer or kernel drains.
        peer.command("read");
        let read = peer.event("read");
        assert_eq!(read["body"], "second");
        {
            let connection = store.lock_conn().unwrap();
            for (id, expected) in [("original", "first"), ("second", "second")] {
                let body: String = connection
                    .query_row("SELECT body FROM notes WHERE id = ?1", [id], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(body, expected);
            }
            let refused: i64 = connection
                .query_row("SELECT COUNT(*) FROM notes WHERE id = 'new'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(refused, 0);
        }
        assert!(owner.retire_if_drained(generation).unwrap());
        assert!(!process_owns_original(&owner));
        peer.command("reopened");
        assert_eq!(peer.event("reopened")["body"], "after native");
        let body: String = store
            .lock_conn()
            .unwrap()
            .query_row("SELECT body FROM notes WHERE id = 'after'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(body, "after native");
        peer.command("exit");
        peer.event("closed");
        peer.finish();
    }

    fn process_owns_original(owner: &Arc<HostNotesFenceOwner>) -> bool {
        super::super::process_owners()
            .unwrap()
            .owners
            .get(&owner.generation())
            .is_some_and(|original| Arc::ptr_eq(original, owner))
    }
}
