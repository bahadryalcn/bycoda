//! Canonical personal inventory, using the existing remote-machines store and lock.
use crate::{
    remote,
    ssh_security::{self, SshEndpoint},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_inheritance: Option<crate::ssh_group_defaults::Inheritance>,
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    pub last_used_at: Option<u64>,
    #[serde(default)]
    pub forwards: Vec<ForwardRule>,
    #[serde(default)]
    pub activity: Vec<ServerActivity>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerActivity {
    pub id: String,
    pub at: u64,
    pub kind: String,
    #[serde(default)]
    pub bookmarked: bool,
}

fn append_launch(metadata: &mut ServerMetadata, at: u64) {
    metadata.last_used_at = Some(at);
    metadata.activity.push(ServerActivity {
        id: uuid::Uuid::new_v4().to_string(),
        at,
        kind: "terminal-opened".into(),
        bookmarked: false,
    });
    while metadata.activity.len() > 128 {
        let index = metadata
            .activity
            .iter()
            .position(|event| !event.bookmarked)
            .unwrap_or(0);
        metadata.activity.remove(index);
    }
}

#[tauri::command(async)]
pub fn server_activity_bookmark(
    app: AppHandle,
    state: State<'_, remote::RemoteConnections>,
    id: String,
    event_id: String,
    bookmarked: bool,
) -> Result<(), String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let mut records = remote::read_store_values(&path)?;
    let record = records
        .iter_mut()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(&id))
        .ok_or("Server no longer exists")?;
    let mut metadata = project(record)?.metadata;
    if bookmarked
        && metadata
            .activity
            .iter()
            .filter(|event| event.bookmarked && event.id != event_id)
            .count()
            >= 32
    {
        return Err("Keep at most 32 activity bookmarks per server".into());
    }
    metadata
        .activity
        .iter_mut()
        .find(|event| event.id == event_id)
        .ok_or("Activity no longer exists")?
        .bookmarked = bookmarked;
    record["metadata"]["activity"] =
        serde_json::to_value(metadata.activity).map_err(|_| "Invalid metadata")?;
    remote::write_store_values(&path, &records)?;
    let _ = app.emit("server-inventory-changed", ());
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardRule {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub local_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshRecord {
    id: String,
    name: String,
    kind: String,
    ssh_endpoint: SshEndpoint,
    #[serde(default)]
    metadata: ServerMetadata,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine: Option<remote::Machine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_endpoint: Option<SshEndpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_ssh_endpoint: Option<SshEndpoint>,
    pub metadata: ServerMetadata,
}

pub(crate) fn project(record: &Value) -> Result<ServerRecord, String> {
    if record.get("kind").and_then(Value::as_str) == Some("ssh") {
        let record: SshRecord =
            serde_json::from_value(record.clone()).map_err(|_| "Invalid saved SSH record")?;
        ssh_security::validate_endpoint(&record.ssh_endpoint)?;
        Ok(ServerRecord {
            id: record.id,
            name: record.name,
            kind: "ssh".into(),
            machine: None,
            ssh_endpoint: Some(record.ssh_endpoint),
            effective_ssh_endpoint: None,
            metadata: record.metadata,
        })
    } else {
        let machine = remote::public_inventory_machine(record)?;
        let metadata = record
            .get("metadata")
            .map(|value| serde_json::from_value(value.clone()))
            .transpose()
            .map_err(|_| "Invalid server metadata")?
            .unwrap_or_default();
        Ok(ServerRecord {
            id: machine.id.clone(),
            name: machine.name.clone(),
            kind: "host".into(),
            machine: Some(machine),
            ssh_endpoint: None,
            effective_ssh_endpoint: None,
            metadata,
        })
    }
}

#[tauri::command(async)]
pub fn server_inventory_list(
    app: AppHandle,
    state: State<'_, remote::RemoteConnections>,
) -> Result<Vec<ServerRecord>, String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    remote::read_store_values(&remote::store_path(&app)?)?
        .iter()
        .map(|record| project_with_effective(&app, record))
        .collect()
}

