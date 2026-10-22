//! Window-bound, short-lived native preview tickets. Frontend receives no credentials.
use crate::{
    remote, server_inventory,
    ssh_security::{self, SshEndpoint},
    termius_reader::{self, HostPreview, Scan},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

struct Ticket {
    owner: String,
    created: Instant,
    profile: std::path::PathBuf,
    fingerprint: String,
    hosts: Vec<HostPreview>,
}
fn tickets() -> &'static Mutex<HashMap<String, Ticket>> {
    static VALUE: OnceLock<Mutex<HashMap<String, Ticket>>> = OnceLock::new();
    VALUE.get_or_init(Default::default)
}
const TTL: Duration = Duration::from_secs(600);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    ticket: String,
    hosts: Vec<HostPreview>,
    warnings: Vec<String>,
}
use crate::termius_transfer::Outcome;

fn endpoint(host: &HostPreview) -> SshEndpoint {
    SshEndpoint {
        host: host.endpoint.host.clone(),
        user: host.endpoint.user.clone(),
        port: host.endpoint.port,
        ..Default::default()
    }
}

fn fingerprint(scan: &Scan) -> String {
    let mut digest = Sha256::new();
    for host in &scan.hosts {
        digest.update(serde_json::to_vec(&host.preview).unwrap_or_default());
        if let Some(key) = &host.key {
            digest.update(key.as_bytes());
        }
    }
    format!("{:x}", digest.finalize())
}

#[tauri::command(async)]
pub fn termius_import_preview(
    window: tauri::Window,
    profile: Option<String>,
) -> Result<Preview, String> {
    let profile = match profile {
        Some(path) => crate::fs::expand_home(path.trim()),
        None => termius_reader::default_profile()?,
    };
    let mut scan = termius_reader::scan(&profile)?;
    let original_fingerprint = fingerprint(&scan);
    for host in &mut scan.hosts {
        if ssh_security::validate_endpoint(&endpoint(&host.preview)).is_err() {
            host.preview
                .warnings
                .push("Invalid SSH endpoint; this record cannot be imported".into());
            host.preview.requires_review = true;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let result = Preview {
        ticket: id.clone(),
        hosts: scan.hosts.iter().map(|h| h.preview.clone()).collect(),
        warnings: scan.warnings.clone(),
    };
    let mut tickets = tickets().lock().map_err(|_| "Migration preview is busy")?;
    tickets.retain(|_, t| t.created.elapsed() < TTL && t.owner != window.label());
    if tickets.len() >= 4 {
        return Err("Close another migration preview and try again".into());
    }
    tickets.insert(
        id,
        Ticket {
            owner: window.label().into(),
            created: Instant::now(),
            profile,
            fingerprint: original_fingerprint,
            hosts: result.hosts.clone(),
        },
    );
    Ok(result)
}

#[tauri::command]
pub fn termius_import_forget(window: tauri::Window, ticket: String) -> Result<(), String> {
    let mut tickets = tickets().lock().map_err(|_| "Migration preview is busy")?;
    if tickets
        .get(&ticket)
        .is_some_and(|t| t.owner == window.label())
    {
        tickets.remove(&ticket);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn termius_import_apply(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, remote::RemoteConnections>,
    ticket: String,
    source_ids: Vec<String>,
    import_keys: bool,
) -> Result<Outcome, String> {
    let mut tickets = tickets().lock().map_err(|_| "Migration preview is busy")?;
    tickets.retain(|_, t| t.created.elapsed() < TTL);
    let preview = tickets
        .get(&ticket)
        .filter(|t| t.owner == window.label())
        .ok_or("Migration preview expired. Scan Termius again.")?;
    let selected: HashSet<_> = source_ids.into_iter().collect();
    if selected.is_empty()
        || selected.len() > preview.hosts.len()
        || selected
            .iter()
            .any(|id| !preview.hosts.iter().any(|h| &h.source_id == id))
    {
        return Err("Select valid records from the migration preview".into());
    }
    let scan = termius_reader::scan(&preview.profile)?;
    if fingerprint(&scan) != preview.fingerprint {
        return Err("Termius data changed after preview. Scan Termius again.".into());
    }
    // Validate every selected row before saving any keys or changing the inventory.
    for host in scan
        .hosts
        .iter()
        .filter(|h| selected.contains(&h.preview.source_id))
    {
        ssh_security::validate_endpoint(&endpoint(&host.preview))?;
        if host.preview.name.trim().is_empty()
            || host.preview.name.len() > 200
            || host.preview.name.chars().any(char::is_control)
        {
            return Err("Termius contains an invalid server name".into());
        }
        if host.preview.requires_review {
            return Err("Review proxy or host-chain settings before importing this record".into());
        }
    }
    let _guard = state
        .store
        .lock()
        .map_err(|_| "Connection store is locked")?;
    let path = remote::store_path(&app)?;
    let existing = remote::read_store_values(&path)?;
    let key_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not find application data")?
        .join("termius-keys");
    let (records, result) = crate::termius_transfer::prepare(
        &scan,
        &existing,
        &selected,
        import_keys,
        &key_dir,
        |value| server_inventory::project(value).map(|_| ()),
    )?;
    if result.imported > 0 {
        remote::write_store_values(&path, &records)?;
    }
    tickets.remove(&ticket);
    let _ = app.emit("server-inventory-changed", ());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Explicit owner-authorized local Termius profile verification only"]
    fn personal_termius_import_round_trip() {
        let scan = termius_reader::scan(&termius_reader::default_profile().unwrap()).unwrap();
        assert!(!scan.hosts.is_empty());
        let selected = scan
            .hosts
            .iter()
            .filter(|h| !h.preview.requires_review)
            .map(|h| h.preview.source_id.clone())
            .collect();
        let root = std::env::temp_dir().join(format!(
            "bycoda-termius-verification-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        let key_dir = root.join("keys");
        let validate = |row: &serde_json::Value| server_inventory::project(row).map(|_| ());
        let (records, result) =
            crate::termius_transfer::prepare(&scan, &[], &selected, true, &key_dir, validate)
                .unwrap();
        let path = root.join("inventory.json");
        remote::write_store_values(&path, &records).unwrap();
        let stored = remote::read_store_values(&path).unwrap();
        assert_eq!(records, stored);
        let (again, second) =
            crate::termius_transfer::prepare(&scan, &stored, &selected, true, &key_dir, validate)
                .unwrap();
        assert_eq!(again, stored);
        assert_eq!(second.imported, 0);
        assert_eq!(second.skipped, selected.len());
        // No addresses, passwords, private keys or source records in test output.
        println!("Personal Termius round-trip: {} imported, {} duplicate records skipped, {} unique key files verified",result.imported,second.skipped,result.keys);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
