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
    for (other_name, mut other) in read(root)? {
        if other_name != own_name && overlap(&own.cwd, &other.cwd) {
            own.shared = true;
            other.shared = true;
            write(root, &other_name, &other)?;
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
