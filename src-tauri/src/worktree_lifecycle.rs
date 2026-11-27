use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::worktrees::contains_working_dir;

#[derive(Default)]
struct Lifecycle {
    reservations: Mutex<Vec<(PathBuf, bool)>>,
    desktop_leases: Mutex<Vec<DesktopRemovalLease>>,
    recovery_blocks: Mutex<Vec<PathBuf>>,
}

struct DesktopRemovalLease {
    client_id: String,
    lease_id: String,
    path: PathBuf,
    expires: Instant,
}

static LIFECYCLE: Lifecycle = Lifecycle {
    reservations: Mutex::new(Vec::new()),
    desktop_leases: Mutex::new(Vec::new()),
    recovery_blocks: Mutex::new(Vec::new()),
};

/// Held from before process creation through host registration, or across the
/// entire removal. The registry mutex is only held while acquiring/releasing.
pub(crate) struct Reservation<'a> {
    lifecycle: &'a Lifecycle,
    path: PathBuf,
    removing: bool,
}

impl Lifecycle {
    fn reserve(&self, path: &Path, removing: bool) -> Result<Reservation<'_>, String> {
        let path = if removing {
            canonical_removal_path(path)?
        } else {
            match path.canonicalize() {
                Ok(path) => path,
                Err(error) => return Err(format!("Cannot open working directory: {error}")),
            }
        };
        let mut reservations = self.reservations.lock().unwrap_or_else(|e| e.into_inner());
        let mut leases = self
            .desktop_leases
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        leases.retain(|lease| lease.expires > Instant::now());
        if leases.iter().any(|lease| {
            contains_working_dir(&lease.path, &path)
                || (removing && contains_working_dir(&path, &lease.path))
        }) {
            return Err("This working copy is reserved for Host removal.".into());
        }
        if !removing
            && self
                .recovery_blocks
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .any(|blocked| contains_working_dir(blocked, &path))
        {
            return Err("This working copy has an unfinished removal. Retry cleanup before starting a process.".into());
        }
        // A process conflicts only with a removal of its own directory or an ancestor.
        // Removing a worktree nested inside a checkout leaves that checkout usable.
        if reservations.iter().any(|(other, other_removing)| {
            (removing && contains_working_dir(&path, other))
                || (*other_removing && contains_working_dir(other, &path))
        }) {
            return Err(
                "This working copy is starting a process or being deleted. Try again when it finishes."
                    .into(),
            );
        }
        reservations.push((path.clone(), removing));
        Ok(Reservation {
            lifecycle: self,
            path,
            removing,
        })
    }
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        let mut reservations = self
            .lifecycle
            .reservations
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(index) = reservations
            .iter()
            .position(|(path, removing)| *path == self.path && *removing == self.removing)
        {
            reservations.swap_remove(index);
        }
    }
}

pub(crate) fn reserve_spawn(path: &Path) -> Result<Reservation<'static>, String> {
    LIFECYCLE.reserve(path, false)
}

pub(crate) fn reserve_removal(path: &Path) -> Result<Reservation<'static>, String> {
    LIFECYCLE.reserve(path, true)
}

pub(crate) fn install_desktop_removal_lease(
    path: &Path,
    client_id: String,
    lease_id: String,
    ttl: Duration,
) -> Result<(), String> {
    let path = canonical_removal_path(path)?;
    let reservations = LIFECYCLE
        .reservations
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut leases = LIFECYCLE
        .desktop_leases
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    leases.retain(|lease| lease.expires > now);
    if reservations.iter().any(|(other, removing)| {
        contains_working_dir(&path, other) || (*removing && contains_working_dir(other, &path))
    }) || leases.iter().any(|lease| {
        if lease.lease_id == lease_id {
            return lease.path != path;
        }
        contains_working_dir(&lease.path, &path) || contains_working_dir(&path, &lease.path)
    }) {
        return Err("This working copy is starting a process or being deleted.".into());
    }
    if !leases
        .iter()
        .any(|lease| lease.lease_id == lease_id && lease.client_id == client_id)
    {
        leases.push(DesktopRemovalLease {
            client_id,
            lease_id,
            path,
            expires: now + ttl,
        });
    }
    Ok(())
}

