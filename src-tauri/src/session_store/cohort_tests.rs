use super::super::SessionStore;
use super::*;
use std::process::{Child, Command, Stdio};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("bycoda-native-cohort-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn database(&self) -> PathBuf {
        self.0.join("bycoda.db")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("bycoda-native-cohort-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn registration_is_real_native_identity_and_never_complete_inventory() {
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    let inspection = store.inspect_writer_cohort().unwrap();
    assert_eq!(inspection.census().coverage, Coverage::Unknown);
    let [actor] = inspection.census().actors.as_slice() else {
        panic!("one actual writer expected")
    };
    assert_eq!(actor.lease, LeaseState::Live);
    assert_eq!(actor.actor.process_id, std::process::id());
    assert_eq!(
        actor.actor.executable_path,
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
    assert_eq!(
        actor.actor.writer_protocol,
        super::super::authority::WRITER_PROTOCOL
    );
    #[cfg(windows)]
    assert!(actor
        .actor
        .process_start
        .as_ref()
        .unwrap()
        .starts_with("windows-filetime:"));
    assert_eq!(actor.actor.binding, inspection.census().binding);
    assert!(uuid::Uuid::parse_str(&actor.actor.actor_id).is_ok());
    // Dedicated UI/search handles are actual read-only connections too.
    assert!(store
        .list_conn
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .execute("CREATE TABLE forbidden(id)", [])
        .is_err());
}

#[test]
fn frozen_first_open_does_not_open_or_initialize_sqlite() {
    let fixture = Fixture::new();
    StoreBinding::resolve(&fixture.database(), true).unwrap();
    let inspection = Inspection::begin(&fixture.database()).unwrap();
    assert!(inspection.census().actors.is_empty());
    assert_eq!(inspection.census().coverage, Coverage::Unknown);
    assert!(SessionStore::open(fixture.database())
        .err()
        .unwrap()
        .contains("frozen"));
    assert_eq!(std::fs::metadata(fixture.database()).unwrap().len(), 0);
    drop(inspection);
    let store = SessionStore::open(fixture.database()).unwrap();
    assert_eq!(
        store.inspect_writer_cohort().unwrap().census().actors.len(),
        1
    );
}

#[test]
fn canonical_aliases_share_one_registration_and_frozen_reopens_are_excluded() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("subdir")).unwrap();
    let store = SessionStore::open(fixture.database()).unwrap();
    let alias = fixture.0.join("subdir").join("..").join("bycoda.db");
    let other = SessionStore::open(alias.clone()).unwrap();
    let inspection = Inspection::begin(&alias).unwrap();
    assert_eq!(inspection.census().actors.len(), 1);
    let error = SessionStore::open(alias).err().unwrap();
    assert!(error.contains("frozen"));
    drop(inspection);
    let reopened = SessionStore::open(fixture.database()).unwrap();
    assert_eq!(
        reopened
            .inspect_writer_cohort()
            .unwrap()
            .census()
            .actors
            .len(),
        1
    );
    drop(reopened);
    drop(other);
    drop(store);
}

#[cfg(windows)]
#[test]
fn windows_case_alias_uses_physical_database_binding() {
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    let alias = PathBuf::from(fixture.database().to_str().unwrap().to_uppercase());
    let other = SessionStore::open(alias).unwrap();
    assert_eq!(
        other.inspect_writer_cohort().unwrap().census().actors.len(),
        1
    );
    drop(other);
    drop(store);
}

#[cfg(unix)]
#[test]
fn symlink_parent_and_database_aliases_share_binding() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    symlink(&fixture.0, fixture.0.join("parent-alias")).unwrap();
    symlink(fixture.database(), fixture.0.join("database-alias")).unwrap();
    let other = SessionStore::open(fixture.0.join("parent-alias/bycoda.db")).unwrap();
    let file_alias = SessionStore::open(fixture.0.join("database-alias")).unwrap();
    assert_eq!(
        other.inspect_writer_cohort().unwrap().census().actors.len(),
        1
    );
    drop(file_alias);
    drop(other);
    drop(store);
}