#[tauri::command(async)]
pub fn server_ssh_save(
    app: AppHandle,
    state: State<'_, remote::RemoteConnections>,
    id: Option<String>,
    name: String,
    endpoint: SshEndpoint,
    import_only: Option<bool>,
) -> Result<ServerRecord, String> {
    ssh_security::validate_endpoint(&endpoint)?;
    if name.trim().is_empty() || name.len() > 200 || name.chars().any(char::is_control) {
        return Err("Enter a valid server name".into());
    }
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let mut records = remote::read_store_values(&path)?;
    if import_only.unwrap_or(false) {
        for record in records
            .iter()
            .filter(|record| record.get("kind").and_then(Value::as_str) == Some("ssh"))
        {
            let saved = crate::ssh_configuration::resolve_record(&app, record)?;
            if same_endpoint(&saved, &endpoint) {
                return Err(
                    "This SSH endpoint is already saved; edit the existing server instead".into(),
                );
            }
        }
    }
    let preserved_metadata = id
        .as_ref()
        .and_then(|id| {
            records
                .iter()
                .find(|record| record.get("id").and_then(Value::as_str) == Some(id))
        })
        .and_then(|record| record.get("metadata"))
        .cloned();
    let metadata = if let Some(id) = &id {
        let old = records
            .iter()
            .find(|r| r.get("id").and_then(Value::as_str) == Some(id))
            .ok_or("Server no longer exists")?;
        if old.get("kind").and_then(Value::as_str) != Some("ssh") {
            return Err("Host-backed machines must use their existing editor".into());
        }
        project(old)?.metadata
    } else {
        ServerMetadata::default()
    };
    let identity_changed = id.as_ref().is_some_and(|id| {
        records
            .iter()
            .find(|record| record.get("id").and_then(Value::as_str) == Some(id))
            .and_then(|record| record.pointer("/sshEndpoint/identityFile"))
            .and_then(Value::as_str)
            != endpoint.identity_file.as_deref()
    });
    let record = SshRecord {
        id: id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name: name.trim().into(),
        kind: "ssh".into(),
        ssh_endpoint: endpoint,
        metadata,
    };
    records.retain(|r| r.get("id").and_then(Value::as_str) != Some(&record.id));
    let mut value = serde_json::to_value(record).map_err(|_| "Could not encode SSH record")?;
    if let Some(metadata) = preserved_metadata {
        value["metadata"] = metadata;
    }
    if identity_changed {
        detach_identity_inheritance(&mut value);
    }
    let projected = project_with_effective(&app, &value)?;
    records.push(value.clone());
    remote::write_store_values(&path, &records)?;
    Ok(projected)
}

/// Change just the authentication reference under the canonical store lock.
/// Never copies a stale endpoint, host token, or another session's metadata.
#[tauri::command(async)]
pub fn server_ssh_identity_set(
    app: AppHandle,
    state: State<'_, remote::RemoteConnections>,
    id: String,
    identity_file: Option<String>,
) -> Result<ServerRecord, String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let mut records = remote::read_store_values(&path)?;
    let record = records
        .iter_mut()
        .find(|record| record.get("id").and_then(Value::as_str) == Some(&id))
        .ok_or("Server no longer exists")?;
    let updated = with_identity_file(record, identity_file)?;
    let projected = project_with_effective(&app, &updated)?;
    *record = updated;
    remote::write_store_values(&path, &records)?;
    let _ = app.emit("server-inventory-changed", ());
    Ok(projected)
}

fn detach_identity_inheritance(record: &mut Value) {
    if let Some(fields) = record
        .pointer_mut("/metadata/sshInheritance/fields")
        .and_then(Value::as_array_mut)
    {
        fields.retain(|field| field.as_str() != Some("identityFile"));
    }
}

