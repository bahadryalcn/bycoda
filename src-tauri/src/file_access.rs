//! Native filesystem grants. Renderer paths propose access; only native chooser,
//! drop/clipboard results, produced assets, or an explicit native consent can grant it.
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_fs::FsExt;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Grant {
    path: PathBuf,
    selected: PathBuf,
    directory: bool,
    writable: bool,
}

struct Registry {
    mode: FileAccessMode,
    persistent: Vec<Grant>,
    transient: Vec<Grant>,
    protected: PathBuf,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileAccessMode {
    #[default]
    Unconfigured,
    AllFiles,
    SelectedFolders,
}

pub(crate) struct FileAccess {
    registry: Mutex<Registry>,
    approval: Mutex<()>,
    denied: Mutex<HashSet<PathBuf>>,
}

// Canonicalize the existing ancestor as well as every existing symlink. New files
// and their missing parent folders never turn '..' or a dangling link into a grant.
pub(crate) fn canonical_target(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("File access requires an absolute path without parent traversal".into());
    }
    let mut ancestor = path;
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(ancestor) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(
                    ancestor
                        .file_name()
                        .ok_or("Invalid file path")?
                        .to_os_string(),
                );
                ancestor = ancestor.parent().ok_or("Invalid file path")?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    // A dangling symlink reaches this call and fails closed.
    let mut result = std::fs::canonicalize(ancestor).map_err(|error| error.to_string())?;
    for component in missing.into_iter().rev() {
        result.push(component);
    }
    Ok(result)
}

fn normalized(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy().replace('/', "\\");
        let text = if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
        };
        PathBuf::from(text)
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

// Alias matching is conservative: a case-insensitive apparent descent may
// reject an escape, but never grants authority. Canonical allow boundaries
// preserve filesystem case so case-sensitive NTFS siblings stay distinct.
fn alias_key(path: &Path) -> PathBuf {
    let path = normalized(path);
    #[cfg(windows)]
    {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    }
    #[cfg(not(windows))]
    {
        path
    }
}

impl Registry {
    fn open(protected: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&protected).map_err(|error| error.to_string())?;
        let protected = canonical_target(&protected)?;
        let mode = match std::fs::read(protected.join("access-mode.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("File access mode could not be read: {error}"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                FileAccessMode::Unconfigured
            }
            Err(error) => return Err(format!("File access mode could not be read: {error}")),
        };
        let file = protected.join("grants.json");
        let persistent = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice::<Vec<Grant>>(&bytes)
                .map_err(|error| format!("File permissions could not be read: {error}"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(format!("File permissions could not be read: {error}")),
        };
        if persistent.iter().any(|grant| {
            !grant.path.is_absolute()
                || grant
                    .path
                    .components()
                    .any(|part| matches!(part, Component::ParentDir))
        }) {
            return Err("Invalid saved file permission".into());
        }
        Ok(Self {
            mode,
            persistent,
            transient: Vec::new(),
            protected,
        })
    }

    fn blocked(&self, path: &Path, mutation: bool) -> bool {
        let path = normalized(path);
        let protected = normalized(&self.protected);
        path.starts_with(&protected) || (mutation && protected.starts_with(&path))
    }

    fn allowed(&self, path: &Path, mutation: bool) -> bool {
        if self.blocked(path, mutation) {
            return false;
        }
        if self.mode == FileAccessMode::AllFiles {
            return true;
        }
        let path = normalized(path);
        self.persistent.iter().chain(&self.transient).any(|grant| {
            let granted = normalized(&grant.path);
            (!mutation || grant.writable)
                && (path == granted || (grant.directory && path.starts_with(granted)))
        })
    }

    fn escaped_existing_grant(&self, original: &Path, canonical: &Path) -> bool {
        if self.mode == FileAccessMode::AllFiles {
            return false;
        }
        let original = alias_key(original);
        let canonical = normalized(canonical);
        self.persistent.iter().chain(&self.transient).any(|grant| {
            let root = normalized(&grant.path);
            grant.directory
                && (original.starts_with(alias_key(&grant.path))
                    || original.starts_with(alias_key(&grant.selected)))
                && !canonical.starts_with(&root)
        })
    }