pub(crate) fn release_desktop_removal_lease(client_id: &str, lease_id: &str) {
    LIFECYCLE
        .desktop_leases
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|lease| lease.client_id != client_id || lease.lease_id != lease_id);
}

pub(crate) fn block_removal_recovery(path: &Path) {
    let path = canonical_workspace_path(path).unwrap_or_else(|_| path.to_path_buf());
    let mut blocked = LIFECYCLE
        .recovery_blocks
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if !blocked.iter().any(|entry| entry == &path) {
        blocked.push(path);
    }
}

pub(crate) fn finish_removal_recovery(path: &Path) {
    let path = canonical_workspace_path(path).unwrap_or_else(|_| path.to_path_buf());
    LIFECYCLE
        .recovery_blocks
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|entry| entry != &path);
}

/// Resolve trusted ancestors (for example macOS /var -> /private/var), while
/// retaining the target entry for no-follow validation. Missing targets remain
/// addressable so interrupted Git removals can be recovered.
pub(crate) fn canonical_removal_path(path: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("Worktree removal requires a normalized absolute path".into());
    }
    let name = path
        .file_name()
        .ok_or("Worktree removal requires a directory entry")?;
    let parent = canonical_workspace_path(path.parent().ok_or("Worktree path has no parent")?)?;
    let path = parent.join(name);
    validate_removal_descendant(&path, &path)?;
    Ok(path)
}

pub(crate) fn canonical_workspace_path(path: &Path) -> Result<PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => path
            .canonicalize()
            .map(|path| {
                if cfg!(windows) {
                    PathBuf::from(crate::fs::path_to_js(&path))
                } else {
                    path
                }
            })
            .map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or("Cannot resolve removal path")?;
            Ok(canonical_workspace_path(parent)?
                .join(path.file_name().ok_or("Invalid removal path")?))
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Check an entry without applying a no-follow policy to its trusted ancestors.
pub(crate) fn validate_removal_path(path: &Path) -> Result<(), String> {
    canonical_removal_path(path).map(|_| ())
}

/// The boundary is resolved once before traversal. Never canonicalize descendants:
/// doing so would conceal a link substituted inside the workspace.
pub(crate) fn validate_removal_descendant(root: &Path, path: &Path) -> Result<(), String> {
    use std::path::Component;
    if !root.is_absolute()
        || root
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("Worktree removal requires a normalized absolute path".into());
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Cleanup path is outside its workspace")?;
    let mut current = root.to_path_buf();
    for component in std::iter::once(None).chain(relative.components().map(Some)) {
        if let Some(component) = component {
            if matches!(component, Component::ParentDir | Component::CurDir) {
                return Err("Worktree removal requires a normalized absolute path".into());
            }
            current.push(component);
        }
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if is_link_or_reparse(&metadata) => {
                return Err(format!(
                    "Cleanup blocked: linked removal path {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot validate {}: {error}", current.display())),
        }
    }
    Ok(())
}

