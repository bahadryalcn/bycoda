//! Private, create-only key files for an explicitly selected Termius migration.
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

fn no_link(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("SSH key destination must not be a link".into());
                }
            }
            if meta.file_type().is_symlink() {
                return Err("SSH key destination must not be a link".into());
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not inspect SSH key destination".into()),
    }
}

fn private_directory(dir: &Path) -> Result<(), String> {
    no_link(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        match std::fs::DirBuilder::new().mode(0o700).create(dir) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(_) => return Err("Could not create the private SSH key folder".into()),
        }
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not protect the SSH key folder")?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::fs::create_dir_all(dir).map_err(|_| "Could not create the private SSH key folder")?;
        // This command returns only account metadata, never a credential or key.
        let account = std::process::Command::new("whoami.exe")
            .args(["/user", "/fo", "csv", "/nh"])
            .creation_flags(0x08000000)
            .output()
            .map_err(|_| "Could not identify the SSH key owner")?;
        let csv = String::from_utf8_lossy(&account.stdout);
        let sid = csv
            .trim()
            .rsplit(',')
            .next()
            .unwrap_or("")
            .trim_matches('"');
        if !account.status.success()
            || !sid.starts_with("S-1-")
            || !sid
                .chars()
                .all(|c| c.is_ascii_digit() || c == '-' || c == 'S')
        {
            return Err("Could not identify the SSH key owner".into());
        }
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::{
                Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
            },
        };
        let sddl: Vec<u16> = format!("D:P(A;OICI;FA;;;{sid})\0").encode_utf16().collect();
        let path: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut descriptor = std::ptr::null_mut();
        // SAFETY: Windows owns the parsed descriptor until LocalFree; both strings
        // are NUL terminated. Replace the entire DACL, including inherited grants.
        unsafe {
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err("Could not protect the SSH key folder".into());
            }
            let ok = SetFileSecurityW(
                path.as_ptr(),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor,
            );
            LocalFree(descriptor);
            if ok == 0 {
                return Err("Could not protect the SSH key folder".into());
            }
        }
    }
    Ok(())
}

pub fn save(dir: &Path, key: &str) -> Result<PathBuf, String> {
    if key.len() > 1024 * 1024
        || !(key.starts_with("-----BEGIN ") && key.contains("PRIVATE KEY-----"))
    {
        return Err("Termius key is not a supported private key file".into());
    }
    private_directory(dir)?;
    let content = Zeroizing::new(format!("{}\n", key.trim_end()));
    let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
    let path = dir.join(format!("termius-{digest}"));
    no_link(&path)?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            file.write_all(content.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| "Could not save the imported SSH key")?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = Zeroizing::new(
                std::fs::read(&path)
                    .map_err(|_| "Could not verify the existing imported SSH key")?,
            );
            if existing.as_slice() != content.as_bytes() {
                return Err("Imported SSH key destination already contains different data".into());
            }
        }
        Err(_) => return Err("Could not save the imported SSH key".into()),
    }
    Ok(path)
}
