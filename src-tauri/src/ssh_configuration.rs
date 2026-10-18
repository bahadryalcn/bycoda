//! Explicit personal group binding. Lock order is connection store, then SQLite.
use crate::{
    remote, server_inventory, session_store::SessionStore, ssh_group_defaults as groups,
    ssh_security::SshEndpoint,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigurationReview {
    connection_id: String,
    inheritance: Option<groups::Inheritance>,
    configuration: groups::Effective,
}

fn selection(record: &Value) -> Result<Option<groups::Inheritance>, String> {
    record
        .get("metadata")
        .and_then(|value| value.get("sshInheritance"))
        .filter(|value| !value.is_null())
        .map(|value| {
            serde_json::from_value(value.clone())
                .map_err(|_| "Invalid SSH inheritance binding".into())
        })
        .transpose()
}

fn effective(
    app: &AppHandle,
    record: &Value,
    inheritance: Option<&groups::Inheritance>,
) -> Result<groups::Effective, String> {
    let base = server_inventory::project(record)?
        .ssh_endpoint
        .ok_or("Group defaults require a personal SSH connection")?;
    let store = app.state::<SessionStore>();
    let conn = store.lock_conn()?;
    let group = inheritance
        .map(|binding| groups::get(&conn, &binding.group_id))
        .transpose()?
        .flatten();
    let resolved = groups::resolve(&base, inheritance, group.as_ref())?;
    let _ = crate::ssh_environment::remote_command(&runtime_endpoint(resolved.clone()), None)?;
    Ok(resolved)
}

/// Caller holds the canonical connection-store lock. Never migrates legacy labels.
pub(crate) fn resolve_record(app: &AppHandle, record: &Value) -> Result<SshEndpoint, String> {
    let inheritance = selection(record)?;
    if inheritance.is_none() {
        return server_inventory::project(record)?
            .ssh_endpoint
            .ok_or("Not a personal SSH connection".into());
    }
    let resolved = effective(app, record, inheritance.as_ref())?;
    Ok(runtime_endpoint(resolved))
}

pub(crate) fn runtime_endpoint(resolved: groups::Effective) -> SshEndpoint {
    let mut endpoint = resolved.endpoint;
    endpoint.runtime_configuration = Some(std::sync::Arc::new(
        crate::ssh_security::RuntimeConfiguration {
            digest: resolved.digest,
            environment: resolved.environment,
            shell_kind: resolved.shell_kind,
            provenance: resolved.provenance,
        },
    ));
    endpoint
}

#[tauri::command(async)]
pub(crate) fn ssh_group_defaults_list(
    state: State<'_, SessionStore>,
) -> Result<Vec<groups::GroupDefaults>, String> {
    let conn = state.lock_conn()?;
    groups::list(&conn)
}

#[tauri::command(async)]
pub(crate) fn ssh_group_defaults_save(
    app: AppHandle,
    connections: State<'_, remote::RemoteConnections>,
    state: State<'_, SessionStore>,
    profile: groups::GroupDefaults,
    expected_revision: Option<u64>,
) -> Result<groups::GroupDefaults, String> {
    let _guard = connections
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let conn = state.lock_conn()?;
    let saved = groups::save_cas(&conn, &profile, expected_revision)?;
    drop(conn);
    let _ = app.emit("server-inventory-changed", ());
    Ok(saved)
}

#[tauri::command(async)]
pub(crate) fn ssh_group_defaults_remove(
    app: AppHandle,
    connections: State<'_, remote::RemoteConnections>,
    state: State<'_, SessionStore>,
    id: String,
    expected_revision: u64,
) -> Result<(), String> {
    let _guard = connections
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let records = remote::read_store_values(&remote::store_path(&app)?)?;
    if records.iter().any(|record| {
        record
            .pointer("/metadata/sshInheritance/groupId")
            .and_then(Value::as_str)
            == Some(id.as_str())
    }) {
        return Err("This SSH defaults group is still used by a connection".into());
    }
    let conn = state.lock_conn()?;
    groups::delete_cas(&conn, &id, expected_revision)?;
    drop(conn);
    let _ = app.emit("server-inventory-changed", ());
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn server_ssh_configuration_preview(
    app: AppHandle,
    connections: State<'_, remote::RemoteConnections>,
    connection_id: String,
    inheritance: Option<groups::Inheritance>,
    use_saved: bool,
) -> Result<ConfigurationReview, String> {
    let _guard = connections
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let records = remote::read_store_values(&remote::store_path(&app)?)?;
    let record = records
        .iter()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(connection_id.as_str()))
        .ok_or("Server no longer exists")?;
    let inheritance = if use_saved {
        selection(record)?
    } else {
        inheritance
    };
    let configuration = effective(&app, record, inheritance.as_ref())?;
    Ok(ConfigurationReview {
        connection_id,
        inheritance,
        configuration,
    })
}

#[tauri::command(async)]
pub(crate) fn server_ssh_inheritance_set(
    app: AppHandle,
    connections: State<'_, remote::RemoteConnections>,
    connection_id: String,
    inheritance: Option<groups::Inheritance>,
    expected_inheritance: Option<groups::Inheritance>,
    expected_configuration_digest: String,
) -> Result<(), String> {
    let _guard = connections
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let mut records = remote::read_store_values(&path)?;
    let record = records
        .iter_mut()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(connection_id.as_str()))
        .ok_or("Server no longer exists")?;
    let configuration = effective(&app, record, inheritance.as_ref())?;
    apply_reviewed_binding(
        record,
        inheritance,
        expected_inheritance.as_ref(),
        &expected_configuration_digest,
        &configuration.digest,
    )?;
    remote::write_store_values(&path, &records)?;
    let _ = app.emit("server-inventory-changed", ());
    Ok(())
}