#[test]
fn writable_connection_arc_keeps_lease_after_store_drop_and_reopen_reuses_native_actor() {
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    let old = store.inspect_writer_cohort().unwrap().census().actors[0]
        .actor
        .clone();
    let retained = store.conn.clone();
    drop(store);
    assert_eq!(
        Inspection::begin(&fixture.database())
            .unwrap()
            .census()
            .actors[0]
            .lease,
        LeaseState::Live
    );
    drop(retained);
    assert_eq!(
        Inspection::begin(&fixture.database())
            .unwrap()
            .census()
            .actors[0]
            .lease,
        LeaseState::Unleased
    );
    let store = SessionStore::open(fixture.database()).unwrap();
    let now = store.inspect_writer_cohort().unwrap().census().actors[0]
        .actor
        .clone();
    assert_eq!(old.actor_id, now.actor_id);
    assert_ne!(old.registration_id, now.registration_id);
}

#[test]
fn simultaneous_supported_opens_do_not_split_or_exclusively_lock_the_writer_cohort() {
    let fixture = Arc::new(Fixture::new());
    let (opened, ready) = std::sync::mpsc::channel();
    let mut releases = Vec::new();
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let fixture = fixture.clone();
            let opened = opened.clone();
            let (release, wait) = std::sync::mpsc::channel();
            releases.push(release);
            std::thread::spawn(move || {
                let store = SessionStore::open(fixture.database());
                let _ = opened.send(store.as_ref().err().cloned());
                let _ = wait.recv_timeout(Duration::from_secs(15));
                drop(store);
            })
        })
        .collect();
    drop(opened);
    let outcomes: Vec<_> = (0..4)
        .map(|_| ready.recv_timeout(Duration::from_secs(15)))
        .collect();
    let observed =
        Inspection::begin(&fixture.database()).map(|inspection| inspection.census().clone());
    for release in releases {
        let _ = release.send(());
    }
    for worker in workers {
        worker.join().unwrap();
    }
    for outcome in outcomes {
        assert_eq!(outcome.unwrap(), None);
    }
    let census = observed.unwrap();
    assert_eq!(census.actors.len(), 1);
    assert_eq!(census.actors[0].lease, LeaseState::Live);
}

