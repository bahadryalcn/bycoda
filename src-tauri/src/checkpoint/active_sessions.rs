//! Durable index of sessions whose `turn.json` is active, so startup recovery
//! reads only those records instead of one per session that ever had a
//! checkpoint. `save_turn` is the only writer of turn records: it marks before an
//! active record is written and clears after an inactive one is, so an active
//! record always has a marker. A stale marker is harmless; recovery re-reads the
//! record, which stays authoritative, and sweeps it.
use super::*;

const DIR: &str = ".active";
const READY: &str = ".ready";

fn dir(root: &Path) -> PathBuf {
    root.join(DIR)
}

fn marker(session_dir: &Path) -> Result<PathBuf, String> {
    match (session_dir.parent(), session_dir.file_name()) {
        (Some(root), Some(session)) => Ok(dir(root).join(session)),
        _ => Err("Invalid checkpoint session directory".into()),
    }
}

/// True once every active record present at some launch was marked. Until then
/// (the first launch with the index) recovery still walks every session record.
pub(in crate::checkpoint) fn ready(root: &Path) -> bool {
    dir(root).join(READY).is_file()
}

pub(in crate::checkpoint) fn mark_ready(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir(root)).map_err(|e| e.to_string())?;
    std::fs::write(dir(root).join(READY), b"").map_err(|e| e.to_string())
}

/// Must succeed before an active record is written: a crash in between leaves a
/// stale marker, never an unindexed active turn.
pub(in crate::checkpoint) fn mark(session_dir: &Path) -> Result<(), String> {
    let path = marker(session_dir)?;
    let create = || {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
    };
    match create() {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(path.parent().unwrap_or(session_dir))
                .map_err(|e| e.to_string())?;
            match create() {
                Ok(_) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error.to_string()),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Called after the inactive record is durable. A failure only leaves a stale
/// marker for the next launch's sweep.
pub(in crate::checkpoint) fn clear(session_dir: &Path) {
    let Ok(path) = marker(session_dir) else {
        return;
    };
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!(
            "Checkpoint active marker {} was not cleared: {error}",
            path.display()
        ),
    }
}

/// Marked sessions, without opening any session directory.
pub(in crate::checkpoint) fn sessions(root: &Path) -> Result<Vec<String>, String> {
    let entries = match std::fs::read_dir(dir(root)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut sessions = Vec::new();
    for entry in entries {
        let session = entry
            .map_err(|e| e.to_string())?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if validate_id(&session, "session").is_ok() {
            sessions.push(session);
        }
    }
    Ok(sessions)
}
