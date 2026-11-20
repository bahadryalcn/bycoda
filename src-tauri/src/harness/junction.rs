use std::path::Path;
use std::process::Command;
use std::sync::LazyLock;
use std::time::Duration;

/// PowerShell starts in about 300 ms; a longer run means a policy prompt, an AV hold or a broken profile.
const JUNCTION_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) fn create(source: &Path, link: &Path) -> std::io::Result<()> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command"])
        .arg("$ErrorActionPreference = 'Stop'; New-Item -ItemType Junction -Path $env:BYCODA_JUNCTION_LINK -Target $env:BYCODA_JUNCTION_TARGET | Out-Null")
        .env("BYCODA_JUNCTION_LINK", link)
        .env("BYCODA_JUNCTION_TARGET", source);
    crate::hide_window_console(&mut cmd);
    let output = match crate::fs::output_with_timeout(&mut cmd, JUNCTION_TIMEOUT) {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!(
                    "junction creation did not finish within {} seconds and was stopped",
                    JUNCTION_TIMEOUT.as_secs()
                ),
            ));
        }
        Err(error) => return Err(error),
    };
    if output.status.success() && link.is_dir() {
        Ok(())
    } else {
        let detail = safe_stderr_tail(&output.stderr);
        let message = if detail.is_empty() {
            format!("junction creation exited with {}", output.status)
        } else {
            format!("junction creation exited with {}: {detail}", output.status)
        };
        Err(std::io::Error::other(message))
    }
}

/// The last few stderr lines, free of control characters and of anything that looks like a credential.
fn safe_stderr_tail(stderr: &[u8]) -> String {
    static ANSI_CSI: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap());
    let text = String::from_utf8_lossy(stderr);
    let text = ANSI_CSI.replace_all(&text, "");
    let lines: Vec<String> = text
        .lines()
        .filter_map(|line| {
            let cleaned: String = line.chars().filter(|c| !c.is_control()).collect();
            let line = cleaned.trim();
            let lower = line.to_ascii_lowercase();
            let safe = !line.is_empty()
                && !["bearer ", "token=", "password=", "passphrase="]
                    .iter()
                    .any(|secret| lower.contains(secret));
            safe.then(|| line.chars().take(200).collect())
        })
        .collect();
    lines[lines.len().saturating_sub(5)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::safe_stderr_tail;

    #[test]
    fn junction_stderr_drops_control_characters_and_secret_lines() {
        let stderr = b"\x1b[31mAccess denied\nAuthorization: Bearer abc123\npassword=hunter2\nNew-Item : cannot create\n";
        let detail = safe_stderr_tail(stderr);
        assert_eq!(detail, "Access denied\nNew-Item : cannot create");
        assert!(!detail.contains('\x1b'));
        assert!(!detail.contains("abc123"));
        assert!(!detail.contains("hunter2"));
    }

    #[test]
    fn junction_stderr_keeps_only_the_newest_five_lines() {
        let stderr: String = (1..=8).map(|n| format!("line {n}\n")).collect();
        assert_eq!(
            safe_stderr_tail(stderr.as_bytes()),
            "line 4\nline 5\nline 6\nline 7\nline 8"
        );
    }

    #[test]
    fn junction_stderr_is_empty_when_nothing_is_safe_to_show() {
        assert_eq!(safe_stderr_tail(b""), "");
        assert_eq!(safe_stderr_tail(b"token=abc\n"), "");
    }

    #[test]
    fn junction_accepts_shell_metacharacters() {
        let root = std::env::temp_dir().join(format!(
            "bycoda-junction-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
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
