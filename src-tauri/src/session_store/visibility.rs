use rusqlite::Connection;

pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    // The Host's Zod schema measures UTF-16 units. For ambiguous lengths, walk
    // UTF-8 bytes so supplementary characters count twice and NUL stays visible.
    // Typical ASCII fields use the byte-count shortcut and never recurse.
    conn.execute_batch(r#"
        DROP VIEW IF EXISTS delegated_session_ids;
        CREATE VIEW delegated_session_ids AS
        WITH settings AS (
          SELECT id, CASE WHEN json_valid(model_settings) THEN CASE
            WHEN json_type(model_settings, '$.delegationParent')='text'
              AND (SELECT count(*) FROM json_each(model_settings) WHERE key='delegationParent')=1
            THEN json_extract(model_settings, '$.delegationParent') END END AS parent FROM sessions
        ), lineage AS (
          SELECT id, CASE WHEN typeof(parent)='text' AND length(parent)<=8192 AND json_valid(parent)
            THEN parent END AS parent FROM settings
        ), text_limits(key, max_units) AS (
          VALUES ('parentSessionId',128), ('runId',128), ('model',200), ('childRunId',128), ('error',2000)
        )
        SELECT id FROM lineage WHERE CASE WHEN json_type(parent)='object' THEN
          NOT EXISTS (SELECT 1 FROM json_each(lineage.parent) WHERE key NOT IN
            ('parentSessionId','runId','kind','model','startedAt','childRunId','round','status','error','finishedAt'))
          AND NOT EXISTS (SELECT 1 FROM json_each(lineage.parent) GROUP BY key HAVING count(*)>1)
          AND json_type(parent,'$.parentSessionId')='text' AND json_extract(parent,'$.parentSessionId')<>''
          AND json_type(parent,'$.runId')='text' AND json_extract(parent,'$.runId')<>''
          AND json_type(parent,'$.kind')='text' AND json_extract(parent,'$.kind') IN ('subagent','advisor')
          AND json_type(parent,'$.model')='text' AND json_extract(parent,'$.model')<>''
          AND json_type(parent,'$.startedAt')='integer' AND json_extract(parent,'$.startedAt')>=0
          AND (json_type(parent,'$.childRunId') IS NULL OR (json_type(parent,'$.childRunId')='text' AND json_extract(parent,'$.childRunId')<>''))
          AND (json_type(parent,'$.round') IS NULL OR (json_type(parent,'$.round')='integer' AND json_extract(parent,'$.round')>0))
          AND (json_type(parent,'$.status') IS NULL OR (json_type(parent,'$.status')='text' AND json_extract(parent,'$.status') IN ('succeeded','failed','cancelled')))
          AND (json_type(parent,'$.error') IS NULL OR json_type(parent,'$.error')='text')
          AND (json_type(parent,'$.finishedAt') IS NULL OR (json_type(parent,'$.finishedAt')='integer' AND json_extract(parent,'$.finishedAt')>=0))
          AND NOT EXISTS (
            SELECT 1 FROM json_each(lineage.parent) AS field JOIN text_limits USING(key)
            WHERE field.type='text' AND CASE
              WHEN length(CAST(field.value AS BLOB))<=max_units THEN 0
              WHEN length(field.value)>max_units THEN 1
              ELSE (
                WITH RECURSIVE units(pos, count) AS (
                  VALUES (1, 0)
                  UNION ALL
                  SELECT pos+1, count+CASE
                    WHEN hex(substr(CAST(field.value AS BLOB),pos,1)) BETWEEN '80' AND 'BF' THEN 0
                    WHEN hex(substr(CAST(field.value AS BLOB),pos,1))>='F0' THEN 2
                    ELSE 1 END
                  FROM units WHERE pos<=length(CAST(field.value AS BLOB)) AND count<=max_units
                )
                SELECT max(count)>max_units FROM units
              ) END
          )
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
    fn delegated_string_limits_match_host_utf16_lengths() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        for (id, model, error) in [
            ("boundary", "😀".repeat(100), "é".repeat(2000)),
            ("over-model", "😀".repeat(101), String::new()),
            (
                "embedded-nul",
                "a\0b".into(),
                format!("\0{}", "x".repeat(1999)),
            ),
            ("over-nul", "m".into(), format!("\0{}", "x".repeat(2000))),
            ("only-nul", "\0".into(), String::new()),
        ] {
            let parent = json!({"parentSessionId":"parent","runId":"run","kind":"subagent","model":model,"startedAt":1,"error":error});
            let settings = json!({"delegationParent":parent.to_string()}).to_string();
            conn.execute("INSERT INTO sessions(id,cwd,harness,model,model_settings,runtime_mode,title,blocks_json,created_at,updated_at,has_user_message) VALUES(?1,'/w','codex','m',?2,'supervised',?1,'[]',1,1,1)", params![id,settings]).unwrap();
        }
        let ids: Vec<String> = conn
            .prepare("SELECT id FROM delegated_session_ids ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(ids, ["boundary", "embedded-nul", "only-nul"]);
    }

    #[test]
    fn delegated_records_are_excluded_before_recent_limit() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let parent = json!({"parentSessionId":"parent","runId":"run","kind":"advisor","model":"m","startedAt":1,"childRunId":"turn","round":2,"status":"succeeded","error":"","finishedAt":3}).to_string();
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
        conn.execute("UPDATE sessions SET linked_work_item_json='{}'", [])
            .unwrap();
        assert_eq!(
            list_linked(&conn)
                .unwrap()
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            ["normal"]
        );
        conn.execute(
            "UPDATE sessions SET model_settings=?1 WHERE id='child'",
            [json!({"delegationParent":"{}"}).to_string()],
        )
        .unwrap();
        assert_eq!(list_recent(&conn, 1).unwrap()[0].id, "child");
    }

    #[test]
    fn duplicate_lineage_keys_are_not_hidden() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let parent = r#"{"parentSessionId":"parent","runId":"run","kind":"subagent","model":"m","startedAt":1}"#;
        let duplicate_parent = r#"{"parentSessionId":"parent","runId":"run","kind":"subagent","model":"m","startedAt":1,"kind":"other"}"#;
        let encoded = serde_json::to_string(parent).unwrap();
        let settings = [
            (
                "outer",
                format!(r#"{{"delegationParent":{encoded},"delegationParent":"{{}}"}}"#),
            ),
            (
                "inner",
                json!({"delegationParent":duplicate_parent}).to_string(),
            ),
        ];
        for (id, value) in settings {
            conn.execute("INSERT INTO sessions(id,cwd,harness,model,model_settings,runtime_mode,title,blocks_json,created_at,updated_at,has_user_message) VALUES(?1,'/w','codex','m',?2,'supervised',?1,'[]',1,1,1)", params![id,value]).unwrap();
        }
        let count: i64 = conn
            .query_row("SELECT count(*) FROM delegated_session_ids", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn existing_view_is_replaced_and_optional_fields_are_validated() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        conn.execute_batch("DROP VIEW delegated_session_ids; CREATE VIEW delegated_session_ids AS SELECT id FROM sessions WHERE 0;").unwrap();
        let valid = json!({"parentSessionId":"parent","runId":"run","kind":"subagent","model":"m","startedAt":1,"round":1,"status":"failed","childRunId":"turn","error":"oops","finishedAt":2});
        for (id, parent) in [
            ("valid", valid.clone()),
            ("bad-round", json!({"round":0})),
            ("bad-status", json!({"status":"running"})),
            ("bad-error", json!({"error":null})),
            ("bad-finished", json!({"finishedAt":-1})),
            ("bad-child", json!({"childRunId":""})),
            ("unknown", json!({"extra":true})),
        ] {
            let mut value = valid.clone();
            value
                .as_object_mut()
                .unwrap()
                .extend(parent.as_object().unwrap().clone());
            let settings = json!({"delegationParent":value.to_string()}).to_string();
            conn.execute("INSERT INTO sessions(id,cwd,harness,model,model_settings,runtime_mode,title,blocks_json,created_at,updated_at,has_user_message) VALUES(?1,'/w','codex','m',?2,'supervised',?1,'[]',1,1,1)", params![id,settings]).unwrap();
        }
        super::ensure_schema(&conn).unwrap();
        let ids: Vec<String> = conn
            .prepare("SELECT id FROM delegated_session_ids ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(ids, ["valid"]);
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
                    let parent = json!({"parentSessionId":"parent","runId":id,"kind":if index % 2 == 0 {"advisor"} else {"subagent"},"model":"m","startedAt":1,"round":1,"status":"succeeded"}).to_string();
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