pub(crate) fn is_link_or_reparse(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_removal_lease_blocks_descendants_until_release_or_expiry() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target");
        let child = target.join("child");
        std::fs::create_dir_all(&child).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let starting = reserve_spawn(&child).unwrap();
        let install = |client: &str, ttl| {
            install_desktop_removal_lease(&target, client.into(), id.clone(), ttl)
        };
        assert!(install("first", Duration::from_secs(30)).is_err());
        drop(starting);
        install("first", Duration::from_secs(30)).unwrap();
        install("second", Duration::from_secs(30)).unwrap();
        assert!(reserve_spawn(&child).is_err());
        assert!(reserve_spawn(root.path()).is_ok());
        release_desktop_removal_lease("first", &id);
        assert!(reserve_spawn(&child).is_err());
        release_desktop_removal_lease("second", &id);
        assert!(reserve_spawn(&child).is_ok());
        install("second", Duration::ZERO).unwrap();
        assert!(reserve_spawn(&child).is_ok());
    }

    #[test]
    fn removal_allows_linked_ancestors_but_rejects_links_inside_the_boundary() {
        let temp =
            std::env::temp_dir().join(format!("bycoda-lifecycle-links-{}", uuid::Uuid::new_v4()));
        let physical = temp.join("physical");
        let workspace = physical.join("workspace");
        let outside = temp.join("outside");
        std::fs::create_dir_all(workspace.join("src")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("sentinel"), "retained").unwrap();
        let link = |path: &Path, target: &Path| {
            #[cfg(unix)]
            std::os::unix::fs::symlink(target, path).unwrap();
            #[cfg(windows)]
            {
                let mut command = std::process::Command::new("cmd");
                crate::hide_window_console(&mut command);
                let result = command
                    .args(["/c", "mklink", "/J"])
                    .arg(path.to_string_lossy().replace('/', "\\"))
                    .arg(target.to_string_lossy().replace('/', "\\"))
                    .output()
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{}",
                    String::from_utf8_lossy(&result.stderr)
                );
            }
        };
        let unlink = |path: &Path| {
            #[cfg(windows)]
            std::fs::remove_dir(path).unwrap();
            #[cfg(unix)]
            std::fs::remove_file(path).unwrap();
        };
        let ancestor = temp.join("ancestor");
        link(&ancestor, &physical);
        let alias = ancestor.join("workspace");
        let canonical = canonical_removal_path(&alias).unwrap();
        let lifecycle = Lifecycle::default();
        let reservation = lifecycle.reserve(&alias, true).unwrap();
        assert!(lifecycle.reserve(&workspace.join("src"), false).is_err());
        drop(reservation);
        let nested = workspace.join("src/link");
        link(&nested, &outside);
        assert!(
            validate_removal_descendant(&canonical, &canonical.join("src/link/sentinel")).is_err()
        );
        assert!(canonical_removal_path(&nested).is_err());
        assert!(validate_removal_descendant(&canonical, &outside).is_err());
        assert_eq!(
            std::fs::read_to_string(outside.join("sentinel")).unwrap(),
            "retained"
        );
        unlink(&nested);
        unlink(&ancestor);
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn removal_and_in_flight_spawns_exclude_each_other_until_guards_drop() {
        let root = std::env::temp_dir().join(format!("bycoda-lifecycle-{}", uuid::Uuid::new_v4()));
        let child = root.join("src");
        let sibling = root.with_file_name(format!(
            "{}-other",
            root.file_name().unwrap().to_string_lossy()
        ));
        std::fs::create_dir_all(&child).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let lifecycle = Lifecycle::default();
        let first = lifecycle.reserve(&child, false).unwrap();
        let second = lifecycle.reserve(&child, false).unwrap();
        assert!(lifecycle.reserve(&root, true).is_err());
        drop(first);
        assert!(lifecycle.reserve(&root, true).is_err());
        drop(second);
        let removal = lifecycle.reserve(&root, true).unwrap();
        assert!(lifecycle.reserve(&child, false).is_err());
        assert!(lifecycle.reserve(&root.join("src/.."), false).is_err());
        assert!(lifecycle.reserve(&root, true).is_err());
        assert!(lifecycle.reserve(&sibling, false).is_ok());
        drop(removal);
        assert!(lifecycle.reserve(&child, false).is_ok());
        std::fs::remove_dir_all(&root).unwrap();
        assert!(lifecycle.reserve(&child, false).is_err());
        std::fs::remove_dir_all(&sibling).unwrap();
    }

    #[test]
    fn removing_a_nested_worktree_leaves_the_enclosing_checkout_free() {
        let root =
            std::env::temp_dir().join(format!("bycoda-lifecycle-nest-{}", uuid::Uuid::new_v4()));
        let nested = root.join(".claude/worktrees/feature");
        std::fs::create_dir_all(nested.join("src")).unwrap();
        let lifecycle = Lifecycle::default();
        let removal = lifecycle.reserve(&nested, true).unwrap();
        assert!(lifecycle.reserve(&root, false).is_ok());
        assert!(lifecycle.reserve(&nested.join("src"), false).is_err());
        assert!(lifecycle.reserve(&root, true).is_err());
        drop(removal);
        let spawn = lifecycle.reserve(&root, false).unwrap();
        assert!(lifecycle.reserve(&nested, true).is_ok());
        drop(spawn);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
