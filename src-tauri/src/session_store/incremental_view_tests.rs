use super::*;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc},
    time::Duration,
};

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("bycoda-view-atomic-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("bycoda-view-atomic-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

type Rows = Vec<(String, String, String)>;
fn rows(conn: &Connection, from: &str) -> rusqlite::Result<Rows> {
    let mut statement = conn.prepare(&format!(
        "SELECT id,blocks_json,sentinel FROM {from} ORDER BY id"
    ))?;
    statement_rows(&mut statement)
}
fn statement_rows(statement: &mut rusqlite::Statement<'_>) -> rusqlite::Result<Rows> {
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect()
}
fn view_sql(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='view' AND name='session_transcripts'",
        [],
        |row| row.get(0),
    )
}

fn exercise_replacement(deny_create: bool) {
    let directory = Arc::new(Directory::new());
    let path = directory.0.join("view.sqlite");
    let writer = Connection::open(&path).unwrap();
    writer.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE sessions(id TEXT PRIMARY KEY,blocks_json TEXT NOT NULL,sentinel TEXT NOT NULL);").unwrap();
    ensure_schema(&writer).unwrap();
    let legacy =
        json!([{"id":"legacy.user","role":"user","text":"preserved legacy 🧩"}]).to_string();
    let checkpoint =
        json!([{"id":"old.checkpoint","role":"user","text":"retained checkpoint"}]).to_string();
    let incremental =
        json!({"id":"incremental.user","role":"user","text":"preserved incremental 字段"})
            .to_string();
    writer
        .execute(
            "INSERT INTO sessions VALUES('legacy',?1,'legacy sentinel')",
            [&legacy],
        )
        .unwrap();
    writer
        .execute(
            "INSERT INTO sessions VALUES('incremental',?1,'incremental sentinel')",
            [&checkpoint],
        )
        .unwrap();
    writer
        .execute(
            "INSERT INTO session_block_state VALUES('incremental',7,1)",
            [],
        )
        .unwrap();
    writer
        .execute(
            "INSERT INTO session_blocks VALUES('incremental',0,'incremental.user',?1,7)",
            [&incremental],
        )
        .unwrap();
    let reader =
        Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    reader
        .execute_batch("PRAGMA query_only=ON; PRAGMA busy_timeout=500;")
        .unwrap();
    let mode: String = reader
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    let expected = vec![
        (
            "incremental".into(),
            format!("[{incremental}]"),
            "incremental sentinel".into(),
        ),
        ("legacy".into(), legacy, "legacy sentinel".into()),
    ];
    assert_eq!(rows(&reader, "session_transcripts").unwrap(), expected);
    let mut retained_statement = reader
        .prepare("SELECT id,blocks_json,sentinel FROM session_transcripts ORDER BY id")
        .unwrap();
    assert_eq!(statement_rows(&mut retained_statement).unwrap(), expected);
    let storage = rows(&reader, "sessions").unwrap();
    let original_view = view_sql(&reader).unwrap();
    // The view is regenerated from actual columns on another app's startup.
    writer
        .execute_batch(
            "ALTER TABLE sessions ADD COLUMN later_column TEXT NOT NULL DEFAULT 'new metadata';",
        )
        .unwrap();
    let (paused, reached) = mpsc::sync_channel(1);
    let (resume, release) = mpsc::sync_channel(1);
    let worker_directory = directory.clone();
    let worker = std::thread::spawn(move || {
        // Keep the temporary directory until this connection closes, including
        // a parent-test failure, without touching any installed native profile.
        let _directory = worker_directory;
        let writer = writer;
        writer
            .authorizer(Some(move |context: AuthContext<'_>| {
                if matches!(
                    context.action,
                    AuthAction::CreateView {
                        view_name: "session_transcripts"
                    }
                ) {
                    let _ = paused.send(());
                    if release.recv_timeout(Duration::from_secs(10)).is_err() || deny_create {
                        return Authorization::Deny;
                    }
                }
                Authorization::Allow
            }))
            .unwrap();
        let outcome = ensure_schema(&writer).map_err(|error| error.to_string());
        (outcome, writer.is_autocommit())
    });
    let did_pause = reached.recv_timeout(Duration::from_secs(10));
    // CREATE's authorizer executes after DROP has run. Each call is a separate
    // autocommit read: continuity is not manufactured by pinning one snapshot.
    let during: Vec<_> = (0..8)
        .map(|_| rows(&reader, "session_transcripts"))
        .collect();
    let retained_during = statement_rows(&mut retained_statement);
    let _ = resume.send(());
    let (outcome, autocommit) = worker.join().unwrap();
    did_pause.unwrap();
    assert!(
        autocommit,
        "view transaction leaked after replacement: {outcome:?}"
    );
    for observation in during {
        assert_eq!(observation.unwrap(), expected);
    }
    assert_eq!(retained_during.unwrap(), expected);
    assert_eq!(rows(&reader, "session_transcripts").unwrap(), expected);
    assert_eq!(rows(&reader, "sessions").unwrap(), storage);
    if deny_create {
        assert!(outcome.is_err());
        assert_eq!(view_sql(&reader).unwrap(), original_view);
        assert!(reader
            .prepare("SELECT later_column FROM session_transcripts")
            .is_err());
        // The rolled-back view is usable and can be refreshed by the next
        // ordinary startup; rollback did not poison the connection/schema.
        let retry = Connection::open(&path).unwrap();
        ensure_schema(&retry).unwrap();
    } else {
        outcome.unwrap();
        assert_ne!(view_sql(&reader).unwrap(), original_view);
    }
    let later: String = reader
        .query_row(
            "SELECT later_column FROM session_transcripts WHERE id='legacy'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(later, "new metadata");
    assert_eq!(rows(&reader, "session_transcripts").unwrap(), expected);
}

#[test]
fn already_open_wal_reader_keeps_both_transcript_forms_during_view_replacement() {
    exercise_replacement(false);
}

#[test]
fn denied_create_restores_the_old_view_both_transcript_forms_and_connection_state() {
    exercise_replacement(true);
}
