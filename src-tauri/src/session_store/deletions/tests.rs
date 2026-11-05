use super::*;

fn sample(id: &str, sent: bool) -> SessionUpsert {
    serde_json::from_value(json!({
        "id": id, "cwd": "/isolated/deletion-tests", "harness": "codex", "model": "fixture",
        "runtimeMode": "approve", "modelSettings": {}, "title": "Retained history",
        "blocks": if sent { json!([{"id":"u1","role":"user","text":"Keep my work"}]) } else { json!([]) }
    })).unwrap()
}

#[test]
fn durable_delete_rejects_stale_full_and_legacy_writes_after_reopen() {
    let dir = std::env::temp_dir().join(format!("bycoda-deletion-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("isolated.sqlite");
    let stale = sample("deleted", true);
    let updated;
    let revision;
    {
        let store = SessionStore::open(path.clone()).unwrap();
        let conn = store.lock_conn().unwrap();
        updated = upsert_session(&conn, &stale).unwrap().updated_at;
        revision = conn
            .query_row(
                "SELECT revision FROM session_block_state WHERE session_id='deleted'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        upsert_session(&conn, &sample("survivor", true)).unwrap();
        delete_session(&conn, "deleted").unwrap();
    }
    {
        let store = SessionStore::open(path).unwrap();
        let conn = store.lock_conn().unwrap();
        assert!(get_session(&conn, "deleted").unwrap().is_none());
        assert!(get_session(&conn, "survivor").unwrap().is_some());
        assert_eq!(assert_readable(&conn, "deleted"), Err(DELETED.into()));
        assert_eq!(
            deleted_ids(&conn, &["deleted".into(), "never-saved".into()]).unwrap(),
            vec!["deleted"]
        );
        assert!(
            upsert_session_with_git(&conn, &stale, Default::default(), None)
                .unwrap_err()
                .to_string()
                .contains(DELETED)
        );
        assert!(
            upsert_session_with_git(&conn, &stale, Default::default(), Some(None))
                .unwrap_err()
                .to_string()
                .contains(DELETED)
        );
        // An older client that writes SQL directly cannot bypass the fence.
        assert!(conn.execute("INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at) VALUES('deleted','.','codex','fixture','approve','stale',1,1)",[]).unwrap_err().to_string().contains(DELETED));
        let delta = incremental::SessionDelta {
            session: stale,
            expected_updated_at: updated,
            expected_revision: revision,
            length: 1,
            changes: vec![],
        };
        assert!(incremental::apply(&conn, &delta).unwrap().is_none());
        assert!(get_session(&conn, "deleted").unwrap().is_none());
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn failed_delete_rolls_back_marker_and_keeps_transcript() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let session = sample("retained", true);
    upsert_session(&conn, &session).unwrap();
    conn.execute_batch("CREATE TRIGGER refuse_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;").unwrap();
    assert!(delete_session(&conn, "retained").is_err());
    assert!(assert_readable(&conn, "retained").is_ok());
    assert!(get_session(&conn, "retained").unwrap().is_some());
    upsert_session(&conn, &session).unwrap();
}

#[test]
fn explicit_delete_excludes_late_in_flight_replay_but_preserves_siblings() {
    let store = SessionStore::open_in_memory().unwrap();
    let mut conn = store.lock_conn().unwrap();
    for id in ["deleted", "survivor"] {
        upsert_session(&conn, &sample(id, true)).unwrap();
    }
    let refs = vec![
        InFlightSession {
            session_id: "deleted".into(),
            cwd: "/isolated".into(),
        },
        InFlightSession {
            session_id: "survivor".into(),
            cwd: "/isolated".into(),
        },
    ];
    replace_window_in_flight(&mut conn, "prior", "main", "old-page", &refs).unwrap();
    delete_session(&conn, "deleted").unwrap();
    replace_window_in_flight(&mut conn, "prior", "main", "old-page", &refs).unwrap();
    let recovered = list_interrupted_in_flight(&conn, |_, _| true).unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].session_id, "survivor");
    assert_eq!(list_in_flight(&conn).unwrap().len(), 1);
}

#[test]
fn unsent_draft_can_be_reused_but_submitted_or_deleted_ids_cannot() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let mut draft = sample("draft", false);
    draft.blocks = json!([{"id":"draft-user","role":"user","text":"Review later","draft":true}]);
    upsert_session(&conn, &draft).unwrap();
    let listed: bool = conn
        .query_row(
            "SELECT has_user_message FROM sessions WHERE id='draft'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(listed, "saved user drafts are listable, but not submitted");
    delete_session_with_mode(&conn, "draft", true).unwrap();
    upsert_session(&conn, &draft).unwrap();
    let mut sent = sample("draft", true);
    sent.blocks
        .as_array_mut()
        .unwrap()
        .push(draft.blocks[0].clone());
    upsert_session(&conn, &sent).unwrap();
    assert!(delete_session_with_mode(&conn, "draft", true).is_err());
    assert!(get_session(&conn, "draft").unwrap().is_some());
    delete_session(&conn, "draft").unwrap();
    delete_session_with_mode(&conn, "draft", true).unwrap();
    assert!(upsert_session_with_git(&conn, &draft, Default::default(), None).is_err());
    delete_session(&conn, "draft").unwrap();
    assert_eq!(assert_readable(&conn, "never-saved"), Ok(()));
}

#[test]
fn draft_discard_preserves_submitted_history_retained_only_by_rewind() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let mut draft = sample("rewound", false);
    draft.blocks = json!([{"id":"draft","role":"user","text":"Later","draft":true}]);
    draft.rewind_history =
        Some(json!([{"blocks":[{"id":"older-draft","role":"user","text":"Unsent","draft":true}]}]));
    upsert_session(&conn, &draft).unwrap();
    delete_session_with_mode(&conn, "rewound", true).unwrap();
    draft.rewind_history =
        Some(json!([{"blocks":[{"id":"submitted","role":"user","text":"Already sent"}]}]));
    upsert_session(&conn, &draft).unwrap();
    assert!(delete_session_with_mode(&conn, "rewound", true).is_err());
    let retained = get_session(&conn, "rewound").unwrap().unwrap();
    assert_eq!(retained.blocks, draft.blocks);
    assert_eq!(retained.rewind_history, draft.rewind_history);
    assert!(assert_readable(&conn, "rewound").is_ok());
}
