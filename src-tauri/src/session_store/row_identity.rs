//! Private row-construction identity, not a session revision or authority grant.
//! SQL insert/delete/id-rename, including legacy REPLACE, invalidate captures.
//! Ordinary upserts keep identity. These tokens are not transferred as proof.

use super::SessionStore;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};

const TABLE: &str = "CREATE TABLE native_session_row_identity (
    session_id TEXT PRIMARY KEY NOT NULL,
    incarnation BLOB NOT NULL CHECK(typeof(incarnation)='blob' AND length(incarnation)=16)
)";
const TRIGGERS: [(&str, &str); 3] = [
    (
        "native_session_identity_insert",
        "CREATE TRIGGER native_session_identity_insert
     AFTER INSERT ON sessions WHEN NEW.id IS NOT NULL BEGIN
       INSERT INTO native_session_row_identity(session_id,incarnation) VALUES(NEW.id,randomblob(16))
       ON CONFLICT(session_id) DO UPDATE SET incarnation=excluded.incarnation;
     END",
    ),
    (
        "native_session_identity_delete",
        "CREATE TRIGGER native_session_identity_delete
     AFTER DELETE ON sessions BEGIN
       DELETE FROM native_session_row_identity WHERE session_id=OLD.id;
     END",
    ),
    (
        "native_session_identity_rename",
        "CREATE TRIGGER native_session_identity_rename
     AFTER UPDATE OF id ON sessions WHEN OLD.id IS NOT NEW.id BEGIN
       DELETE FROM native_session_row_identity WHERE session_id=OLD.id;
       INSERT INTO native_session_row_identity(session_id,incarnation)
       SELECT NEW.id,randomblob(16) WHERE NEW.id IS NOT NULL
       ON CONFLICT(session_id) DO UPDATE SET incarnation=excluded.incarnation;
     END",
    ),
];
// Checked in the SAME read snapshot as the row token. This is schema-integrity
// checking, not code-signature or participating-writer qualification.
const SCHEMA_CURRENT: &str = "(SELECT count(*) FROM sqlite_master WHERE
 (type='table' AND name='native_session_row_identity' AND sql=:table_sql) OR
 (type='trigger' AND name='native_session_identity_insert' AND sql=:insert_sql) OR
 (type='trigger' AND name='native_session_identity_delete' AND sql=:delete_sql) OR
 (type='trigger' AND name='native_session_identity_rename' AND sql=:rename_sql))=4";

/// Native construction only: no Deserialize, caller token or path constructor.
pub(crate) struct SessionRowIdentity {
    instance: uuid::Uuid,
    session: String,
    incarnation: [u8; 16],
}

pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let existing: Option<String> = tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='native_session_row_identity'",
        [], |row| row.get(0),
    ).optional()?;
    match existing.as_deref() {
        None => tx.execute_batch(TABLE)?,
        Some(sql) if sql == TABLE => {}
        Some(_) => return Err(rusqlite::Error::InvalidQuery),
    }
    let mut repaired = false;
    for (name, sql) in TRIGGERS {
        let old: Option<String> = tx
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()?;
        if old.as_deref() != Some(sql) {
            repaired = true;
            // Only our own named triggers, inside the same atomic transaction.
            tx.execute_batch(&format!("DROP TRIGGER IF EXISTS {name}"))?;
            tx.execute_batch(sql)?;
        }
    }
    if existing.is_some() && repaired {
        // A writer could have escaped a damaged trigger. Never preserve an old
        // binding merely because current row bytes happen to match again.
        tx.execute(
            "UPDATE native_session_row_identity SET incarnation=randomblob(16)",
            [],
        )?;
    }
    tx.execute("INSERT INTO native_session_row_identity(session_id,incarnation)
        SELECT id,randomblob(16) FROM sessions WHERE id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM native_session_row_identity n WHERE n.session_id=sessions.id)", [])?;
    tx.commit()
}

impl SessionStore {
    pub(crate) fn capture_session_row_identity(
        &self,
        session: &str,
    ) -> Result<Option<SessionRowIdentity>, String> {
        let conn = self.lock_conn()?;
        self.capture_session_row_identity_at(&conn, session)
    }

