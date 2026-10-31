//! Read-only locators for existing local conversations. These commands never
//! qualify writers, reconcile work, unarchive rows or begin an authority transfer.

use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum LocalSessionLocator {
    #[serde(rename_all = "camelCase")]
    Native {
        source_store_id: String,
        source_profile_id: String,
        session_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Host {
        environment_id: String,
        session_id: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReferenceMetadata {
    pub locator: LocalSessionLocator,
    pub title: String,
    pub cwd: String,
    pub archived: bool,
    pub updated_at: i64,
}

impl SessionStore {
    pub(crate) fn local_session_reference(
        &self,
        session_id: &str,
        expected_origin: Option<(&str, &str)>,
    ) -> Result<Option<SessionReferenceMetadata>, String> {
        validate_id(session_id, "session")?;
        let read = self.with_read_conn(|conn| {
            let tx = rusqlite::Transaction::new_unchecked(
                conn,
                rusqlite::TransactionBehavior::Deferred,
            ).map_err(|e| e.to_string())?;
            let origin: (String, String) = tx.query_row(
                "SELECT source_store_id,source_profile_id FROM native_authority_identity WHERE id=1",
                [], |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|e| e.to_string())?;
            // Reject another profile before even reading its session metadata.
            if expected_origin.is_some_and(|(store, profile)| store != origin.0 || profile != origin.1) {
                return Ok(None);
            }
            let metadata = tx.query_row(
                "SELECT title,cwd,archived,updated_at FROM sessions WHERE id=?1",
                [session_id],
                |row| Ok(SessionReferenceMetadata {
                    locator: LocalSessionLocator::Native {
                        source_store_id: origin.0.clone(),
                        source_profile_id: origin.1.clone(),
                        session_id: session_id.into(),
                    },
                    title: row.get(0)?, cwd: row.get(1)?,
                    archived: row.get(2)?, updated_at: row.get(3)?,
                }),
            ).optional().map_err(|e| e.to_string())?;
            let Some(metadata) = metadata else { return Ok(None) };
            let authority: Option<(String, String, String)> = tx.query_row(
                "SELECT phase,environment_id,migration_id FROM native_authority_floor WHERE session_id=?1",
                [session_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
            ).optional().map_err(|e| e.to_string())?;
            let mapping = match authority {
                None => None,
                Some((phase, _, _)) if phase == "NATIVE" => None,
                Some((phase, environment, migration)) if phase == "HOST" || phase == "CACHE" => {
                    let raw: Option<String> = tx.query_row(
                        "SELECT host_decision_json FROM native_authority_journal WHERE migration_id=?1",
                        [&migration], |row| row.get(0),
                    ).optional().map_err(|e| e.to_string())?.flatten();
                    let decision: Value = serde_json::from_str(raw.as_deref().ok_or("SESSION_REFERENCE_UNAVAILABLE")?)
                        .map_err(|_| "SESSION_REFERENCE_UNAVAILABLE")?;
                    let digest = decision.get("decisionDigest").and_then(Value::as_str)
                        .ok_or("SESSION_REFERENCE_UNAVAILABLE")?.to_owned();
                    Some((environment, migration, digest))
                },
                // In-flight, blocked and unknown ownership cannot become a native
                // fallback. A click is never an authority-recovery operation.
                Some(_) => return Ok(None),
            };
            tx.commit().map_err(|e| e.to_string())?;
            Ok(Some((metadata,mapping)))
        })?;
        let Some((mut metadata, mapping)) = read else {
            return Ok(None);
        };
        if let Some((environment_id, migration_id, digest)) = mapping {
            // The existing validator proves the committed decision against its
            // persisted fence, identity, floor, journal and receipt. Merely
            // finding a Host environment in a row is not sufficient evidence.
            let applied = self.authority_applied_host_decision(&migration_id, &digest)?;
            let decision: Value = serde_json::from_str(&applied).map_err(|e| e.to_string())?;
            if decision.get("phase").and_then(Value::as_str) != Some("host-active")
                || decision.get("environmentId").and_then(Value::as_str) != Some(&environment_id)
                || decision.get("sessionId").and_then(Value::as_str) != Some(session_id)
            {
                return Err("SESSION_REFERENCE_UNAVAILABLE".into());
            }
            metadata.locator = LocalSessionLocator::Host {
                environment_id,
                session_id: session_id.into(),
            };
        }
        Ok(Some(metadata))
    }
}

#[tauri::command]
pub async fn session_reference_get(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Option<SessionReferenceMetadata>, String> {
    crate::harness::run_blocking("session_reference_get", move || {
        let store = app.state::<crate::session_store::SessionStore>();
        store.local_session_reference(&session_id, None)
    })
    .await
}

#[tauri::command]
pub async fn session_reference_resolve(
    app: tauri::AppHandle,
    source_store_id: String,
    source_profile_id: String,
    session_id: String,
) -> Result<Option<SessionReferenceMetadata>, String> {
    crate::harness::run_blocking("session_reference_resolve", move || {
        let store = app.state::<crate::session_store::SessionStore>();
        validate_id(&source_store_id, "store")?;
        validate_id(&source_profile_id, "profile")?;
        store.local_session_reference(&session_id, Some((&source_store_id, &source_profile_id)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(store: &SessionStore) {
        let session: SessionUpsert = serde_json::from_value(json!({
            "id":"same-id", "cwd":"/project", "harness":"codex", "model":"fixture",
            "runtimeMode":"approve", "title":"Original", "modelSettings":{}, "blocks":[],
        }))
        .unwrap();
        upsert_session_with_git(
            &store.lock_conn().unwrap(),
            &session,
            crate::fs::GitInfo::default(),
            None,
        )
        .unwrap();
    }

    #[test]
    fn identity_survives_rename_and_reopen_without_mutating_archive_or_transcript() {
        let path =
            std::env::temp_dir().join(format!("bycoda-reference-{}.db", uuid::Uuid::new_v4()));
        let before;
        {
            let store = SessionStore::open(path.clone()).unwrap();
            seed(&store);
            before = store
                .local_session_reference("same-id", None)
                .unwrap()
                .unwrap()
                .locator;
            store
                .lock_conn()
                .unwrap()
                .execute(
                    "UPDATE sessions SET title='Renamed',archived=1 WHERE id='same-id'",
                    [],
                )
                .unwrap();
        }
        {
            let store = SessionStore::open(path.clone()).unwrap();
            let result = store
                .local_session_reference("same-id", None)
                .unwrap()
                .unwrap();
            assert_eq!(result.locator, before);
            assert_eq!(result.title, "Renamed");
            assert!(result.archived);
            assert_eq!(
                store
                    .lock_conn()
                    .unwrap()
                    .query_row(
                        "SELECT blocks_json FROM sessions WHERE id='same-id'",
                        [],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "[]"
            );
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn other_profile_and_missing_session_do_not_resolve() {
        let a = SessionStore::open_in_memory().unwrap();
        let b = SessionStore::open_in_memory().unwrap();
        seed(&a);
        seed(&b);
        let origin = a.authority_identity().unwrap();
        assert!(b
            .local_session_reference(
                "same-id",
                Some((&origin.source_store_id, &origin.source_profile_id))
            )
            .unwrap()
            .is_none());
        assert!(a
            .local_session_reference("missing", None)
            .unwrap()
            .is_none());
        assert!(a
            .local_session_reference(
                "same-id",
                Some((&origin.source_store_id, &origin.source_profile_id))
            )
            .unwrap()
            .is_some());
    }

    #[test]
    fn wrong_origin_is_rejected_before_metadata_and_valid_reads_are_query_only() {
        use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
        let store = SessionStore::open_in_memory().unwrap();
        seed(&store);
        store
            .lock_conn()
            .unwrap()
            .authorizer(Some(|context: AuthContext<'_>| {
                if matches!(
                    context.action,
                    AuthAction::Read {
                        table_name: "sessions",
                        ..
                    }
                ) {
                    Authorization::Deny
                } else {
                    Authorization::Allow
                }
            }))
            .unwrap();
        assert!(store
            .local_session_reference("same-id", Some(("other-store", "other-profile")))
            .unwrap()
            .is_none());
        store
            .lock_conn()
            .unwrap()
            .authorizer(Some(|context: AuthContext<'_>| {
                if matches!(
                    context.action,
                    AuthAction::Insert { .. }
                        | AuthAction::Update { .. }
                        | AuthAction::Delete { .. }
                        | AuthAction::Read {
                            table_name: "sessions",
                            column_name: "blocks_json"
                        }
                ) {
                    Authorization::Deny
                } else {
                    Authorization::Allow
                }
            }))
            .unwrap();
        assert!(store
            .local_session_reference("same-id", None)
            .unwrap()
            .is_some());
    }

    #[test]
    fn host_floor_alone_is_not_a_verified_mapping() {
        let store = SessionStore::open_in_memory().unwrap();
        seed(&store);
        store
            .authority_begin_quiesce("environment", "same-id", "migration", 0)
            .unwrap();
        store
            .lock_conn()
            .unwrap()
            .execute(
                "UPDATE native_authority_floor SET phase='HOST' WHERE session_id='same-id'",
                [],
            )
            .unwrap();
        assert!(store.local_session_reference("same-id", None).is_err());
    }

    #[test]
    fn reads_do_not_start_migration_and_quiescing_is_not_native_fallback() {
        let store = SessionStore::open_in_memory().unwrap();
        seed(&store);
        let before: i64 = store
            .lock_conn()
            .unwrap()
            .query_row("SELECT count(*) FROM native_authority_floor", [], |r| {
                r.get(0)
            })
            .unwrap();
        store
            .local_session_reference("same-id", None)
            .unwrap()
            .unwrap();
        let after: i64 = store
            .lock_conn()
            .unwrap()
            .query_row("SELECT count(*) FROM native_authority_floor", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!((before, after), (0, 0));
        store
            .authority_begin_quiesce("environment", "same-id", "migration", 0)
            .unwrap();
        assert!(store
            .local_session_reference("same-id", None)
            .unwrap()
            .is_none());
    }
}
