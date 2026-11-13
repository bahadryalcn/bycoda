use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMigrationReceipt {
    automation_id: String,
    receipt: String,
    target_host_id: String,
    snapshot: String,
    pub(super) phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    host_automation_id: Option<String>,
}

pub(super) fn require_native_owner(conn: &Connection, id: &str) -> Result<(), String> {
    let frozen: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_host_migrations WHERE automation_id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if frozen {
        return Err(
            "Automation scheduling has been transferred to the Host migration protocol.".into(),
        );
    }
    Ok(())
}

pub(super) fn receipt(conn: &Connection, id: &str) -> Result<Option<HostMigrationReceipt>, String> {
    conn.query_row(
        "SELECT value FROM automation_host_migrations WHERE automation_id=?1",
        [id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
    .transpose()
}

#[tauri::command(async)]
pub fn automations_host_migrations_list(
    store: State<'_, SessionStore>,
) -> Result<Vec<HostMigrationReceipt>, String> {
    store.with_read_conn(|conn| {
        let mut statement = conn
            .prepare("SELECT value FROM automation_host_migrations ORDER BY automation_id")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.map(|row| {
            serde_json::from_str(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())
        })
        .collect()
    })
}

fn prepare(
    conn: &Connection,
    automation_id: String,
    target_host_id: String,
) -> Result<HostMigrationReceipt, String> {
    validate_id(&automation_id, "automation")?;
    if target_host_id.trim().is_empty() || target_host_id.len() > 200 {
        return Err("Invalid target Host identity.".into());
    }
    if let Some(existing) = receipt(conn, &automation_id)? {
        if existing.target_host_id != target_host_id {
            return Err("Automation migration belongs to another Host.".into());
        }
        return Ok(existing);
    }
    let automation = get(conn, &automation_id)?.ok_or("Automation not found.")?;
    if automation.prompt.chars().count() > 256_000 {
        return Err(
            "This automation prompt exceeds the Host limit; its native schedule was retained."
                .into(),
        );
    }
    if is_ssh(&automation)
        || automation.reuse_session
        || automation.workspace_mode.as_deref() == Some("existing")
        || !automation.session_folder_id.is_empty()
    {
        return Err(
            "This automation requires native session or SSH semantics; its schedule was retained."
                .into(),
        );
    }
    let triggers = automation.triggers.as_deref().unwrap_or(&[]);
    if automation.trigger_kind != "time"
        || triggers.len() > 1
        || triggers.iter().any(|trigger| trigger.kind != "time")
    {
        return Err(
            "This automation has native event or multiple triggers; its schedule was retained."
                .into(),
        );
    }
    let runs = list_runs(conn, &automation_id)?;
    if runs.iter().any(|run| {
        !matches!(
            run.status.as_str(),
            "succeeded" | "failed" | "skipped" | "cancelled"
        )
    }) {
        return Err(
            "Wait for the original automation occurrence to settle before migration.".into(),
        );
    }
    let snapshot =
        serde_json::to_string(&serde_json::json!({ "automation": automation, "runs": runs }))
            .map_err(|error| error.to_string())?;
    if snapshot.len() > 32_000_000 {
        return Err("Automation history exceeds the Host migration limit; its native schedule was retained.".into());
    }
    let result = HostMigrationReceipt {
        automation_id: automation_id.clone(),
        receipt: Uuid::new_v4().to_string(),
        target_host_id,
        snapshot,
        phase: "prepared".into(),
        host_automation_id: None,
    };
    conn.execute(
        "INSERT INTO automation_host_migrations(automation_id,value) VALUES(?1,?2)",
        params![
            automation_id,
            serde_json::to_string(&result).map_err(|error| error.to_string())?
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command(async)]
pub fn automations_host_prepare(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    automation_id: String,
    target_host_id: String,
) -> Result<HostMigrationReceipt, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        let mut conn = store.lock_conn()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let result = prepare(&tx, automation_id, target_host_id)?;
        tx.commit().map_err(|error| error.to_string())?;
        let _ = window.app_handle().emit(CHANGED, ());
        Ok(result)
    })
}

#[tauri::command(async)]
pub fn automations_host_commit(
    window: tauri::Window,
    store: State<'_, SessionStore>,
    automation_id: String,
    receipt: String,
    target_host_id: String,
    host_automation_id: String,
) -> Result<HostMigrationReceipt, String> {
    crate::native_window_lifecycle::persistence_write(&window, || {
        validate_id(&host_automation_id, "Host automation")?;
        let mut conn = store.lock_conn()?;
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let mut existing =
            self::receipt(&tx, &automation_id)?.ok_or("Automation migration was not prepared.")?;
        if existing.receipt != receipt
            || existing.target_host_id != target_host_id
            || existing
                .host_automation_id
                .as_ref()
                .is_some_and(|id| id != &host_automation_id)
        {
            return Err("Automation migration receipt does not match.".into());
        }
        existing.phase = "committed".into();
        existing.host_automation_id = Some(host_automation_id);
        tx.execute(
            "UPDATE automation_host_migrations SET value=?1 WHERE automation_id=?2",
            params![
                serde_json::to_string(&existing).map_err(|error| error.to_string())?,
                automation_id
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        let _ = window.app_handle().emit(CHANGED, ());
        Ok(existing)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition() -> Automation {
        serde_json::from_value(serde_json::json!({
            "id":"audit","name":"Audit","prompt":"Inspect source","harness":"codex","model":"model",
            "cwd":"/project","reuseSession":false,"runtimeMode":"supervised","triggerKind":"time",
            "scheduleKind":"daily","minute":0,"time":"09:00","dayOfWeek":1,"missedRunGraceMinutes":720,
            "enabled":true,"nextRunAt":1000,"createdAt":1,"updatedAt":2
        })).unwrap()
    }

    #[test]
    fn prepare_is_idempotent_freezes_admission_and_retains_original_definition() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_tables(&conn).unwrap();
        let original = definition();
        write_automation(&conn, &original).unwrap();
        let first = prepare(&conn, original.id.clone(), "target-host".into()).unwrap();
        let replay = prepare(&conn, original.id.clone(), "target-host".into()).unwrap();
        assert_eq!(first.receipt, replay.receipt);
        assert_eq!(first.snapshot, replay.snapshot);
        assert!(require_native_owner(&conn, &original.id).is_err());
        let retained = get(&conn, &original.id).unwrap().unwrap();
        assert!(retained.enabled);
        assert_eq!(retained.next_run_at, original.next_run_at);
        assert!(prepare(&conn, original.id, "different-host".into()).is_err());
    }

    #[test]
    fn original_active_or_unknown_occurrences_prevent_freezing_schedule() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_tables(&conn).unwrap();
        let original = definition();
        write_automation(&conn, &original).unwrap();
        let mut run = new_run(&original.id, "manual", 1, 1, &original.prompt);
        for status in ["pending", "running", "unknown"] {
            run.status = status.into();
            write_run(&conn, &run).unwrap();
            assert!(prepare(&conn, original.id.clone(), "target-host".into()).is_err());
            assert!(require_native_owner(&conn, &original.id).is_ok());
        }
        run.status = "succeeded".into();
        write_run(&conn, &run).unwrap();
        let prepared = prepare(&conn, original.id, "target-host".into()).unwrap();
        assert!(prepared.snapshot.contains(&run.id));
    }

    #[test]
    fn unsupported_session_semantics_remain_native_without_a_receipt() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_tables(&conn).unwrap();
        let mut original = definition();
        original.reuse_session = true;
        write_automation(&conn, &original).unwrap();
        assert!(prepare(&conn, original.id.clone(), "target-host".into()).is_err());
        assert!(receipt(&conn, &original.id).unwrap().is_none());
        assert!(require_native_owner(&conn, &original.id).is_ok());
        assert!(get(&conn, &original.id).unwrap().unwrap().enabled);
    }
}
