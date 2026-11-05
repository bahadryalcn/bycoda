//! Move entry point for pasted paths. Same-volume moves rename in place; cross-volume
//! moves use the guarded copy-verify-remove protocol and report recovery only when it
//! is retained after a failed step.
use std::{fs, io};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRecovery {
    pub path: String,
    pub recovery_path: String,
    pub receipt_path: String,
    pub warning: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum MoveOutcome {
    Path(String),
    Recovery(MoveRecovery),
}

pub(super) fn move_path_outcome(from: &str, dest_parent: &str) -> Result<MoveOutcome, String> {
    let from = super::expand_home(from);
    // Use link metadata so a symbolic link moves as itself, even when dangling.
    let from_meta = fs::symlink_metadata(&from).map_err(|_| format!("{}: No such file or directory", from.display()))?;
    let parent = super::expand_home(dest_parent);
    if !parent.is_dir() { return Err(format!("{} is not a folder", parent.display())); }
    if from_meta.is_dir() && super::dir_contains(&from, &parent) { return Err("Cannot paste a folder into itself.".into()); }
    let name = super::file_label(&from, from.to_str().unwrap_or("item"));
    let destination = parent.join(&name);
    // A link is its own entry: never treat it as the file it points at.
    if from == destination || (!from_meta.file_type().is_symlink() && super::same_entry(&from, &destination)) {
        return Ok(MoveOutcome::Path(from.to_string_lossy().into_owned()));
    }
    if fs::symlink_metadata(&destination).is_ok() { return Err(super::already_exists(&name)); }
    // ast-grep-ignore: rust-rename-without-fsync -- this moves the existing source entry rather than publishing temporary-file contents
    match fs::rename(&from, &destination) {
        Ok(()) => Ok(MoveOutcome::Path(destination.to_string_lossy().into_owned())),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {
            bycoda_physical_store_admission::guarded_move_paths::move_paths(&from, &destination)
                .map(|result| if result.recovery_retained {
                    MoveOutcome::Recovery(MoveRecovery {
                        path: result.path.to_string_lossy().into_owned(),
                        recovery_path: result.recovery_path.to_string_lossy().into_owned(),
                        receipt_path: result.receipt_path.to_string_lossy().into_owned(),
                        warning: result.warning,
                    })
                } else {
                    MoveOutcome::Path(result.path.to_string_lossy().into_owned())
                }).map_err(|error| error.to_string())
        },
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
pub(super) fn move_path_sync(from: &str, parent: &str) -> Result<String, String> {
    match move_path_outcome(from, parent)? {
        MoveOutcome::Path(path) => Ok(path),
        MoveOutcome::Recovery(result) => Ok(result.path),
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    // Cross-volume recovery, copy verification and restore are covered by the
    // guarded move tests in packages/physical-store-admission; this entry point
    // must still refuse an occupied destination without touching the source.
    #[test]
    fn occupied_destination_is_not_overwritten() {
        let root = std::env::temp_dir().join(format!("bycoda-cross-move-{}", Uuid::new_v4()));
        let source_parent = root.join("source");
        let destination_parent = root.join("destination");
        fs::create_dir_all(&source_parent).unwrap();
        fs::create_dir_all(&destination_parent).unwrap();
        fs::write(source_parent.join("item"), b"source").unwrap();
        fs::write(destination_parent.join("item"), b"occupied").unwrap();
        assert!(move_path_sync(&source_parent.join("item").to_string_lossy(), &destination_parent.to_string_lossy()).is_err());
        assert_eq!(fs::read(source_parent.join("item")).unwrap(), b"source");
        assert_eq!(fs::read(destination_parent.join("item")).unwrap(), b"occupied");
        fs::remove_dir_all(root).unwrap();
    }
}
