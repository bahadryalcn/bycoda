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
    source_ids: HashSet<String>,
}
enum TicketState {
    Available(Ticket),
    Applying { owner: String, claim: uuid::Uuid },
}

#[derive(Default)]
struct TicketRegistry {
    entries: HashMap<String, TicketState>,
}

impl TicketRegistry {
    fn prune(&mut self, now: Instant) {
        self.entries.retain(|_, entry| match entry {
            TicketState::Available(ticket) => now.saturating_duration_since(ticket.created) < TTL,
            TicketState::Applying { .. } => true,
        });
    }

    fn insert(&mut self, id: String, ticket: Ticket, now: Instant) -> Result<(), String> {
        self.prune(now);
        if self.entries.contains_key(&id) {
            return Err("Migration preview identity is already in use".into());
        }
        if self.entries.values().any(
            |entry| matches!(entry, TicketState::Applying { owner, .. } if owner == &ticket.owner),
        ) {
            return Err("Migration import is already in progress".into());
        }
        self.entries.retain(|_, entry| !matches!(entry, TicketState::Available(previous) if previous.owner == ticket.owner));
        if self.entries.len() >= 4 {
            return Err("Close another migration preview and try again".into());
        }
        self.entries.insert(id, TicketState::Available(ticket));
        Ok(())
    }

    fn forget(&mut self, id: &str, owner: &str) -> Result<(), String> {
        match self.entries.get(id) {
            Some(TicketState::Applying { owner: current, .. }) if current == owner => {
                return Err("Migration import is already in progress".into())
            }
            Some(TicketState::Available(ticket)) if ticket.owner == owner => {
                self.entries.remove(id);
            }
            _ => {}
        }
        Ok(())
    }

    fn claim(
        &mut self,
        id: &str,
        owner: &str,
        selected: &HashSet<String>,
        now: Instant,
    ) -> Result<(Ticket, uuid::Uuid), String> {
        self.prune(now);
        let preview = match self.entries.get(id) {
            Some(TicketState::Available(ticket)) if ticket.owner == owner => ticket,
            Some(TicketState::Applying { owner: current, .. }) if current == owner => {
                return Err("Migration import is already in progress".into())
            }
            _ => return Err("Migration preview expired. Scan Termius again.".into()),
        };
        if selected.is_empty()
            || selected.len() > preview.source_ids.len()
            || selected.iter().any(|id| !preview.source_ids.contains(id))
        {
            return Err("Select valid records from the migration preview".into());
        }
        let claim = uuid::Uuid::new_v4();
        match self.entries.insert(
            id.to_string(),
            TicketState::Applying {
                owner: owner.to_string(),
                claim,
            },
        ) {
            Some(TicketState::Available(ticket)) => Ok((ticket, claim)),
            _ => unreachable!("validated ticket changed under registry lock"),
        }
    }

    fn finish(&mut self, id: &str, owner: &str, claim: uuid::Uuid) {
        if matches!(self.entries.get(id), Some(TicketState::Applying { owner: current, claim: current_claim }) if current == owner && *current_claim == claim)
        {
            self.entries.remove(id);
        }
    }
}

fn tickets() -> &'static Mutex<TicketRegistry> {
    static VALUE: OnceLock<Mutex<TicketRegistry>> = OnceLock::new();
    VALUE.get_or_init(Default::default)
}
const TTL: Duration = Duration::from_secs(600);

struct ApplyClaim {
    id: String,
    owner: String,
    claim: uuid::Uuid,
}
impl Drop for ApplyClaim {
    fn drop(&mut self) {
        if let Ok(mut registry) = tickets().lock() {
            registry.finish(&self.id, &self.owner, self.claim);
        }
    }
}

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
    let source_ids = result
        .hosts
        .iter()
        .map(|host| host.source_id.clone())
        .collect();
    tickets()
        .lock()
        .map_err(|_| "Migration preview is busy")?
        .insert(
            id,
            Ticket {
                owner: window.label().into(),
                created: Instant::now(),
                profile,
                fingerprint: original_fingerprint,
                source_ids,
            },
            Instant::now(),
        )?;
    Ok(result)
}