fn with_identity_file(record: &Value, identity_file: Option<String>) -> Result<Value, String> {
    let mut updated = record.clone();
    let projected = project(record)?;
    if projected.kind == "ssh" {
        let mut endpoint = projected.ssh_endpoint.ok_or("Missing SSH endpoint")?;
        endpoint.identity_file = identity_file.clone();
        ssh_security::validate_endpoint(&endpoint)?;
        updated["sshEndpoint"]["identityFile"] =
            serde_json::to_value(identity_file).map_err(|_| "Invalid SSH identity reference")?;
        // Selecting a server key is an explicit override of its inherited key.
        // Keep username, port, environment, and all other group choices intact.
        detach_identity_inheritance(&mut updated);
    } else {
        let mut target = projected
            .machine
            .and_then(|machine| machine.ssh)
            .ok_or("Machine has no SSH connection")?;
        target.identity_file = identity_file.clone();
        ssh_security::validate_endpoint(&host_ssh_endpoint(&target))?;
        updated["ssh"]["identityFile"] =
            serde_json::to_value(identity_file).map_err(|_| "Invalid SSH identity reference")?;
    }
    Ok(updated)
}

/// The editor retains base overrides; consumers comparing destinations use the
/// current effective endpoint. Caller holds the connection-store lock.
fn project_with_effective(app: &AppHandle, value: &Value) -> Result<ServerRecord, String> {
    let mut record = project(value)?;
    if record.ssh_endpoint.is_some() {
        record.effective_ssh_endpoint = Some(crate::ssh_configuration::resolve_record(app, value)?);
    }
    Ok(record)
}

fn same_endpoint(left: &SshEndpoint, right: &SshEndpoint) -> bool {
    left.host.eq_ignore_ascii_case(&right.host)
        && left.user == right.user
        && left.port == right.port
        && left.identity_file == right.identity_file
        && left.certificate_file == right.certificate_file
        && left.jump_policies == right.jump_policies
        && left.http_proxy == right.http_proxy
        && left
            .jump_host
            .iter()
            .chain(left.jump_hosts.iter())
            .eq(right.jump_host.iter().chain(right.jump_hosts.iter()))
}

#[tauri::command(async)]
pub fn server_metadata_update(
    app: AppHandle,
    state: State<'_, remote::RemoteConnections>,
    id: String,
    metadata: Value,
) -> Result<(), String> {
    let patch = metadata.as_object().ok_or("Invalid metadata patch")?;
    if patch
        .keys()
        .any(|key| !["group", "tags", "favorite", "lastUsedAt", "forwards"].contains(&key.as_str()))
    {
        return Err("Unknown metadata field".into());
    }
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let mut records = remote::read_store_values(&path)?;
    let record = records
        .iter_mut()
        .find(|r| r.get("id").and_then(Value::as_str) == Some(&id))
        .ok_or("Server no longer exists")?;
    project(record)?;
    let mut current = record
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    if !current.is_object() {
        return Err("Invalid metadata".into());
    }
    for (key, value) in patch {
        current[key] = value.clone();
    }
    let metadata: ServerMetadata =
        serde_json::from_value(current.clone()).map_err(|_| "Invalid metadata")?;
    if metadata.forwards.len() > 32
        || metadata.forwards.iter().any(|rule| {
            rule.id.is_empty()
                || rule.id.len() > 200
                || rule.name.len() > 200
                || rule.local_port == 0
                || match rule.kind.as_deref() {
                    None | Some("local") => {
                        rule.target_port == 0
                            || rule.target_host.is_empty()
                            || !rule
                                .target_host
                                .chars()
                                .all(|c| c.is_ascii_alphanumeric() || ".-_:[]".contains(c))
                    }
                    Some("dynamic") => !rule.target_host.is_empty() || rule.target_port != 0,
                    Some(_) => true,
                }
        })
    {
        return Err("Invalid forwarding rules".into());
    }
    if metadata.tags.len() > 32
        || metadata
            .tags
            .iter()
            .any(|tag| tag.len() > 80 || tag.chars().any(char::is_control))
        || metadata
            .group
            .as_ref()
            .is_some_and(|group| group.len() > 100 || group.chars().any(char::is_control))
    {
        return Err("Server metadata is too large or invalid".into());
    }
    record["metadata"] = current;
    remote::write_store_values(&path, &records)
}