    fn save(&self, grants: &[Grant]) -> Result<(), String> {
        let file = self.protected.join("grants.json");
        let next = self
            .protected
            .join(format!("{}.json", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(grants).map_err(|error| error.to_string())?;
        std::fs::write(&next, bytes).map_err(|error| error.to_string())?;
        std::fs::rename(&next, file).map_err(|error| error.to_string())
    }

    fn set_mode(&mut self, mode: FileAccessMode) -> Result<(), String> {
        let next = self
            .protected
            .join(format!("{}.json", uuid::Uuid::new_v4()));
        std::fs::write(
            &next,
            serde_json::to_vec(&mode).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        std::fs::rename(next, self.protected.join("access-mode.json"))
            .map_err(|error| error.to_string())?;
        self.mode = mode;
        Ok(())
    }

    fn grant(&mut self, path: &Path, directory: bool, persistent: bool) -> Result<(), String> {
        self.grant_access(path, directory, persistent, true)
    }

    fn grant_access(
        &mut self,
        path: &Path,
        directory: bool,
        persistent: bool,
        writable: bool,
    ) -> Result<(), String> {
        let selected = path.to_path_buf();
        let path = canonical_target(path)?;
        if self.blocked(&path, false) {
            return Err("The file permission registry is private".into());
        }
        if directory && !path.is_dir() {
            return Err("Selected folder does not exist".into());
        }
        let granted = Grant {
            path,
            selected,
            directory,
            writable,
        };
        if persistent {
            let mut next = self.persistent.clone();
            if !next.iter().any(|old| {
                old.path == granted.path && old.directory == directory && old.writable == writable
            }) {
                next.push(granted);
            }
            self.save(&next)?;
            self.persistent = next;
        } else if !self.transient.iter().any(|old| {
            old.path == granted.path && old.directory == directory && old.writable == writable
        }) {
            self.transient.push(granted);
        }
        Ok(())
    }

    fn consent(
        &mut self,
        path: &Path,
        directory: bool,
        confirm: impl FnOnce() -> bool,
    ) -> Result<(), String> {
        let canonical = canonical_target(path)?;
        if self.blocked(&canonical, false) || self.escaped_existing_grant(path, &canonical) {
            return Err("File path is outside the approved folder".into());
        }
        if self.allowed(&canonical, true) {
            return Ok(());
        }
        if !confirm() {
            return Err("File access was not approved".into());
        }
        self.grant(path, directory, true)
    }

    fn revoke(&mut self, path: &Path) -> Result<(), String> {
        let path = normalized(&canonical_target(path)?);
        let next: Vec<_> = self
            .persistent
            .iter()
            .filter(|grant| !normalized(&grant.path).starts_with(&path))
            .cloned()
            .collect();
        self.save(&next)?;
        self.persistent = next;
        self.transient
            .retain(|grant| !normalized(&grant.path).starts_with(&path));
        Ok(())
    }
}

pub(crate) fn init(app: &AppHandle) -> Result<(), String> {
    let registry = Registry::open(
        app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("file-permissions"),
    )?;
    app.manage(FileAccess {
        registry: Mutex::new(registry),
        approval: Mutex::new(()),
        denied: Mutex::new(HashSet::new()),
    });
    let handle = app.clone();
    // This plugin scope can only be extended by native dialogs and drop events:
    // no fs frontend permissions are exposed in the application capability.
    app.fs_scope().listen(move |event| {
        let result = match event {
            tauri::scope::fs::Event::PathAllowed(path) => {
                grant_native(&handle, path, path.is_dir(), true)
            }
            tauri::scope::fs::Event::PathForbidden(path) => revoke_native(&handle, path),
        };
        if let Err(error) = result {
            eprintln!("Native file permission update failed: {error}");
        }
    });
    Ok(())
}

// A fixed native storage directory must not become authority through a symlink.
pub(crate) fn produced_target(path: &Path, base: &Path, storage: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(base)
        .map_err(|e| e.to_string())?
        .join(storage);
    let candidate = canonical_target(path)?;
    if !normalized(&candidate).starts_with(normalized(&root)) {
        return Err("Native asset path escaped its storage directory".into());
    }
    Ok(candidate)
}

pub(crate) fn grant_produced_file(
    app: &AppHandle,
    path: &Path,
    base: &Path,
    storage: &str,
) -> Result<(), String> {
    produced_target(path, base, storage)?;
    grant_native(app, path, false, false)
}

// Called only by native producers, never registered as a renderer command.
pub(crate) fn grant_native(
    app: &AppHandle,
    path: &Path,
    directory: bool,
    persist: bool,
) -> Result<(), String> {
    app.state::<FileAccess>()
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .grant(path, directory, persist)
}

pub(crate) fn grant_readonly_native(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.state::<FileAccess>()
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .grant_access(path, path.is_dir(), false, false)
}

fn revoke_native(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.state::<FileAccess>()
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .revoke(path)
}

pub(crate) fn check(app: &AppHandle, path: &Path, mutation: bool) -> Result<PathBuf, String> {
    let canonical = canonical_target(path)?;
    let state = app.state::<FileAccess>();
    let registry = state
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?;
    if registry.allowed(&canonical, mutation) && !registry.escaped_existing_grant(path, &canonical)
    {
        Ok(canonical)
    } else {
        Err("File path is outside the approved folder".into())
    }
}

pub(crate) fn authorize(app: &AppHandle, path: &Path, directory: bool) -> Result<(), String> {
    let state = app.state::<FileAccess>();
    let _approval = state
        .approval
        .lock()
        .map_err(|_| "File approval is unavailable")?;
    let canonical = canonical_target(path)?;
    {
        let registry = state
            .registry
            .lock()
            .map_err(|_| "File permissions are unavailable")?;
        if registry.blocked(&canonical, false) || registry.escaped_existing_grant(path, &canonical)
        {
            return Err("File path is outside the approved folder".into());
        }
        if registry.allowed(&canonical, true) {
            return Ok(());
        }
    }
    if state
        .denied
        .lock()
        .map_err(|_| "File approval is unavailable")?
        .contains(&normalized(&canonical))
    {
        return Err("File access was not approved".into());
    }
    let approved = app
        .dialog()
        .message(format!(
            "Allow bycoda to access this {}?\n\n{}",
            if directory {
                "folder and its files"
            } else {
                "file"
            },
            path.display()
        ))
        .title("File access")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".into(),
            "Cancel".into(),
        ))
        .blocking_show();
    if !approved {
        state
            .denied
            .lock()
            .map_err(|_| "File approval is unavailable")?
            .insert(normalized(&canonical));
    }
    let result = state
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .consent(path, directory, || approved);
    result
}

// Unknown legacy/external files need native consent. Existing grants never widen
// to follow an escaping symlink, and denials return before any filesystem mutation.
pub(crate) fn require(app: &AppHandle, path: &Path, mutation: bool) -> Result<PathBuf, String> {
    if let Ok(canonical) = check(app, path, mutation) {
        return Ok(canonical);
    }
    // Reading an imported/clipboard source does not authorize editing it. A
    // writable upgrade requires an explicit folder selection and native consent.
    if mutation && check(app, path, false).is_ok() {
        return Err("Imported file access is read-only".into());
    }
    authorize(app, path, path.is_dir())?;
    check(app, path, mutation)
}

#[tauri::command(async)]
pub fn authorize_project_path(app: AppHandle, path: String) -> Result<(), String> {
    let path = crate::fs::expand_home(&path);
    if !path.is_dir() {
        return Err("Selected folder does not exist".into());
    }
    app.state::<FileAccess>()
        .denied
        .lock()
        .map_err(|_| "File approval is unavailable")?
        .remove(&normalized(&canonical_target(&path)?));
    authorize(&app, &path, true)
}

#[tauri::command(async)]
pub fn revoke_file_access(app: AppHandle, path: String) -> Result<(), String> {
    revoke_native(&app, &crate::fs::expand_home(&path))
}

#[tauri::command]
pub fn get_file_access_mode(app: AppHandle) -> Result<FileAccessMode, String> {
    Ok(app
        .state::<FileAccess>()
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .mode)
}

// Broad access is granted only by this native, fixed-text consent dialog.
// A renderer request or a settings value cannot silently approve it.
#[tauri::command(async)]
pub fn configure_file_access(
    app: AppHandle,
    review: bool,
    language: String,
) -> Result<FileAccessMode, String> {
    let state = app.state::<FileAccess>();
    let _approval = state
        .approval
        .lock()
        .map_err(|_| "File approval is unavailable")?;
    let current = state
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .mode;
    if !review && current != FileAccessMode::Unconfigured {
        return Ok(current);
    }
    let turkish = language == "tr";
    let approved = app.dialog()
        .message(if turkish {
            "bycoda'nın bu bilgisayardaki tüm dosyalara, projelere ve skill'lere okuma ve düzenleme erişimine izin verilsin mi?\n\nSeçiminiz kalıcı olarak kaydedilir; her dosya veya klasör için tekrar onay istenmez. Ayarlar'da Dosya erişimi aramasıyla değiştirebilirsiniz. Ajanların komut çalıştırma izinleri ayrıca yapılandırılır."
        } else {
            "Allow bycoda to read and edit all files, projects and skills on this computer?\n\nThis choice is saved across app restarts, so you will not be asked for each file or folder. Search for File access in Settings to change it. Agent execution permissions are configured separately."
        })
        .title(if turkish { "Dosya erişimi" } else { "File access" })
        .buttons(MessageDialogButtons::OkCancelCustom(
            if turkish { "Tüm dosyalara izin ver" } else { "Allow all files" }.into(),
            if turkish { "Yalnızca seçilen klasörler" } else { "Selected folders only" }.into(),
        ))
        .blocking_show();
    let mode = if approved {
        FileAccessMode::AllFiles
    } else {
        FileAccessMode::SelectedFolders
    };
    state
        .registry
        .lock()
        .map_err(|_| "File permissions are unavailable")?
        .set_mode(mode)?;
    state
        .denied
        .lock()
        .map_err(|_| "File approval is unavailable")?
        .clear();
    Ok(mode)
}

fn validate_copy_paths(
    from: &Path,
    to: &Path,
    check_path: &impl Fn(&Path, bool) -> Result<PathBuf, String>,
) -> Result<(), String> {
    fn visit(
        from: &Path,
        to: &Path,
        check_path: &impl Fn(&Path, bool) -> Result<PathBuf, String>,
        ancestors: &mut HashSet<PathBuf>,
    ) -> Result<(), String> {
        let source = check_path(from, false)?;
        check_path(to, true)?;
        if from.is_dir() {
            if !ancestors.insert(source.clone()) {
                return Err("Cannot copy a cyclic symbolic link".into());
            }
            for entry in std::fs::read_dir(from).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                visit(
                    &entry.path(),
                    &to.join(entry.file_name()),
                    check_path,
                    ancestors,
                )?;
            }
            ancestors.remove(&source);
        }
        Ok(())
    }
    visit(from, to, check_path, &mut HashSet::new())
}

