use std::path::Path;
use std::process::{Command, Stdio};

pub(super) fn create(source: &Path, link: &Path) -> std::io::Result<()> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg("$ErrorActionPreference = 'Stop'; New-Item -ItemType Junction -Path $env:BYCODA_JUNCTION_LINK -Target $env:BYCODA_JUNCTION_TARGET | Out-Null")
        .env("BYCODA_JUNCTION_LINK", link)
        .env("BYCODA_JUNCTION_TARGET", source)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::hide_window_console(&mut cmd);
    let status = cmd.status()?;
    if status.success() && link.is_dir() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "junction creation exited with {status}"
        )))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn junction_accepts_shell_metacharacters() {
        let root = std::env::temp_dir().join(format!(
            "bycoda-junction-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("source & ^ % folder");
        let link = root.join("link & ^ % folder");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("proof"), b"owned").unwrap();
        super::create(&source, &link).unwrap();
        assert_eq!(std::fs::read(link.join("proof")).unwrap(), b"owned");
        std::fs::remove_dir(&link).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
