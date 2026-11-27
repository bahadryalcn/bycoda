//! Path adapter for a caller that has already authorized both parents.
//! Capability handles anchor every mutation after admission.
use crate::guarded_move::move_with_recovery;
#[cfg(unix)]
use crate::guarded_move::sync_dir;
use cap_fs_ext::{DirExt, MetadataExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, DirBuilder},
};
use std::{
    io,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub struct RecoveryResult {
    pub path: PathBuf,
    /// Paths of the recovery copy and receipt. Only meaningful when `recovery_retained` is true.
    pub recovery_path: PathBuf,
    pub receipt_path: PathBuf,
    /// False after a clean move: the verified destination is the only copy left.
    pub recovery_retained: bool,
    pub warning: Option<String>,
}

/// Remove the quarantined copy, receipt and empty stage directory after the
/// destination is verified. Any failure leaves them in place for inspection.
fn retire_recovery(
    recovery: Dir,
    stage: Dir,
    source_parent: &Dir,
    recovery_name: &str,
    destination_parent: &Dir,
    stage_name: &str,
) -> io::Result<()> {
    let names = recovery
        .entries()?
        .map(|entry| entry.map(|item| item.file_name()))
        .collect::<io::Result<Vec<_>>>()?;
    for name in names {
        if recovery.symlink_metadata(&name)?.is_dir() {
            recovery.remove_dir_all(&name)?;
        } else {
            recovery.remove_file(&name)?;
        }
    }
    // Release the held handles before removing their directories by name.
    drop(recovery);
    drop(stage);
    source_parent.remove_dir(recovery_name)?;
    destination_parent.remove_dir(stage_name)
}

/// Remove the staged partial copy and our own empty recovery/stage directories
/// after a move that never published and left the source in place. Only the
/// exact names this adapter and `move_with_recovery` create are removed: any
/// other entry means someone else wrote there, so nothing is deleted at all.
/// The receipt goes last so a retained stage directory always keeps its pointer.
fn discard_unpublished_move(
    recovery: Dir,
    stage: Dir,
    source_parent: &Dir,
    recovery_name: &str,
    destination_parent: &Dir,
    stage_name: &str,
) -> io::Result<()> {
    const STAGE_ENTRIES: [&str; 1] = ["entry"];
    const RECOVERY_ENTRIES: [&str; 2] = ["phases.jsonl", "receipt.json"];
    let list = |dir: &Dir, known: &[&str]| -> io::Result<Vec<std::ffi::OsString>> {
        let names = dir
            .entries()?
            .map(|entry| entry.map(|item| item.file_name()))
            .collect::<io::Result<Vec<_>>>()?;
        match names.iter().find(|name| {
            !known
                .iter()
                .any(|item| std::ffi::OsStr::new(item) == name.as_os_str())
        }) {
            Some(name) => Err(io::Error::other(format!(
                "unexpected entry {name:?} in a move directory"
            ))),
            None => Ok(names),
        }
    };
    // Validate both directories before the first deletion.
    let staged = list(&stage, &STAGE_ENTRIES)?;
    let journal = list(&recovery, &RECOVERY_ENTRIES)?;
    for name in staged {
        if stage.symlink_metadata(&name)?.is_dir() {
            stage.remove_dir_all(&name)?;
        } else {
            stage.remove_file(&name)?;
        }
    }
    for known in ["phases.jsonl", "receipt.json"] {
        let name = std::ffi::OsString::from(known);
        if journal.contains(&name) {
            recovery.remove_file(&name)?;
        }
    }
    // Release the held handles before removing their directories by name.
    drop(recovery);
    drop(stage);
    source_parent.remove_dir(recovery_name)?;
    destination_parent.remove_dir(stage_name)
}

pub fn move_paths(source: &Path, destination: &Path) -> io::Result<RecoveryResult> {
    #[cfg(unix)]
    use cap_std::fs::DirBuilderExt;
    if !source.is_absolute() || !destination.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Move paths must be absolute",
        ));
    }
    let source_parent_path = source.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let destination_parent_path = destination.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let source_name = source.file_name().ok_or(io::ErrorKind::InvalidInput)?;
    let destination_name = destination.file_name().ok_or(io::ErrorKind::InvalidInput)?;
    let source_parent = Dir::open_ambient_dir(source_parent_path, ambient_authority())?;
    let destination_parent = Dir::open_ambient_dir(destination_parent_path, ambient_authority())?;
    let source_identity = source_parent.dir_metadata()?;
    let destination_identity = destination_parent.dir_metadata()?;
    let parents_match = || -> io::Result<bool> {
        let source_now =
            Dir::open_ambient_dir(source_parent_path, ambient_authority())?.dir_metadata()?;
        let destination_now =
            Dir::open_ambient_dir(destination_parent_path, ambient_authority())?.dir_metadata()?;
        Ok(source_identity.dev() == source_now.dev()
            && source_identity.ino() == source_now.ino()
            && destination_identity.dev() == destination_now.dev()
            && destination_identity.ino() == destination_now.ino())
    };
    let id = uuid::Uuid::new_v4();
    let recovery_name = format!(".bycoda-move-recovery-{id}");
    let stage_name = format!(".bycoda-move-stage-{id}");
    let recovery_dir_path = source_parent_path.join(&recovery_name);
    let stage_dir_path = destination_parent_path.join(&stage_name);
    let recovery_path = recovery_dir_path.join("source");
    let receipt_path = recovery_dir_path.join("receipt.json");
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    source_parent.create_dir_with(&recovery_name, &builder)?;
    if let Err(error) = destination_parent.create_dir_with(&stage_name, &builder) {
        // The recovery directory is still the empty one created above; remove_dir
        // refuses anything else, so a failed cleanup just leaves it in place.
        let _ = source_parent.remove_dir(&recovery_name);
        return Err(error);
    }
    #[cfg(unix)]
    {
        sync_dir(&source_parent)?;
        sync_dir(&destination_parent)?;
    }
    let recovery = source_parent.open_dir_nofollow(&recovery_name)?;
    let stage = destination_parent.open_dir_nofollow(&stage_name)?;
    if !parents_match()? {
        return Err(io::Error::other(
            "Move parent changed before quarantine; source was not moved",
        ));
    }
    let recovery_identity = recovery.dir_metadata()?;
    let stage_identity = stage.dir_metadata()?;
    let receipt = serde_json::to_vec(&serde_json::json!({ "version":1, "source":source, "destination":destination, "recovery":recovery_path, "stage":stage_dir_path, "phaseLog":"phases.jsonl", "sourceParentIdentity": { "device":source_identity.dev(), "inode":source_identity.ino() }, "destinationParentIdentity": { "device":destination_identity.dev(), "inode":destination_identity.ino() }, "recoveryIdentity": { "device":recovery_identity.dev(), "inode":recovery_identity.ino() }, "stageIdentity": { "device":stage_identity.dev(), "inode":stage_identity.ino() } })).map_err(io::Error::other)?;
    let check_admission = || -> io::Result<()> {
        if !parents_match()? {
            return Err(io::Error::other(
                "Move parent changed; recovery path may be stale",
            ));
        }
        let current_recovery = source_parent
            .open_dir_nofollow(&recovery_name)?
            .dir_metadata()?;
        let current_stage = destination_parent
            .open_dir_nofollow(&stage_name)?
            .dir_metadata()?;
        if current_recovery.dev() != recovery_identity.dev()
            || current_recovery.ino() != recovery_identity.ino()
            || current_stage.dev() != stage_identity.dev()
            || current_stage.ino() != stage_identity.ino()
        {
            return Err(io::Error::other(
                "Move recovery or stage directory changed; paths may be stale",
            ));
        }
        Ok(())
    };
    match move_with_recovery(
        &source_parent,
        source_name,
        &destination_parent,
        destination_name,
        &recovery,
        &stage,
        &receipt,
        &check_admission,
    ) {
        Ok(()) => {
            // The destination is verified. Retire the quarantined copy only after
            // the directories are re-checked; keep it when either step fails.
            match check_admission().and_then(|()| {
                retire_recovery(
                    recovery,
                    stage,
                    &source_parent,
                    &recovery_name,
                    &destination_parent,
                    &stage_name,
                )
            }) {
                Ok(()) => Ok(RecoveryResult {
                    path: destination.to_owned(),
                    recovery_path,
                    receipt_path,
                    recovery_retained: false,
                    warning: None,
                }),
                Err(error) => Ok(RecoveryResult {
                    path: destination.to_owned(),
                    recovery_path,
                    receipt_path,
                    recovery_retained: true,
                    warning: Some(format!(
                        "The move completed, but the recovery copy was kept: {error}"
                    )),
                }),
            }
        }
        Err(error) if error.published => Ok(RecoveryResult {
            path: destination.to_owned(),
            recovery_path,
            receipt_path,
            recovery_retained: true,
            warning: Some(error.message),
        }),
        Err(error) => {
            // The source is intact (never quarantined, or restored by identity) and
            // nothing was published, so the staged copy is ours alone to discard.
            // Re-check the directory identities first; on any doubt or failure keep
            // everything and name the stage directory so the leftover is findable.
            let source_in_place = !error.quarantined || error.source_restored;
            let cleanup = if source_in_place {
                check_admission().and_then(|()| {
                    discard_unpublished_move(
                        recovery,
                        stage,
                        &source_parent,
                        &recovery_name,
                        &destination_parent,
                        &stage_name,
                    )
                })
            } else {
                Err(io::Error::other("source is retained in recovery"))
            };
            let (outcome, receipt_note) = match cleanup {
                Ok(()) => ("Staged copy removed.".to_string(), String::new()),
                Err(reason) => (
                    format!(
                        "Staged copy kept at {} ({reason}).",
                        stage_dir_path.display()
                    ),
                    format!(" Receipt: {}.", receipt_path.display()),
                ),
            };
            Err(io::Error::other(format!("Cross-volume move failed: {}. {} {}{} (source parent device {}, inode {}; paths may be stale if directories were moved)", error.message, if error.source_restored { "Source restored.".to_string() } else if error.quarantined { format!("Source retained at {}.", recovery_path.display()) } else { "Source was not moved.".to_string() }, outcome, receipt_note, source_identity.dev(), source_identity.ino())))
        }
    }
}