pub(crate) fn validate_copy_tree(app: &AppHandle, from: &Path, to: &Path) -> Result<(), String> {
    validate_copy_paths(from, to, &|path, mutation| check(app, path, mutation))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Tmp(PathBuf);
    impl Tmp {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn fixture() -> (Tmp, Registry, PathBuf) {
        let tmp =
            Tmp(std::env::temp_dir().join(format!("bycoda-file-access-{}", uuid::Uuid::new_v4())));
        std::fs::create_dir(tmp.path()).unwrap();
        let folder = tmp.path().join("project");
        std::fs::create_dir(&folder).unwrap();
        let registry = Registry::open(tmp.path().join("private")).unwrap();
        (tmp, registry, folder)
    }

    #[test]
    fn broad_consent_survives_restart_and_can_be_downgraded() {
        let (_tmp, mut registry, folder) = fixture();
        let target = canonical_target(&folder.join("new/file.txt")).unwrap();
        assert_eq!(registry.mode, FileAccessMode::Unconfigured);
        assert!(!registry.allowed(&target, false));
        registry.set_mode(FileAccessMode::AllFiles).unwrap();
        let mut restored = Registry::open(registry.protected.clone()).unwrap();
        assert!(restored.allowed(&target, false));
        assert!(restored.allowed(&target, true));
        assert!(!restored.allowed(&restored.protected.join("access-mode.json"), false));
        assert!(!restored.allowed(restored.protected.parent().unwrap(), true));
        restored.set_mode(FileAccessMode::SelectedFolders).unwrap();
        let scoped = Registry::open(restored.protected.clone()).unwrap();
        assert_eq!(scoped.mode, FileAccessMode::SelectedFolders);
        assert!(!scoped.allowed(&target, false));
    }

    #[test]
    fn saved_scoped_choice_and_existing_grants_survive_restart() {
        let (_tmp, mut registry, folder) = fixture();
        registry.grant(&folder, true, true).unwrap();
        registry.set_mode(FileAccessMode::SelectedFolders).unwrap();
        let restored = Registry::open(registry.protected.clone()).unwrap();
        assert_eq!(restored.mode, FileAccessMode::SelectedFolders);
        assert!(restored.allowed(&canonical_target(&folder).unwrap(), true));
        assert!(!restored.allowed(
            &canonical_target(&folder.parent().unwrap().join("skills")).unwrap(),
            false
        ));
    }

    #[test]
    fn malformed_broad_consent_fails_closed() {
        let (_tmp, registry, _folder) = fixture();
        std::fs::write(registry.protected.join("access-mode.json"), "invalid").unwrap();
        assert!(Registry::open(registry.protected).is_err());
    }

    #[test]
    fn denial_does_not_grant_or_write_permissions() {
        let (_tmp, mut registry, folder) = fixture();
        assert!(registry.consent(&folder, true, || false).is_err());
        assert!(!registry.allowed(&canonical_target(&folder).unwrap(), true));
        assert!(!registry.protected.join("grants.json").exists());
    }

    #[test]
    fn native_selected_file_is_exact_and_folder_survives_restore_and_revocation() {
        let (_tmp, mut registry, folder) = fixture();
        let file = folder.join("chosen.txt");
        std::fs::write(&file, "chosen").unwrap();
        registry.grant(&file, false, true).unwrap();
        assert!(registry.allowed(&canonical_target(&file).unwrap(), false));
        assert!(!registry.allowed(&canonical_target(&folder.join("other.txt")).unwrap(), false));
        registry.consent(&folder, true, || true).unwrap();
        let mut restored = Registry::open(registry.protected.clone()).unwrap();
        assert!(restored.allowed(
            &canonical_target(&folder.join("new/deep/file.txt")).unwrap(),
            true
        ));
        restored.revoke(&folder).unwrap();
        let revoked = Registry::open(registry.protected.clone()).unwrap();
        assert!(!revoked.allowed(&canonical_target(&file).unwrap(), false));
    }

    #[test]
    fn native_import_grants_cannot_modify_the_original_transcript() {
        let (_tmp, mut registry, folder) = fixture();
        let file = folder.join("transcript.jsonl");
        std::fs::write(&file, "transcript").unwrap();
        registry.grant_access(&file, false, false, false).unwrap();
        let file = canonical_target(&file).unwrap();
        assert!(registry.allowed(&file, false));
        assert!(!registry.allowed(&file, true));
    }

    #[test]
    fn explicitly_selecting_a_readonly_folder_requires_consent_to_upgrade() {
        let (_tmp, mut registry, folder) = fixture();
        registry.grant_access(&folder, true, false, false).unwrap();
        assert!(registry.consent(&folder, true, || false).is_err());
        assert!(!registry.allowed(&canonical_target(&folder).unwrap(), true));
        let prompted = std::cell::Cell::new(false);
        registry
            .consent(&folder, true, || {
                prompted.set(true);
                true
            })
            .unwrap();
        assert!(prompted.get());
        assert!(registry.allowed(&canonical_target(&folder).unwrap(), true));
    }

    #[test]
    fn malformed_permissions_fail_closed_and_registry_cannot_grant_itself() {
        let (_tmp, mut registry, _folder) = fixture();
        assert!(registry
            .grant(&registry.protected.clone(), true, true)
            .is_err());
        std::fs::write(registry.protected.join("grants.json"), "invalid").unwrap();
        assert!(Registry::open(registry.protected).is_err());
    }

    #[test]
    fn native_asset_paths_cannot_authorize_siblings_or_private_registry() {
        let (_tmp, registry, folder) = fixture();
        assert!(produced_target(&folder.join("assets/new.txt"), &folder, "assets").is_ok());
        assert!(
            produced_target(&registry.protected.join("grants.json"), &folder, "assets").is_err()
        );
        assert!(produced_target(&folder.join("other.txt"), &folder, "assets").is_err());
    }

    #[test]
    fn missing_parent_paths_stay_inside_grant_and_traversal_is_rejected() {
        let (_tmp, mut registry, folder) = fixture();
        registry.grant(&folder, true, false).unwrap();
        assert!(registry.allowed(
            &canonical_target(&folder.join("new/deep/file.txt")).unwrap(),
            true
        ));
        assert!(canonical_target(&folder.join("../private/grants.json")).is_err());
    }

    #[test]
    fn copy_preflight_rejects_an_ungranted_child_before_destination_creation() {
        let (_tmp, mut registry, folder) = fixture();
        let source = folder.join("source");
        let destination = folder.join("destination");
        std::fs::create_dir(&source).unwrap();
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(source.join("private.txt"), "secret").unwrap();
        registry.grant(&source, false, false).unwrap();
        registry.grant(&destination, true, false).unwrap();
        let target = destination.join("copy");
        let result = validate_copy_paths(&source, &target, &|path, mutation| {
            let canonical = canonical_target(path)?;
            if registry.allowed(&canonical, mutation) {
                Ok(canonical)
            } else {
                Err("denied".into())
            }
        });
        assert!(result.is_err());
        assert!(!target.exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_canonical_boundaries_preserve_case_and_strip_verbatim_prefixes() {
        let (_tmp, mut registry, folder) = fixture();
        let upper = folder.join("Foo");
        std::fs::create_dir(&upper).unwrap();
        registry.grant(&upper, true, false).unwrap();
        let canonical = canonical_target(&upper).unwrap();
        let sibling = canonical.parent().unwrap().join("foo").join("secret.txt");
        assert!(!registry.allowed(&sibling, true));
        let lower = upper.parent().unwrap().join("foo");
        match std::fs::create_dir(&lower) {
            Ok(()) => assert!(!registry.allowed(&canonical_target(&lower).unwrap(), true)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // This fixture volume is case-insensitive; distinct canonical
                // path input above still proves the policy cannot case-fold.
            }
            Err(error) => panic!("case-sensitive fixture failed: {error}"),
        }
        assert_eq!(
            normalized(Path::new(r"\\?\UNC\server\share\Foo")),
            PathBuf::from(r"\\server\share\Foo")
        );
        assert_ne!(
            normalized(Path::new(r"C:\Foo")),
            normalized(Path::new(r"C:\foo"))
        );
        let mixed = PathBuf::from(upper.to_string_lossy().to_uppercase());
        assert_eq!(canonical_target(&mixed).unwrap(), canonical);
        assert!(registry.allowed(&canonical_target(&mixed).unwrap(), true));
    }

    #[cfg(windows)]
    #[test]
    fn windows_junction_escape_and_missing_target_are_denied() {
        use std::os::windows::process::CommandExt;
        let (tmp, mut registry, folder) = fixture();
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        let create_junction = |link: &Path, target: &Path| {
            let status = std::process::Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success());
        };
        create_junction(&folder.join("escape"), &outside);
        create_junction(&folder.join("dangling"), &tmp.path().join("missing"));
        // Native asset provenance must reject the same junction even before a grant exists.
        assert!(produced_target(&folder.join("escape/new.txt"), &folder, "escape").is_err());
        assert!(produced_target(&folder.join("assets/new/deep.txt"), &folder, "assets").is_ok());
        registry.grant(&folder, true, false).unwrap();
        let requested = folder.join("escape/new/deep/file.txt");
        let canonical = canonical_target(&requested).unwrap();
        assert!(!registry.allowed(&canonical, true));
        assert!(registry.escaped_existing_grant(&requested, &canonical));
        assert!(canonical_target(&folder.join("dangling/new.txt")).is_err());
        let destination = folder.join("copy");
        assert!(
            validate_copy_paths(&folder, &destination, &|path, mutation| {
                let canonical = canonical_target(path)?;
                if registry.allowed(&canonical, mutation) {
                    Ok(canonical)
                } else {
                    Err("denied".into())
                }
            })
            .is_err()
        );
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_and_dangling_links_are_denied() {
        let (tmp, mut registry, folder) = fixture();
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("escape")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("missing"), folder.join("dangling")).unwrap();
        registry.grant(&folder, true, false).unwrap();
        let requested = folder.join("escape/new.txt");
        let canonical = canonical_target(&requested).unwrap();
        assert!(!registry.allowed(&canonical, true));
        assert!(registry.escaped_existing_grant(&requested, &canonical));
        assert!(canonical_target(&folder.join("dangling/new.txt")).is_err());
    }
}
