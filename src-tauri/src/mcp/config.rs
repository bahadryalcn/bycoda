use super::jsonc;
use serde_json::Value;
use std::path::Path;

fn same_config_identity(first: &std::fs::Metadata, next: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        first.dev() == next.dev() && first.ino() == next.ino() && first.mode() == next.mode()
    }
    #[cfg(not(unix))]
    {
        first.file_type() == next.file_type()
            && first.len() == next.len()
            && first.modified().ok() == next.modified().ok()
            && first.permissions().readonly() == next.permissions().readonly()
    }
}

#[cfg(unix)]
fn config_file_identity(path: &Path, nofollow: bool) -> std::io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = if nofollow {
        std::fs::symlink_metadata(path)?
    } else {
        std::fs::metadata(path)?
    };
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn config_file_identity(path: &Path, nofollow: bool) -> std::io::Result<(u64, u64)> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(if nofollow {
            FILE_FLAG_OPEN_REPARSE_POINT
        } else {
            0
        })
        .open(path)?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok((
        info.dwVolumeSerialNumber as u64,
        ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
    ))
}

#[cfg(not(any(unix, windows)))]
fn config_file_identity(path: &Path, nofollow: bool) -> std::io::Result<(u64, u64)> {
    let metadata = if nofollow {
        std::fs::symlink_metadata(path)?
    } else {
        std::fs::metadata(path)?
    };
    Ok((
        metadata.len(),
        metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    ))
}

pub(super) fn publish_new_config(
    temp: &Path,
    target: &Path,
    cleanup: impl FnOnce(&Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    std::fs::hard_link(temp, target)?;
    if let Err(error) = cleanup(temp) {
        eprintln!(
            "MCP config saved; temporary cleanup failed at {}: {error}",
            temp.display()
        );
    }
    Ok(())
}

pub(super) fn publish_config(temp: &Path, target: &Path, existed: bool) -> std::io::Result<()> {
    if !existed {
        return publish_new_config(temp, target, |path| std::fs::remove_file(path));
    }
    #[cfg(windows)]
    if existed {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
        let backup_path = target.with_file_name(format!(
            ".{}.{}.backup",
            target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("mcp"),
            uuid::Uuid::new_v4()
        ));
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        let temp: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let backup: Vec<u16> = backup_path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // ReplaceFileW preserves the existing target's ACL and metadata; failures
        // are surfaced rather than silently dropping the security descriptor.
        if unsafe {
            ReplaceFileW(
                target.as_ptr(),
                temp.as_ptr(),
                backup.as_ptr(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            let error = std::io::Error::last_os_error();
            return Err(std::io::Error::other(format!(
                "Config replacement outcome unknown: {error}; recovery backup: {}",
                backup_path.display()
            )));
        }
        if let Err(error) = std::fs::remove_file(&backup_path) {
            eprintln!(
                "MCP config saved; backup cleanup failed at {}: {error}",
                backup_path.display()
            );
        }
        return Ok(());
    }
    // ast-grep-ignore: rust-rename-without-fsync -- caller syncs the temporary file before publication
    std::fs::rename(temp, target)
}

pub(super) fn write_json_config(
    path: &Path,
    update: impl FnOnce(&mut Value) -> Result<(), String>,
) -> Result<(), String> {
    write_json_config_inner(path, update, || {}, publish_config)
}

pub(super) fn write_json_config_inner(
    path: &Path,
    update: impl FnOnce(&mut Value) -> Result<(), String>,
    before_publish: impl FnOnce(),
    publish: impl FnOnce(&Path, &Path, bool) -> std::io::Result<()>,
) -> Result<(), String> {
    write_config_inner(
        path,
        |raw| jsonc::edit(raw.unwrap_or("{}"), update),
        before_publish,
        publish,
    )
}

pub(super) fn write_config(
    path: &Path,
    edit: impl FnOnce(&str) -> Result<String, String>,
) -> Result<(), String> {
    write_config_inner(
        path,
        |raw| edit(raw.ok_or("Config no longer exists")?),
        || {},
        publish_config,
    )
}

fn write_config_inner(
    path: &Path,
    edit: impl FnOnce(Option<&str>) -> Result<String, String>,
    before_publish: impl FnOnce(),
    publish: impl FnOnce(&Path, &Path, bool) -> std::io::Result<()>,
) -> Result<(), String> {
    let selected_parent = path.parent().ok_or("Invalid config path")?;
    std::fs::create_dir_all(selected_parent).map_err(|e| e.to_string())?;
    let selected_metadata = std::fs::symlink_metadata(path).ok();
    let target = match &selected_metadata {
        Some(_) => std::fs::canonicalize(path)
            .map_err(|e| format!("Cannot resolve existing config: {e}"))?,
        None => selected_parent
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(path.file_name().ok_or("Invalid config path")?),
    };
    let parent = target.parent().ok_or("Invalid config path")?;
    let lock_path = parent.join(format!(
        ".{}.lock",
        target
            .file_name()
            .and_then(|part| part.to_str())
            .unwrap_or("mcp")
    ));
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    lock.lock().map_err(|e| e.to_string())?;
    let selected_metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if std::fs::canonicalize(path)
                .map_err(|e| format!("Cannot resolve existing config: {e}"))?
                != target
            {
                return Err("Config target changed while waiting for the lock".into());
            }
            Some(metadata)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let original = match std::fs::read_to_string(&target) {
        Ok(raw) => Some(raw),
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound && selected_metadata.is_none() =>
        {
            None
        }
        Err(error) => return Err(error.to_string()),
    };
    let metadata = if original.is_some() {
        Some(std::fs::metadata(&target).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let selected_identity = if selected_metadata.is_some() {
        Some(config_file_identity(path, true).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let target_identity = if metadata.is_some() {
        Some(config_file_identity(&target, false).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let encoded = edit(original.as_deref())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("mcp"),
        uuid::Uuid::new_v4()
    ));
    let mut publication_attempted = false;
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        if let Some(metadata) = &metadata {
            file.set_permissions(metadata.permissions())?;
        }
        file.write_all(encoded.as_bytes())?;
        file.sync_all()?;
        drop(file);
        before_publish();
        let selected_now = std::fs::symlink_metadata(path).ok();
        if selected_now.is_some() != selected_metadata.is_some()
            || selected_identity.is_some()
                && config_file_identity(path, true).ok() != selected_identity
            || selected_now
                .as_ref()
                .is_some_and(|now| !same_config_identity(selected_metadata.as_ref().unwrap(), now))
            || (selected_metadata.is_some()
                && std::fs::canonicalize(path).ok().as_ref() != Some(&target))
            || metadata.as_ref().is_some_and(|before| {
                std::fs::metadata(&target)
                    .ok()
                    .is_none_or(|now| !same_config_identity(before, &now))
            })
            || target_identity.is_some()
                && config_file_identity(&target, false).ok() != target_identity
            || std::fs::read_to_string(&target).ok().as_deref() != original.as_deref()
        {
            return Err(std::io::Error::other("Config changed while saving; retry"));
        }
        publication_attempted = true;
        publish(&temporary, &target, metadata.is_some())
    })();
    if result.is_err() && !(cfg!(windows) && publication_attempted && metadata.is_some()) {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|e| {
        if cfg!(windows) && publication_attempted && metadata.is_some() {
            format!("{e}; replacement recovery file: {}", temporary.display())
        } else {
            e.to_string()
        }
    })
}
