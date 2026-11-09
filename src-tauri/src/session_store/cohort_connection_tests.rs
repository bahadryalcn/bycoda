//! Actual SQLite handle identity, never an inferred association with its path.
use super::*;

struct DatabaseFixture {
    root: PathBuf,
    database: PathBuf,
}

impl DatabaseFixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "bycoda-connection-identity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        Self {
            database: root.join("sessions.db"),
            root,
        }
    }

    fn binding(&self) -> StoreBinding {
        StoreBinding::resolve(&self.database, true).unwrap()
    }
}

impl Drop for DatabaseFixture {
    fn drop(&mut self) {
        // Only this test's unique directory, after its SQLite locals have dropped.
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn actual_sqlite_handle_matches_the_original_file_without_closing_sqlite() {
    let fixture = DatabaseFixture::new();
    let binding = fixture.binding();
    let connection = Connection::open(&fixture.database).unwrap();
    binding.verify_connection(&connection).unwrap();
    let (actual, links) = os::connection_identity(&connection).unwrap();
    assert_eq!(actual, binding.physical_file_id);
    assert_eq!(links, 1);
    connection
        .execute_batch("CREATE TABLE proof(value INTEGER); INSERT INTO proof VALUES(7);")
        .unwrap();
    binding.verify_connection(&connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT value FROM proof", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        7
    );
}

#[test]
fn a_different_open_database_cannot_borrow_another_files_registration() {
    let original = DatabaseFixture::new();
    let other = DatabaseFixture::new();
    let binding = original.binding();
    let connection = Connection::open(&other.database).unwrap();
    let error = binding.verify_connection(&connection).unwrap_err();
    assert!(
        error.contains("physical identity does not match"),
        "{error}"
    );
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
}

#[test]
fn actual_readonly_connection_has_the_same_full_file_identity() {
    let fixture = DatabaseFixture::new();
    let binding = fixture.binding();
    let writer = Connection::open(&fixture.database).unwrap();
    writer
        .execute_batch("CREATE TABLE proof(value INTEGER);")
        .unwrap();
    let reader = Connection::open_with_flags(
        &fixture.database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    binding.verify_connection(&reader).unwrap();
    assert_eq!(
        os::connection_identity(&reader).unwrap(),
        os::connection_identity(&writer).unwrap()
    );
    assert_eq!(
        reader
            .query_row("SELECT count(*) FROM proof", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn an_unavailable_memory_vfs_handle_is_never_accepted_as_the_file() {
    let fixture = DatabaseFixture::new();
    let binding = fixture.binding();
    let memory = Connection::open_in_memory().unwrap();
    assert!(os::connection_identity(&memory).is_err());
    assert!(binding.verify_connection(&memory).is_err());
    memory
        .execute_batch("CREATE TABLE still_usable(value);")
        .unwrap();
}

#[test]
fn added_hardlinks_still_refuse_native_writable_database_acceptance() {
    let fixture = DatabaseFixture::new();
    let binding = fixture.binding();
    let connection = Connection::open(&fixture.database).unwrap();
    std::fs::hard_link(&fixture.database, fixture.root.join("alias.db")).unwrap();
    assert_eq!(os::connection_identity(&connection).unwrap().1, 2);
    assert!(binding.verify_connection(&connection).is_err());
}

#[test]
fn registered_connection_refuses_wrong_handle_before_initialization() {
    let fixture = DatabaseFixture::new();
    let other = DatabaseFixture::new();
    let admission = OpenAdmission::begin(&fixture.database).unwrap();
    let registered = RegisteredConnection::new(
        Connection::open(&other.database).unwrap(),
        admission.registration.clone(),
    );
    assert!(registered.verify_connection(&registered).is_err());
    assert!(registered.initialization().is_err());
    assert_eq!(
        registered
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
}

#[test]
fn actual_store_writer_and_both_readers_use_the_registered_file() {
    let fixture = DatabaseFixture::new();
    let store = super::super::SessionStore::open(fixture.database.clone()).unwrap();
    let writer = store.conn.lock().unwrap();
    writer.verify_connection(&writer).unwrap();
    let read = store.read_conn.lock().unwrap();
    writer.verify_connection(read.as_ref().unwrap()).unwrap();
    let list = store.list_conn.lock().unwrap();
    writer.verify_connection(list.as_ref().unwrap()).unwrap();
}