#[tauri::command(async)]
pub fn server_ssh_remove(
    app: AppHandle,
    state: State<'_, remote::RemoteConnections>,
    id: String,
) -> Result<(), String> {
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let mut records = remote::read_store_values(&path)?;
    let record = records
        .iter()
        .find(|r| r.get("id").and_then(Value::as_str) == Some(&id))
        .ok_or("Server no longer exists")?;
    if record.get("kind").and_then(Value::as_str) != Some("ssh") {
        return Err("Use the host connection editor for this machine".into());
    }
    records.retain(|r| r.get("id").and_then(Value::as_str) != Some(&id));
    remote::write_store_values(&path, &records)
}

pub(crate) fn resolve_ssh_endpoint(app: &AppHandle, id: &str) -> Result<SshEndpoint, String> {
    let state = app.state::<remote::RemoteConnections>();
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let records = remote::read_store_values(&remote::store_path(app)?)?;
    let record = records
        .iter()
        .find(|r| r.get("id").and_then(Value::as_str) == Some(id))
        .ok_or("Server no longer exists")?;
    let projected = project(record)?;
    if projected.ssh_endpoint.is_some() {
        return ssh_security::prepare_endpoint(crate::ssh_configuration::resolve_record(
            app, record,
        )?);
    }
    let target = projected
        .machine
        .and_then(|machine| machine.ssh)
        .ok_or("Machine has no SSH connection")?;
    let endpoint = host_ssh_endpoint(&target);
    ssh_security::validate_endpoint(&endpoint)?;
    Ok(endpoint)
}

fn host_ssh_endpoint(target: &crate::remote_ssh::SshTarget) -> SshEndpoint {
    let (user, host) = target
        .target
        .rsplit_once('@')
        .map(|(user, host)| (Some(user.to_string()), host.to_string()))
        .unwrap_or((None, target.target.clone()));
    SshEndpoint {
        host,
        user,
        port: target.port.unwrap_or(22),
        identity_file: target.identity_file.clone(),
        certificate_file: None,
        jump_host: None,
        jump_hosts: Vec::new(),
        ..Default::default()
    }
}