fn apply_reviewed_binding(
    record: &mut Value,
    inheritance: Option<groups::Inheritance>,
    expected_inheritance: Option<&groups::Inheritance>,
    expected_digest: &str,
    current_digest: &str,
) -> Result<(), String> {
    if selection(record)?.as_ref() != expected_inheritance {
        return Err("SSH inheritance changed. Review the current connection before saving".into());
    }
    if expected_digest != current_digest {
        return Err("SSH defaults or connection changed. Request a new preview".into());
    }
    if record.get("metadata").is_none() {
        record["metadata"] = serde_json::json!({});
    }
    record["metadata"]["sshInheritance"] =
        serde_json::to_value(inheritance).map_err(|_| "Invalid SSH inheritance binding")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reviewed_binding_preserves_ids_local_overrides_and_other_session_metadata() {
        let mut record = serde_json::json!({"id":"existing-id","kind":"ssh","sshEndpoint":{"host":"target.example","port":2222,"user":"local-override"},"metadata":{"group":"legacy-label","favorite":true,"tags":["other-session"],"future":{"keep":true}}});
        let original = record.clone();
        let binding = groups::Inheritance {
            group_id: "group-1".into(),
            fields: vec![groups::InheritedField::User],
            environment: false,
        };
        apply_reviewed_binding(
            &mut record,
            Some(binding.clone()),
            None,
            "current",
            "current",
        )
        .unwrap();
        assert_eq!(record["id"], original["id"]);
        assert_eq!(record["sshEndpoint"], original["sshEndpoint"]);
        for key in ["group", "favorite", "tags", "future"] {
            assert_eq!(record["metadata"][key], original["metadata"][key]);
        }
        assert_eq!(selection(&record).unwrap(), Some(binding.clone()));
        apply_reviewed_binding(&mut record, None, Some(&binding), "current", "current").unwrap();
        assert_eq!(selection(&record).unwrap(), None);
        assert_eq!(record["sshEndpoint"], original["sshEndpoint"]);
    }
    #[test]
    fn stale_group_or_binding_review_cannot_overwrite_a_concurrent_change() {
        let mut record = serde_json::json!({"id":"existing-id","metadata":{"sshInheritance":{"groupId":"other-session-group","fields":["port"],"environment":false}}});
        let original = record.clone();
        assert!(apply_reviewed_binding(&mut record, None, None, "current", "current").is_err());
        assert_eq!(record, original);
        let current = selection(&record).unwrap().unwrap();
        assert!(apply_reviewed_binding(
            &mut record,
            None,
            Some(&current),
            "old-group-digest",
            "new-group-digest"
        )
        .is_err());
        assert_eq!(record, original);
    }
}