#[tauri::command]
pub fn termius_import_forget(window: tauri::Window, ticket: String) -> Result<(), String> {
    tickets()
        .lock()
        .map_err(|_| "Migration preview is busy")?
        .forget(&ticket, window.label())
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
    let selected: HashSet<_> = source_ids.into_iter().collect();
    let (preview, claim) = tickets()
        .lock()
        .map_err(|_| "Migration preview is busy")?
        .claim(&ticket, window.label(), &selected, Instant::now())?;
    let _claim = ApplyClaim {
        id: ticket,
        owner: window.label().into(),
        claim,
    };
    let result = (|| -> Result<Outcome, String> {
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
                return Err(
                    "Review proxy or host-chain settings before importing this record".into(),
                );
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
        let _ = app.emit("server-inventory-changed", ());
        Ok(result)
    })();
    result.map_err(|error| {
        format!("{error} Import may be incomplete. Scan Termius again before trying again.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    };

    fn ticket(owner: &str, created: Instant) -> Ticket {
        Ticket {
            owner: owner.into(),
            created,
            profile: "fixture".into(),
            fingerprint: "fixture".into(),
            source_ids: HashSet::from(["one".into()]),
        }
    }

    #[test]
    fn claimed_work_does_not_block_forget_or_other_previews() {
        let registry = Arc::new(Mutex::new(TicketRegistry::default()));
        let now = Instant::now();
        registry
            .lock()
            .unwrap()
            .insert("one".into(), ticket("owner", now), now)
            .unwrap();
        registry
            .lock()
            .unwrap()
            .insert("two".into(), ticket("other", now), now)
            .unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = Arc::clone(&registry);
        let mutations = Arc::new(AtomicUsize::new(0));
        let worker_mutations = Arc::clone(&mutations);
        let thread = std::thread::spawn(move || {
            let (_, claim) = worker
                .lock()
                .unwrap()
                .claim("one", "owner", &HashSet::from(["one".into()]), now)
                .unwrap();
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            worker_mutations.fetch_add(1, Ordering::SeqCst);
            worker.lock().unwrap().finish("one", "owner", claim);
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        {
            let mut locked = registry
                .try_lock()
                .expect("slow work must not hold registry");
            assert!(locked.forget("one", "owner").is_err());
            assert!(locked
                .claim("one", "owner", &HashSet::from(["one".into()]), now)
                .is_err());
            assert!(locked
                .insert("new".into(), ticket("owner", now), now)
                .is_err());
            locked.forget("two", "other").unwrap();
            locked
                .insert("three".into(), ticket("third", now), now)
                .unwrap();
            locked.prune(now + TTL + Duration::from_secs(1));
            assert!(locked.entries.contains_key("one"));
        }
        release_tx.send(()).unwrap();
        thread.join().unwrap();
        assert_eq!(mutations.load(Ordering::SeqCst), 1);
        assert!(!registry.lock().unwrap().entries.contains_key("one"));
    }

    #[test]
    fn claim_checks_owner_selection_expiry_and_exact_generation() {
        let now = Instant::now();
        let mut registry = TicketRegistry::default();
        registry
            .insert("id".into(), ticket("owner", now), now)
            .unwrap();
        let selected = HashSet::from(["one".into()]);
        assert!(registry.claim("id", "stranger", &selected, now).is_err());
        assert!(registry.claim("id", "owner", &HashSet::new(), now).is_err());
        registry.forget("id", "stranger").unwrap();
        let (_, claim) = registry.claim("id", "owner", &selected, now).unwrap();
        registry.finish("id", "owner", uuid::Uuid::new_v4());
        assert!(registry.entries.contains_key("id"));
        registry.finish("id", "owner", claim);
        assert!(registry.claim("id", "owner", &selected, now).is_err());
        registry
            .insert("expired".into(), ticket("owner", now), now)
            .unwrap();
        assert!(registry
            .claim("expired", "owner", &selected, now + TTL)
            .is_err());
    }

    #[test]
    fn applying_claim_counts_against_capacity_until_finished() {
        let now = Instant::now();
        let mut registry = TicketRegistry::default();
        for index in 0..4 {
            registry
                .insert(index.to_string(), ticket(&index.to_string(), now), now)
                .unwrap();
        }
        let (_, claim) = registry
            .claim("0", "0", &HashSet::from(["one".into()]), now)
            .unwrap();
        assert!(registry
            .insert("extra".into(), ticket("extra", now), now)
            .is_err());
        registry.finish("0", "0", claim);
        registry
            .insert("extra".into(), ticket("extra", now), now)
            .unwrap();
    }

    #[test]
    fn large_selection_uses_exact_preview_ids() {
        let now = Instant::now();
        let mut preview = ticket("owner", now);
        preview.source_ids = (0..10_000).map(|id| id.to_string()).collect();
        let mut registry = TicketRegistry::default();
        registry.insert("id".into(), preview, now).unwrap();
        let mut selected: HashSet<String> = (0..10_000).map(|id| id.to_string()).collect();
        selected.remove("0");
        selected.insert("not-in-preview".into());
        assert!(registry.claim("id", "owner", &selected, now).is_err());
        selected.remove("not-in-preview");
        selected.insert("0".into());
        assert!(registry.claim("id", "owner", &selected, now).is_ok());
    }

    #[test]
    fn claim_is_consumed_after_unwind() {
        let id = uuid::Uuid::new_v4().to_string();
        let owner = uuid::Uuid::new_v4().to_string();
        let now = Instant::now();
        let selected = HashSet::from(["one".to_string()]);
        let (_, claim) = {
            let mut registry = tickets().lock().unwrap();
            registry
                .insert(id.clone(), ticket(&owner, now), now)
                .unwrap();
            registry.claim(&id, &owner, &selected, now).unwrap()
        };
        let result = std::panic::catch_unwind(|| {
            let _claim = ApplyClaim {
                id: id.clone(),
                owner: owner.clone(),
                claim,
            };
            panic!("synthetic failure");
        });
        assert!(result.is_err());
        assert!(tickets()
            .lock()
            .unwrap()
            .claim(&id, &owner, &selected, now)
            .is_err());
    }

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