pub(crate) fn mark_used(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<remote::RemoteConnections>();
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(app)?;
    let mut records = remote::read_store_values(&path)?;
    let record = records
        .iter_mut()
        .find(|r| r.get("id").and_then(Value::as_str) == Some(id))
        .ok_or("Server no longer exists")?;
    let mut metadata = project(record)?.metadata;
    append_launch(
        &mut metadata,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Clock unavailable")?
            .as_millis() as u64,
    );
    record["metadata"]["lastUsedAt"] =
        serde_json::to_value(metadata.last_used_at).map_err(|_| "Invalid metadata")?;
    record["metadata"]["activity"] =
        serde_json::to_value(metadata.activity).map_err(|_| "Invalid metadata")?;
    remote::write_store_values(&path, &records)?;
    let _ = app.emit("server-inventory-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn saved_identity_survives_disk_roundtrip_and_is_reused_by_every_connection_mode() {
        let record = json!({
            "id":"ssh-saved", "name":"Work", "kind":"ssh",
            "sshEndpoint":{"host":"server.invalid","port":2222,"user":"alice","certificateFile":"C:/keys/certificate.pub","jumpHosts":["jump.invalid"]},
            "metadata":{"tags":["work"],"favorite":true,"futureField":"keep"}
        });
        let updated = with_identity_file(&record, Some("C:/keys/work key".into())).unwrap();
        assert_eq!(updated["metadata"], record["metadata"]);
        assert_eq!(
            updated["sshEndpoint"]["jumpHosts"],
            record["sshEndpoint"]["jumpHosts"]
        );
        let path =
            std::env::temp_dir().join(format!("bycoda-ssh-identity-{}.json", uuid::Uuid::new_v4()));
        remote::write_store_values(&path, &[updated]).unwrap();
        for _ in 0..2 {
            let records = remote::read_store_values(&path).unwrap();
            let endpoint = project(&records[0]).unwrap().ssh_endpoint.unwrap();
            for args in [
                ssh_security::connection_args(&endpoint).unwrap(),
                ssh_security::interactive_args(&endpoint).unwrap(),
            ] {
                assert!(args
                    .windows(2)
                    .any(|pair| pair == ["-i", "C:/keys/work key"]));
                assert!(args.contains(&"IdentitiesOnly=yes".into()));
            }
        }
        assert!(with_identity_file(&record, Some("bad\nreference".into())).is_err());
        assert!(record["sshEndpoint"].get("identityFile").is_none());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn assigning_a_key_overrides_only_key_inheritance_and_can_be_cleared() {
        let record = json!({
            "id":"ssh-saved", "name":"Work", "kind":"ssh",
            "sshEndpoint":{"host":"server.invalid","port":22},
            "metadata":{"sshInheritance":{"groupId":"group","fields":["user","port","identityFile","certificateFile"],"environment":true}}
        });
        let updated = with_identity_file(&record, Some("C:/keys/work".into())).unwrap();
        assert_eq!(
            updated["metadata"]["sshInheritance"]["fields"],
            json!(["user", "port", "certificateFile"])
        );
        assert_eq!(updated["metadata"]["sshInheritance"]["environment"], true);
        let cleared = with_identity_file(&updated, None).unwrap();
        assert!(project(&cleared)
            .unwrap()
            .ssh_endpoint
            .unwrap()
            .identity_file
            .is_none());
    }

    #[test]
    fn host_key_binding_keeps_pairing_credentials_and_reaches_the_ssh_endpoint() {
        let record = json!({
            "id":"host-saved", "name":"Mac", "endpoint":"ssh://alice@mac.invalid", "environmentId":"env", "token":"fixture-token",
            "ssh":{"target":"alice@mac.invalid","port":2222,"remotePort":3776,"alternate":"alice@alternate.invalid"},
            "metadata":{"tags":["mac"],"futureField":"keep"}
        });
        let updated = with_identity_file(&record, Some("C:/keys/mac".into())).unwrap();
        assert_eq!(updated["token"], record["token"]);
        assert_eq!(updated["metadata"], record["metadata"]);
        assert_eq!(updated["ssh"]["alternate"], record["ssh"]["alternate"]);
        let target = project(&updated).unwrap().machine.unwrap().ssh.unwrap();
        assert_eq!(
            host_ssh_endpoint(&target).identity_file.as_deref(),
            Some("C:/keys/mac")
        );
        assert_eq!(host_ssh_endpoint(&target).user.as_deref(), Some("alice"));
        assert!(with_identity_file(&json!({"id":"local","name":"Local","endpoint":"http://localhost","environmentId":"env","token":"fixture"}), Some("C:/keys/work".into())).is_err());
    }
    #[test]
    fn forward_mode_extension_keeps_legacy_records_and_canonical_identity() {
        let record = json!({
            "id":"ssh-existing", "name":"Existing", "kind":"ssh",
            "sshEndpoint":{"host":"example.invalid","port":22},
            "metadata":{"forwards":[
                {"id":"old-rule","name":"Local","localPort":5432,"targetHost":"localhost","targetPort":5432},
                {"id":"socks-rule","name":"Proxy","kind":"dynamic","localPort":1080,"targetHost":"","targetPort":0}
            ]}
        });
        let value = serde_json::to_value(project(&record).unwrap()).unwrap();
        assert_eq!(value["id"], "ssh-existing");
        assert_eq!(value["sshEndpoint"]["host"], "example.invalid");
        assert_eq!(
            value["metadata"]["forwards"][0],
            record["metadata"]["forwards"][0]
        );
        assert_eq!(
            value["metadata"]["forwards"][1],
            record["metadata"]["forwards"][1]
        );
    }
    #[test]
    fn launch_retention_preserves_bookmarks_and_contains_no_terminal_contents() {
        let mut metadata = ServerMetadata::default();
        append_launch(&mut metadata, 1);
        metadata.activity[0].bookmarked = true;
        let bookmarked = metadata.activity[0].id.clone();
        for timestamp in 2..200 {
            append_launch(&mut metadata, timestamp);
        }
        assert_eq!(metadata.activity.len(), 128);
        assert!(metadata
            .activity
            .iter()
            .any(|event| event.id == bookmarked && event.bookmarked));
        assert_eq!(metadata.last_used_at, Some(199));
        assert!(metadata
            .activity
            .iter()
            .all(|event| event.kind == "terminal-opened"));
        let encoded = serde_json::to_value(&metadata.activity).unwrap();
        assert!(encoded
            .as_array()
            .unwrap()
            .iter()
            .all(|event| event.as_object().unwrap().len() == 4));
    }
    #[test]
    fn import_identity_uses_inherited_destination_without_losing_base_overrides() {
        use crate::ssh_group_defaults::{
            self as groups, ConnectionDefaults, GroupDefaults, Inheritance, InheritedField,
        };
        let base = SshEndpoint {
            host: "target.example".into(),
            user: Some("local".into()),
            port: 22,
            ..Default::default()
        };
        let group = GroupDefaults {
            id: "g".into(),
            name: "Group".into(),
            revision: 1,
            defaults: ConnectionDefaults {
                user: Some("deploy".into()),
                port: Some(2222),
                identity_file: None,
                certificate_file: None,
            },
            environment: vec![],
            shell_kind: None,
        };
        let binding = Inheritance {
            group_id: "g".into(),
            fields: vec![InheritedField::User, InheritedField::Port],
            environment: false,
        };
        let effective = groups::resolve(&base, Some(&binding), Some(&group))
            .unwrap()
            .endpoint;
        let imported = SshEndpoint {
            user: Some("deploy".into()),
            port: 2222,
            ..base.clone()
        };
        assert!(same_endpoint(&effective, &imported));
        assert!(!same_endpoint(&effective, &base));
        assert_eq!(base.user.as_deref(), Some("local"));
        assert_eq!(base.port, 22);
    }
    #[test]
    fn import_deduplication_preserves_user_and_identity_scopes() {
        let endpoint = SshEndpoint {
            host: "Server.EXAMPLE".into(),
            user: Some("alice".into()),
            port: 22,
            identity_file: None,
            jump_host: None,
            jump_hosts: Vec::new(),
            certificate_file: None,
            ..Default::default()
        };
        let mut other = endpoint.clone();
        other.host = "server.example".into();
        assert!(same_endpoint(&endpoint, &other));
        other.user = Some("bob".into());
        assert!(!same_endpoint(&endpoint, &other));
        other = endpoint.clone();
        other.identity_file = Some("/different/key".into());
        assert!(!same_endpoint(&endpoint, &other));
        other = endpoint.clone();
        other.port = 2222;
        assert!(!same_endpoint(&endpoint, &other));
    }
    #[test]
    fn ssh_record_has_no_fake_host_environment_or_credential() {
        let record = json!({"id":"ssh-id","name":"Server","kind":"ssh","sshEndpoint":{"host":"example.invalid","port":22},"metadata":{"favorite":true,"tags":[]}});
        let value = serde_json::to_value(project(&record).unwrap()).unwrap();
        assert!(value.get("machine").is_none());
        assert!(value.get("environmentId").is_none());
        assert!(value.get("token").is_none());
        assert_eq!(value["id"], "ssh-id");
    }
    #[test]
    fn legacy_host_projection_never_returns_credentials() {
        let record = json!({"id":"host-id","name":"Host","endpoint":"https://host.invalid","environmentId":"env","token":"must-not-leave-native"});
        let value = serde_json::to_string(&project(&record).unwrap()).unwrap();
        assert!(!value.contains("must-not-leave-native"));
        assert!(value.contains("host-id"));
    }
}
