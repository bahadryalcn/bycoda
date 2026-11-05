//! Path adapter for a caller that has already authorized both parents.
//! Capability handles anchor every mutation after admission.
use std::{io, path::{Path, PathBuf}};
#[cfg(unix)] use cap_std::{ambient_authority, fs::Dir};
#[cfg(unix)] use cap_fs_ext::{DirExt, MetadataExt};
#[cfg(unix)] use crate::guarded_move::move_with_recovery;

#[derive(Debug)]
pub struct RecoveryResult {
    pub path: PathBuf,
    pub recovery_path: PathBuf,
    pub receipt_path: PathBuf,
    pub warning: Option<String>,
}

#[cfg(unix)]
pub fn move_paths(source: &Path, destination: &Path) -> io::Result<RecoveryResult> {
    use cap_std::fs::DirBuilder;
    #[cfg(unix)] use cap_std::fs::DirBuilderExt;
    if !source.is_absolute() || !destination.is_absolute() { return Err(io::Error::new(io::ErrorKind::InvalidInput, "Move paths must be absolute")); }
    let source_parent_path = source.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let destination_parent_path = destination.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let source_name = source.file_name().ok_or(io::ErrorKind::InvalidInput)?;
    let destination_name = destination.file_name().ok_or(io::ErrorKind::InvalidInput)?;
    let source_parent = Dir::open_ambient_dir(source_parent_path, ambient_authority())?;
    let destination_parent = Dir::open_ambient_dir(destination_parent_path, ambient_authority())?;
    let source_identity = source_parent.dir_metadata()?;
    let destination_identity = destination_parent.dir_metadata()?;
    let parents_match = || -> io::Result<bool> {
        let source_now = Dir::open_ambient_dir(source_parent_path, ambient_authority())?.dir_metadata()?;
        let destination_now = Dir::open_ambient_dir(destination_parent_path, ambient_authority())?.dir_metadata()?;
        Ok(source_identity.dev() == source_now.dev() && source_identity.ino() == source_now.ino()
            && destination_identity.dev() == destination_now.dev() && destination_identity.ino() == destination_now.ino())
    };
    let id = uuid::Uuid::new_v4();
    let recovery_name = format!(".bycoda-move-recovery-{id}");
    let stage_name = format!(".bycoda-move-stage-{id}");
    let recovery_dir_path = source_parent_path.join(&recovery_name);
    let stage_dir_path = destination_parent_path.join(&stage_name);
    let recovery_path = recovery_dir_path.join("source");
    let receipt_path = recovery_dir_path.join("receipt.json");
    let mut builder = DirBuilder::new();
    #[cfg(unix)] builder.mode(0o700);
    source_parent.create_dir_with(&recovery_name, &builder)?;
    destination_parent.create_dir_with(&stage_name, &builder)?;
    #[cfg(unix)] {
        source_parent.try_clone()?.into_std_file().sync_all()?;
        destination_parent.try_clone()?.into_std_file().sync_all()?;
    }
    let recovery = source_parent.open_dir_nofollow(&recovery_name)?;
    let stage = destination_parent.open_dir_nofollow(&stage_name)?;
    if !parents_match()? { return Err(io::Error::other("Move parent changed before quarantine; source was not moved")); }
    let recovery_identity = recovery.dir_metadata()?;
    let stage_identity = stage.dir_metadata()?;
    let receipt = serde_json::to_vec(&serde_json::json!({ "version":1, "source":source, "destination":destination, "recovery":recovery_path, "stage":stage_dir_path, "phaseLog":"phases.jsonl", "sourceParentIdentity": { "device":source_identity.dev(), "inode":source_identity.ino() }, "destinationParentIdentity": { "device":destination_identity.dev(), "inode":destination_identity.ino() }, "recoveryIdentity": { "device":recovery_identity.dev(), "inode":recovery_identity.ino() }, "stageIdentity": { "device":stage_identity.dev(), "inode":stage_identity.ino() } })).map_err(io::Error::other)?;
    let check_admission = || -> io::Result<()> {
        if !parents_match()? { return Err(io::Error::other("Move parent changed; recovery path may be stale")); }
        let current_recovery = source_parent.open_dir_nofollow(&recovery_name)?.dir_metadata()?;
        let current_stage = destination_parent.open_dir_nofollow(&stage_name)?.dir_metadata()?;
        if current_recovery.dev() != recovery_identity.dev() || current_recovery.ino() != recovery_identity.ino()
            || current_stage.dev() != stage_identity.dev() || current_stage.ino() != stage_identity.ino() {
            return Err(io::Error::other("Move recovery or stage directory changed; paths may be stale"));
        }
        Ok(())
    };
    match move_with_recovery(&source_parent, source_name, &destination_parent, destination_name, &recovery, &stage, &receipt, check_admission) {
        Ok(()) => {
            let warning = if parents_match().unwrap_or(false) { None } else { Some("A move parent changed; recovery and destination paths may have moved with it.".to_string()) };
            Ok(RecoveryResult { path: destination.to_owned(), recovery_path, receipt_path, warning })
        },
        Err(error) if error.published => Ok(RecoveryResult { path: destination.to_owned(), recovery_path, receipt_path, warning: Some(error.message) }),
        Err(error) => Err(io::Error::other(format!("Cross-volume move failed: {}. {} Receipt: {} (source parent device {}, inode {}; paths may be stale if directories were moved)", error.message, if error.source_restored { "Source restored.".to_string() } else if error.quarantined { format!("Source retained at {}.", recovery_path.display()) } else { "Source was not moved.".to_string() }, receipt_path.display(), source_identity.dev(), source_identity.ino()))),
    }
}

#[cfg(not(unix))]
pub fn move_paths(_: &Path, _: &Path) -> io::Result<RecoveryResult> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "Guarded cross-volume move requires private Windows staging and exact security preservation"))
}