    /// The caller owns the SQL snapshot (or transaction); never relock Store.
    pub(super) fn capture_session_row_identity_at(
        &self,
        conn: &Connection,
        session: &str,
    ) -> Result<Option<SessionRowIdentity>, String> {
        let token: Option<Vec<u8>> = conn.query_row(
            &format!("SELECT n.incarnation FROM native_session_row_identity n JOIN sessions s ON s.id=n.session_id
             WHERE s.id=:session AND {SCHEMA_CURRENT}"),
            rusqlite::named_params! {":session":session, ":table_sql":TABLE,
                ":insert_sql":TRIGGERS[0].1, ":delete_sql":TRIGGERS[1].1, ":rename_sql":TRIGGERS[2].1},
            |row| row.get(0),
        ).optional().map_err(|error| error.to_string())?;
        token
            .map(|token| {
                Ok(SessionRowIdentity {
                    instance: self.native_instance_id(),
                    session: session.into(),
                    incarnation: token
                        .try_into()
                        .map_err(|_| "NATIVE_SESSION_IDENTITY_INVALID")?,
                })
            })
            .transpose()
    }

    pub(crate) fn session_row_identity_current(
        &self,
        identity: &SessionRowIdentity,
    ) -> Result<bool, String> {
        if self.native_instance_id() != identity.instance {
            return Ok(false);
        }
        let conn = self.lock_conn()?;
        self.session_row_identity_current_at(&conn, identity, &identity.session)
    }

    /// Checks Store, exact target, schema and incarnation in the supplied SQL
    /// snapshot. FULL checkpoints use this inside their actual transaction.
    pub(crate) fn session_row_identity_current_at(
        &self,
        conn: &Connection,
        identity: &SessionRowIdentity,
        session: &str,
    ) -> Result<bool, String> {
        if self.native_instance_id() != identity.instance || session != identity.session {
            return Ok(false);
        }
        conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM native_session_row_identity n JOIN sessions s ON s.id=n.session_id
             WHERE s.id=:session AND n.incarnation=:incarnation AND {SCHEMA_CURRENT})"),
            rusqlite::named_params! {":session":identity.session, ":incarnation":identity.incarnation.as_slice(),
                ":table_sql":TABLE, ":insert_sql":TRIGGERS[0].1, ":delete_sql":TRIGGERS[1].1, ":rename_sql":TRIGGERS[2].1},
            |row| row.get(0),
        ).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert(conn: &Connection, verb: &str, id: &str) {
        conn.execute(&format!("{verb} INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at)
          VALUES(?1,'/isolated','test','test','supervised','unchanged',1,1)"), [id]).unwrap();
    }

    #[test]
    fn native_insert_delete_reinsert_and_replace_invalidate_even_identical_payloads() {
        for replace in [false, true] {
            let store = SessionStore::open_in_memory().unwrap();
            insert(&store.lock_conn().unwrap(), "INSERT", "same");
            let original = store.capture_session_row_identity("same").unwrap().unwrap();
            {
                let conn = store.lock_conn().unwrap();
                conn.execute_batch("PRAGMA recursive_triggers=OFF").unwrap();
                if !replace {
                    conn.execute("DELETE FROM sessions WHERE id='same'", [])
                        .unwrap();
                }
                insert(
                    &conn,
                    if replace {
                        "INSERT OR REPLACE"
                    } else {
                        "INSERT"
                    },
                    "same",
                );
            }
            assert!(!store.session_row_identity_current(&original).unwrap());
            assert!(store
                .session_row_identity_current(
                    &store.capture_session_row_identity("same").unwrap().unwrap()
                )
                .unwrap());
        }
    }

    #[test]
    fn normal_upsert_and_update_preserve_but_rename_aba_invalidates() {
        let store = SessionStore::open_in_memory().unwrap();
        insert(&store.lock_conn().unwrap(), "INSERT", "same");
        let original = store.capture_session_row_identity("same").unwrap().unwrap();
        let conn = store.lock_conn().unwrap();
        conn.execute(
            "UPDATE sessions SET title='new',updated_at=2 WHERE id='same'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at)
          VALUES('same','/isolated','test','test','supervised','upsert',1,3)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated_at=excluded.updated_at",
            [],
        )
        .unwrap();
        drop(conn);
        assert!(store.session_row_identity_current(&original).unwrap());
        store.lock_conn().unwrap().execute_batch("UPDATE sessions SET id='other' WHERE id='same'; UPDATE sessions SET id='same' WHERE id='other'").unwrap();
        assert!(!store.session_row_identity_current(&original).unwrap());
    }

    #[test]
    fn schema_backfill_is_atomic_failure_preserves_rows_and_retry_does_not_rotate() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('legacy')",
        )
        .unwrap();
        use rusqlite::hooks::{AuthAction, Authorization};
        conn.authorizer(Some(
            |context: rusqlite::hooks::AuthContext<'_>| match context.action {
                AuthAction::CreateTrigger {
                    trigger_name: "native_session_identity_rename",
                    ..
                } => Authorization::Deny,
                _ => Authorization::Allow,
            },
        ))
        .unwrap();
        assert!(ensure_schema(&conn).is_err());
        conn.authorizer(None::<fn(rusqlite::hooks::AuthContext<'_>) -> Authorization>)
            .unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM sessions", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='native_session_row_identity'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        ensure_schema(&conn).unwrap();
        let before: Vec<u8> = conn
            .query_row(
                "SELECT incarnation FROM native_session_row_identity",
                [],
                |row| row.get(0),
            )
            .unwrap();
        ensure_schema(&conn).unwrap();
        let after: Vec<u8> = conn
            .query_row(
                "SELECT incarnation FROM native_session_row_identity",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn stale_trigger_repair_invalidates_existing_handles_and_unsafe_schema_rolls_back() {
        let store = SessionStore::open_in_memory().unwrap();
        insert(&store.lock_conn().unwrap(), "INSERT", "same");
        let identity = store.capture_session_row_identity("same").unwrap().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            conn.execute_batch("DROP TRIGGER native_session_identity_insert;
              CREATE TRIGGER native_session_identity_insert AFTER INSERT ON sessions BEGIN SELECT 1; END").unwrap();
            drop(conn);
            assert!(!store.session_row_identity_current(&identity).unwrap());
            assert!(store
                .capture_session_row_identity("same")
                .unwrap()
                .is_none());
            let conn = store.lock_conn().unwrap();
            ensure_schema(&conn).unwrap();
        }
        assert!(!store.session_row_identity_current(&identity).unwrap());
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('legacy');
          CREATE TABLE native_session_row_identity(session_id TEXT)",
        )
        .unwrap();
        assert!(ensure_schema(&conn).is_err());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM sessions", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn actual_store_upsert_keeps_identity_until_actual_store_delete_and_recreate() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut session: super::super::SessionUpsert = serde_json::from_value(serde_json::json!({
            "id":"ordinary", "cwd":"/isolated", "harness":"antigravity", "model":"test",
            "modelSettings":{}, "runtimeMode":"supervised", "title":"ordinary", "blocks":[]
        }))
        .unwrap();
        {
            let conn = store.lock_conn().unwrap();
            super::super::upsert_session_with_git(&conn, &session, Default::default(), None)
                .unwrap();
        }
        let identity = store
            .capture_session_row_identity("ordinary")
            .unwrap()
            .unwrap();
        session.title = "updated normally".into();
        {
            let conn = store.lock_conn().unwrap();
            super::super::upsert_session_with_git(&conn, &session, Default::default(), None)
                .unwrap();
        }
        assert!(store.session_row_identity_current(&identity).unwrap());
        {
            let conn = store.lock_conn().unwrap();
            super::super::delete_session(&conn, "ordinary").unwrap();
            super::super::upsert_session_with_git(&conn, &session, Default::default(), None)
                .unwrap();
        }
        assert!(!store.session_row_identity_current(&identity).unwrap());
    }
}
