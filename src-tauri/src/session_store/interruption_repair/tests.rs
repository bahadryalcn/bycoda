use super::*;

fn session(id: &str, suffix: Value) -> SessionUpsert {
    let mut blocks = vec![
        json!({"id":"u","role":"user","text":"Work"}),
        json!({"id":"stop","role":"system","notice":"interrupt","text":"  Stopped by you.\n"}),
    ];
    blocks.extend(suffix.as_array().unwrap().iter().cloned());
    serde_json::from_value(json!({"id":id,"cwd":"/isolated","harness":"codex","model":"fixture","runtimeMode":"approve","modelSettings":{},"title":"Stopped","blocks":blocks})).unwrap()
}

#[test]
fn exact_owner_stop_quit_tail_is_idle_in_full_normalized_and_legacy_projections() {
    for legacy in [false, true] {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        for (id, suffix, interrupted) in [
            (
                "false-quit",
                json!([{"id":"quit","role":"system","notice":"interrupt","text":"Turn interrupted when bycoda quit."}]),
                false,
            ),
            (
                "false-old-quit",
                json!([{"id":"quit","role":"system","text":"Turn interrupted when Bycoda quit."}]),
                false,
            ),
            (
                "real-host",
                json!([{"id":"host","role":"system","notice":"interrupt","text":"Host restarted. This turn was interrupted; inspect its work before continuing."}]),
                true,
            ),
            (
                "real-turn",
                json!([{"id":"new-user","role":"user","text":"Next"},{"id":"quit","role":"system","notice":"interrupt","text":"Turn interrupted when bycoda quit."}]),
                true,
            ),
        ] {
            let s = session(id, suffix);
            let saved = upsert_session_with_git(&conn, &s, Default::default(), None)
                .unwrap()
                .unwrap();
            assert_eq!(saved.interrupted, interrupted, "{id}");
            if legacy {
                conn.execute("DELETE FROM session_block_state WHERE session_id=?1", [id])
                    .unwrap();
                conn.execute("DELETE FROM session_blocks WHERE session_id=?1", [id])
                    .unwrap();
                conn.execute(
                    "UPDATE sessions SET blocks_json=?2 WHERE id=?1",
                    params![id, s.blocks.to_string()],
                )
                .unwrap();
            }
            assert_eq!(
                stored_turn_interrupted(&conn, id).unwrap(),
                interrupted,
                "{id}, legacy={legacy}"
            );
            assert_eq!(get_session(&conn, id).unwrap().unwrap().blocks, s.blocks);
        }
    }
}

#[test]
fn existing_cached_warning_repair_is_atomic_resumable_and_one_time() {
    for legacy in [false, true] {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let s = session(
            "stopped",
            json!([{"id":"quit","role":"system","notice":"interrupt","text":"Turn interrupted when bycoda quit."}]),
        );
        upsert_session(&conn, &s).unwrap();
        if legacy {
            conn.execute(
                "DELETE FROM session_block_state WHERE session_id='stopped'",
                [],
            )
            .unwrap();
            conn.execute("DELETE FROM session_blocks WHERE session_id='stopped'", [])
                .unwrap();
            conn.execute(
                "UPDATE sessions SET blocks_json=?1 WHERE id='stopped'",
                [s.blocks.to_string()],
            )
            .unwrap();
            update_list_summary(&conn, "stopped", "codex").unwrap();
        }
        conn.execute(
            "UPDATE session_list_summaries SET interrupted=1 WHERE session_id='stopped'",
            [],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM session_list_summary_repairs WHERE name=?1",
            [REPAIR],
        )
        .unwrap();
        conn.execute_batch("CREATE TRIGGER refuse_summary_repair BEFORE UPDATE ON session_list_summaries BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;").unwrap();
        assert!(repair_owner_stop_summaries(&conn).is_err());
        let old: bool = conn
            .query_row(
                "SELECT interrupted FROM session_list_summaries WHERE session_id='stopped'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(old);
        conn.execute_batch("DROP TRIGGER refuse_summary_repair;")
            .unwrap();
        ensure_list_summaries(&conn).unwrap();
        assert!(!list_recent(&conn, 10).unwrap()[0].interrupted);
        assert_eq!(
            get_session(&conn, "stopped").unwrap().unwrap().blocks,
            s.blocks
        );
        let before = conn.total_changes();
        repair_owner_stop_summaries(&conn).unwrap();
        assert_eq!(
            conn.total_changes(),
            before,
            "completed migration must not rewrite or scan history"
        );
    }
}
