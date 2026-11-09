// Included in the file-revert test module to reuse its isolated fixtures.

fn insert_session(sessions: &crate::session_store::SessionStore, cwd: &str) {
    sessions.lock_conn().unwrap().execute("INSERT INTO sessions (id,cwd,harness,model,runtime_mode,title,created_at,updated_at) VALUES (?1,?2,'test','test','test','test',1,1)", rusqlite::params!["session", cwd]).unwrap();
}

#[test]
fn checkpoint_files_revert_requires_the_current_persisted_session_checkout() {
    let f = Fixture::new(false);
    f.begin("session", "one");
    f.finish("session", "one");
    let sessions = crate::session_store::SessionStore::open_in_memory().unwrap();
    insert_session(&sessions, &f.cwd());
    assert!(persisted_checkout(&f.store, &sessions, "session").is_ok());
    let other = f.dir.join("other");
    std::fs::create_dir(&other).unwrap();
    let conn = sessions.lock_conn().unwrap();
    conn.execute(
        "UPDATE sessions SET worktree_cwd=?1 WHERE id='session'",
        [other.to_string_lossy().as_ref()],
    )
    .unwrap();
    assert!(assert_checkout(
        &f.store.session_dir("session"),
        &current_checkout(&conn, "session").unwrap()
    )
    .is_err());
    conn.execute(
        "UPDATE sessions SET worktree_removed=1 WHERE id='session'",
        [],
    )
    .unwrap();
    assert!(current_checkout(&conn, "session").is_err());
    assert!(current_checkout(&conn, "missing").is_err());
}

/// Edit from here froze the app: the revert commands held the session-store lock
/// while `exclusive` asked the authority gate, which takes that same lock.
#[test]
fn checkpoint_files_revert_releases_the_session_store_before_the_authority_gate() {
    let mut f = Fixture::new(false);
    f.begin("session", "one");
    f.write("a.txt", "one\n");
    f.finish("session", "one");
    let sessions = crate::session_store::SessionStore::open_in_memory().unwrap();
    insert_session(&sessions, &f.cwd());
    f.store.authority = Some(sessions.authority_execution_gate());
    let cwd = persisted_checkout(&f.store, &sessions, "session").unwrap();
    assert!(sessions.test_connection_unlocked());
    let store = f.store.clone();
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let plan = store.exclusive("session", &[&cwd], |s| {
            s.files_revert_plan("session", "message-one")
        });
        let _ = done.send(plan.map(|plan| plan.unavailable));
    });
    let plan = finished
        .recv_timeout(std::time::Duration::from_secs(30))
        .expect("the checkpoint authority gate must not wait on the session store");
    assert_eq!(plan.unwrap(), None);
}
