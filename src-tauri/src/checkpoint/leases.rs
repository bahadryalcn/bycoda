//! Native and host use the same user-scoped active-turn protocol.
use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Lease {
    owner: String,
    session_id: String,
    turn_id: String,
    cwd: String,
    shared: bool,
}
fn name(session: &str, turn: &str) -> String {
    format!("native-{session}-{turn}.json")
}
fn write(root: &Path, name: &str, lease: &Lease) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = root.join(format!("lease-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp, serde_json::to_vec(lease).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(temp, root.join(name)).map_err(|e| e.to_string())
}
fn read(root: &Path) -> Result<Vec<(String, Lease)>, String> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut leases = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") {
            continue;
        }
        let bytes = match std::fs::read(entry.path()) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        let lease: Lease = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        validate_id(&lease.session_id, "session")?;
        validate_id(&lease.turn_id, "turn")?;
        if !matches!(lease.owner.as_str(), "native" | "host") {
            return Err("Unknown checkpoint owner".into());
        }
        leases.push((name, lease));
    }
    Ok(leases)
}
fn mark_shared(root: &Path, name: &str) -> Result<(), String> {
    use std::io::{Read, Seek, SeekFrom, Write};
    let mut file = match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.join(name))
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let lease: Lease = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if lease.shared {
        return Ok(());
    }
    let key = b"\"shared\"";
    let start = bytes
        .windows(key.len())
        .position(|part| part == key)
        .ok_or("Invalid checkpoint lease shared flag")?
        + key.len();
    let mut offset = start;
    while bytes.get(offset).is_some_and(u8::is_ascii_whitespace) {
        offset += 1;
    }
    if bytes.get(offset) != Some(&b':') {
        return Err("Invalid checkpoint lease shared flag".into());
    }
    offset += 1;
    while bytes.get(offset).is_some_and(u8::is_ascii_whitespace) {
        offset += 1;
    }
    if !bytes[offset..].starts_with(b"false") {
        return Err("Invalid checkpoint lease shared flag".into());
    }
    // Keep the old JSON protocol and its width, but never create or replace a
    // peer's path: removal by its owner remains final even while this is open.
    file.seek(SeekFrom::Start(offset as u64))
        .map_err(|e| e.to_string())?;
    file.write_all(b"true ").map_err(|e| e.to_string())
}
pub(super) fn publish(root: &Path, session: &str, turn: &str, cwd: &str) -> Result<bool, String> {
    let own_name = name(session, turn);
    let canonical = std::fs::canonicalize(cwd).map_err(|e| e.to_string())?;
    let mut own = Lease {
        owner: "native".into(),
        session_id: session.into(),
        turn_id: turn.into(),
        cwd: canonical.to_string_lossy().into_owned(),
        shared: shared(root, session, turn)?,
    };
    // Publish before scanning. Simultaneous starts observe each other's lease;
    // taint is monotonic, so a completing peer cannot erase overlap evidence.
    write(root, &own_name, &own)?;
    for (other_name, other) in read(root)? {
        if other_name != own_name && overlap(&own.cwd, &other.cwd) {
            own.shared = true;
            mark_shared(root, &other_name)?;
        }
    }
    if own.shared {
        write(root, &own_name, &own)?;
    }
    Ok(own.shared)
}
pub(super) fn shared(root: &Path, session: &str, turn: &str) -> Result<bool, String> {
    Ok(read(root)?
        .into_iter()
        .any(|(n, lease)| n == name(session, turn) && lease.shared))
}
pub(super) fn active(root: &Path, cwd: &str) -> Result<bool, String> {
    Ok(read(root)?
        .into_iter()
        .any(|(_, lease)| overlap(cwd, &lease.cwd)))
}
pub(super) fn release(root: &Path, session: &str, turn: &str) -> Result<(), String> {
    match std::fs::remove_file(root.join(name(session, turn))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_lease_mark_never_recreates_released_peers() {
        let root = std::env::temp_dir().join(format!("bycoda-lease-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let lease = Lease {
            owner: "host".into(),
            session_id: "peer".into(),
            turn_id: "turn".into(),
            cwd: "project-ğ".into(),
            shared: false,
        };
        let peer = "host-peer-turn.json";
        write(&root, peer, &lease).unwrap();
        let snapshot = read(&root).unwrap();
        std::fs::remove_file(root.join(peer)).unwrap();
        mark_shared(&root, &snapshot[0].0).unwrap();
        assert!(!root.join(peer).exists());
        write(&root, peer, &lease).unwrap();
        mark_shared(&root, peer).unwrap();
        let live = read(&root).unwrap();
        assert!(live[0].1.shared);
        assert_eq!(live[0].1.cwd, lease.cwd);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn checkpoint_lease_recovery_retires_only_the_exact_settled_native_turn() {
        let root =
            std::env::temp_dir().join(format!("bycoda-lease-recover-{}", uuid::Uuid::new_v4()));
        let cwd = root.join("project");
        std::fs::create_dir_all(&cwd).unwrap();
        let store = CheckpointStore::new(root.join("checkpoints"));
        let cwd = cwd.to_string_lossy().into_owned();
        let turn = super::super::Turn {
            id: "settled".into(),
            cwd: cwd.clone(),
            before: None,
            head: None,
            active: false,
            shared: false,
            error: None,
            prepared_before: Default::default(),
            dirty_before: Default::default(),
            captured: Default::default(),
        };
        super::super::save_turn(&store.root.join("session"), &turn).unwrap();
        write(
            &store.leases,
            "native-session-settled.json",
            &Lease {
                owner: "native".into(),
                session_id: "session".into(),
                turn_id: "settled".into(),
                cwd: cwd.clone(),
                shared: false,
            },
        )
        .unwrap();
        write(
            &store.leases,
            "host-peer-live.json",
            &Lease {
                owner: "host".into(),
                session_id: "peer".into(),
                turn_id: "live".into(),
                cwd: cwd.clone(),
                shared: false,
            },
        )
        .unwrap();
        store.recover_interrupted_turns();
        let remaining = read(&store.leases).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].0, "host-peer-live.json");
        assert!(active(&store.leases, &cwd).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
