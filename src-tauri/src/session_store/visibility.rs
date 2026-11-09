use rusqlite::Connection;

pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(r#"
        CREATE VIEW IF NOT EXISTS delegated_session_ids AS
        WITH settings AS (
          SELECT id, CASE WHEN json_valid(model_settings) THEN CASE
            WHEN json_type(model_settings, '$.delegationParent')='text'
            THEN json_extract(model_settings, '$.delegationParent') END END AS parent FROM sessions
        ), lineage AS (
          SELECT id, CASE WHEN typeof(parent)='text' AND length(parent)<=8192 AND json_valid(parent)
            THEN parent END AS parent FROM settings
        )
        SELECT id FROM lineage WHERE CASE WHEN json_type(parent)='object' THEN
          (SELECT count(*) FROM json_each(lineage.parent))=5
          AND json_type(parent,'$.parentSessionId')='text' AND length(json_extract(parent,'$.parentSessionId')) BETWEEN 1 AND 128
          AND json_type(parent,'$.runId')='text' AND length(json_extract(parent,'$.runId')) BETWEEN 1 AND 128
          AND json_type(parent,'$.kind')='text' AND json_extract(parent,'$.kind') IN ('subagent','advisor')
          AND json_type(parent,'$.model')='text' AND length(json_extract(parent,'$.model')) BETWEEN 1 AND 200
          AND json_type(parent,'$.startedAt')='integer' AND json_extract(parent,'$.startedAt')>=0
          ELSE 0 END;
        CREATE TRIGGER IF NOT EXISTS recent_revision_delegation_update
        AFTER UPDATE OF model_settings ON sessions
        WHEN OLD.model_settings IS NOT NEW.model_settings
        BEGIN UPDATE recent_session_revision SET revision=revision+1 WHERE id=1; END;
    "#)
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use serde_json::json;

    #[test]
    fn delegated_records_are_excluded_before_recent_limit() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let parent = json!({"parentSessionId":"parent","runId":"run","kind":"advisor","model":"m","startedAt":1}).to_string();
        let settings = json!({"delegationParent":parent}).to_string();
        for (id, time, value) in [("normal", 1, "{}"), ("child", 2, settings.as_str())] {
            conn.execute("INSERT INTO sessions(id,cwd,harness,model,model_settings,runtime_mode,title,blocks_json,created_at,updated_at,has_user_message) VALUES(?1,'/w','codex','m',?2,'supervised',?1,'[]',?3,?3,1)", params![id,value,time]).unwrap();
        }
        let rows = list_recent(&conn, 1).unwrap();
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["normal"]
        );
        assert!(get_session(&conn, "child").unwrap().is_some());
        assert_eq!(list_by_project(&conn, "/w").unwrap().len(), 1);
        conn.execute(
            "UPDATE sessions SET model_settings=?1 WHERE id='child'",
            [json!({"delegationParent":"{}"}).to_string()],
        )
        .unwrap();
        assert_eq!(list_recent(&conn, 1).unwrap()[0].id, "child");
    }

    #[test]
    fn delegated_records_are_excluded_before_content_search_limit() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            let blocks = json!([{"id":"message","role":"user","text":"searchneedle"}]).to_string();
            for index in 0..64 {
                let id = format!("session-{index}");
                let settings = if index < 2 {
                    if index == 0 {
                        "{}".to_string()
                    } else {
                        json!({"delegationParent":"{}"}).to_string()
                    }
                } else {
                    let parent = json!({"parentSessionId":"parent","runId":id,"kind":if index % 2 == 0 {"advisor"} else {"subagent"},"model":"m","startedAt":1}).to_string();
                    json!({"delegationParent":parent}).to_string()
                };
                conn.execute("INSERT INTO sessions(id,cwd,harness,model,model_settings,runtime_mode,title,blocks_json,created_at,updated_at,has_user_message) VALUES(?1,'/w','codex','m',?2,'supervised','Title',?3,1,?4,1)", params![id, settings, blocks, index]).unwrap();
            }
        }
        super::super::content_search::sync_index(&store, None, &|| true).unwrap();
        let result = super::super::content_search::search_content(
            &store,
            &ContentSearchOptions {
                query: "searchneedle".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let ids: Vec<_> = result
            .sessions
            .iter()
            .map(|session| session.session_id.as_str())
            .collect();
        assert_eq!(ids, vec!["session-1", "session-0"]);
        assert!(!result.truncated);
        assert!(result.sessions.iter().all(|session| session.hit_count == 1));
    }
}