#[test]
fn hardlinked_database_is_rejected_before_sqlite_or_registry_mutation() {
    let fixture = Fixture::new();
    let original = fixture.database();
    std::fs::write(&original, b"not yet sqlite").unwrap();
    let alias = fixture.0.join("hardlink.db");
    std::fs::hard_link(&original, &alias).unwrap();
    let error = SessionStore::open(alias).err().unwrap();
    assert!(error.contains("Hardlinked"));
    assert_eq!(std::fs::read(original).unwrap(), b"not yet sqlite");
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[test]
fn an_aliased_admission_sidecar_is_rejected_without_touching_sqlite() {
    let fixture = Fixture::new();
    let binding = StoreBinding::resolve(&fixture.database(), true).unwrap();
    let directory = binding.registry().unwrap();
    std::fs::create_dir(&directory).unwrap();
    let unrelated = fixture.0.join("unrelated-lock");
    std::fs::write(&unrelated, b"preserve this unrelated file").unwrap();
    std::fs::hard_link(&unrelated, directory.join("admission.lock")).unwrap();
    assert!(SessionStore::open(fixture.database())
        .err()
        .unwrap()
        .contains("one regular-file link"));
    assert_eq!(std::fs::metadata(fixture.database()).unwrap().len(), 0);
    assert_eq!(
        std::fs::read(unrelated).unwrap(),
        b"preserve this unrelated file"
    );
}

#[test]
fn corrupt_unknown_or_incomplete_registry_cannot_silently_admit_a_reopen() {
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    let binding = store
        .inspect_writer_cohort()
        .unwrap()
        .census()
        .binding
        .clone();
    let directory = binding.registry().unwrap();
    let unknown = directory.join("unknown-writer");
    std::fs::write(&unknown, b"unknown").unwrap();
    assert!(SessionStore::open(fixture.database())
        .err()
        .unwrap()
        .contains("unknown"));
    assert!(Inspection::begin(&fixture.database()).is_err());
    assert_eq!(std::fs::read(&unknown).unwrap(), b"unknown");
    std::fs::remove_file(unknown).unwrap();
    let incomplete = directory.join(format!("{}.lease", uuid::Uuid::new_v4()));
    std::fs::write(&incomplete, b"").unwrap();
    assert!(Inspection::begin(&fixture.database())
        .err()
        .unwrap()
        .contains("incomplete"));
    std::fs::remove_file(incomplete).unwrap();
    let corrupt = directory.join(format!("{}.json", uuid::Uuid::new_v4()));
    std::fs::write(corrupt.with_extension("lease"), b"").unwrap();
    std::fs::write(&corrupt, b"broken").unwrap();
    assert!(Inspection::begin(&fixture.database())
        .err()
        .unwrap()
        .contains("invalid"));
    assert_eq!(std::fs::read(corrupt).unwrap(), b"broken");
}

#[test]
fn census_refuses_unbounded_or_oversized_sidecar_metadata() {
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    let inspection = store.inspect_writer_cohort().unwrap();
    let directory = inspection.census().binding.registry().unwrap();
    drop(inspection);
    let id = uuid::Uuid::new_v4().to_string();
    let oversized = directory.join(format!("{id}.json"));
    std::fs::write(oversized.with_extension("lease"), b"").unwrap();
    std::fs::write(&oversized, vec![b' '; MAX_RECORD_BYTES + 1]).unwrap();
    assert!(Inspection::begin(&fixture.database())
        .err()
        .unwrap()
        .contains("bound"));
    std::fs::remove_file(&oversized).unwrap();
    std::fs::remove_file(oversized.with_extension("lease")).unwrap();
    for _ in 0..MAX_ACTORS {
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(directory.join(format!("{id}.lease")), b"").unwrap();
    }
    assert!(Inspection::begin(&fixture.database())
        .err()
        .unwrap()
        .contains("bound"));
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[test]
#[ignore = "only invoked by the owning real child-process fixture"]
fn writer_lease_child() {
    let database = PathBuf::from(std::env::var_os("BYCODA_COHORT_FIXTURE_DATABASE").unwrap());
    let ready = PathBuf::from(std::env::var_os("BYCODA_COHORT_FIXTURE_READY").unwrap());
    let _store = SessionStore::open(database).unwrap();
    std::fs::write(ready, b"registered").unwrap();
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).unwrap();
}

#[test]
fn a_real_child_has_an_independent_live_kernel_lease_until_its_process_crashes() {
    let fixture = Fixture::new();
    let store = SessionStore::open(fixture.database()).unwrap();
    let ready = fixture.0.join("child-ready");
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--ignored",
            "--exact",
            "session_store::cohort::tests::writer_lease_child",
            "--nocapture",
        ])
        .env("BYCODA_COHORT_FIXTURE_DATABASE", fixture.database())
        .env("BYCODA_COHORT_FIXTURE_READY", &ready)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let mut child = OwnedChild(command.spawn().unwrap());
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ready.exists() {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "cohort fixture exited before registration"
        );
        assert!(Instant::now() < deadline, "cohort fixture did not register");
        std::thread::sleep(Duration::from_millis(10));
    }
    let inspection = store.inspect_writer_cohort().unwrap();
    let actors = &inspection.census().actors;
    assert_eq!(actors.len(), 2);
    let native_parent = actors
        .iter()
        .find(|actor| actor.actor.process_id == std::process::id())
        .unwrap();
    let native_child = actors
        .iter()
        .find(|actor| actor.actor.process_id == child.0.id())
        .unwrap();
    assert_eq!(native_child.lease, LeaseState::Live);
    assert_ne!(native_child.actor.actor_id, native_parent.actor.actor_id);
    assert_eq!(native_child.actor.binding, native_parent.actor.binding);
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    drop(inspection);
    let inspection = store.inspect_writer_cohort().unwrap();
    assert_eq!(
        inspection
            .census()
            .actors
            .iter()
            .find(|actor| actor.actor.process_id == child.0.id())
            .unwrap()
            .lease,
        LeaseState::Unleased
    );
    assert_eq!(inspection.census().coverage, Coverage::Unknown);
    drop(inspection);
    drop(store);
    let reopened = SessionStore::open(fixture.database()).unwrap();
    assert_eq!(
        reopened
            .inspect_writer_cohort()
            .unwrap()
            .census()
            .actors
            .len(),
        1
    );
}
