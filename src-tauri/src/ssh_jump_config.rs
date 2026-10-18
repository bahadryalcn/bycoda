//! Per-hop OpenSSH policy. The generated config is process-owned and never
//! merges with, executes, or changes the owner's SSH configuration.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SshJumpPolicy {
    pub host: String,
    pub user: Option<String>,
    pub port: u16,
    pub identity_file: Option<String>,
    pub certificate_file: Option<String>,
    pub known_hosts_file: Option<String>,
}

fn literal_path(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 4096
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '%' | '$'))
    {
        return Err("Invalid jump key, certificate or known-hosts file reference".into());
    }
    let value = if let Some(tail) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .filter(|v| !v.is_empty())
            .ok_or("Home directory unavailable")?;
        PathBuf::from(home)
            .join(tail)
            .to_string_lossy()
            .into_owned()
    } else {
        if !Path::new(value).is_absolute() {
            return Err("Use absolute or ~/ SSH jump file references".into());
        }
        value.into()
    };
    // OpenSSH's quoted configuration lexer treats backslashes as escapes.
    #[cfg(windows)]
    let value = value.replace('\\', "/");
    #[cfg(not(windows))]
    let value = value.replace('\\', "\\\\");
    if value
        .chars()
        .any(|c| c.is_control() || matches!(c, '"' | '%' | '$'))
    {
        return Err("Invalid expanded jump file reference".into());
    }
    Ok(format!("\"{value}\""))
}

pub(crate) fn validate(hops: &[SshJumpPolicy]) -> Result<(), String> {
    if hops.is_empty() || hops.len() > 8 {
        return Err("Use one to eight SSH jump policies".into());
    }
    for hop in hops {
        if hop.host.len() > 253 || hop.user.as_ref().is_some_and(|user| user.len() > 256) {
            return Err("SSH jump hostname or username is too long".into());
        }
        crate::ssh_security::validate_endpoint(&crate::ssh_security::SshEndpoint {
            host: hop.host.clone(),
            user: hop.user.clone(),
            port: hop.port,
            identity_file: hop.identity_file.clone(),
            certificate_file: hop.certificate_file.clone(),
            ..Default::default()
        })?;
        // HostName is a concrete DNS/IP literal, never an SSH URI or port.
        if hop.host.contains([':', '[', ']']) {
            let address = hop
                .host
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
                .unwrap_or(&hop.host);
            address
                .parse::<std::net::IpAddr>()
                .map_err(|_| "Invalid jump IP address")?;
        }
        for path in [
            &hop.identity_file,
            &hop.certificate_file,
            &hop.known_hosts_file,
        ]
        .into_iter()
        .flatten()
        {
            literal_path(path)?;
        }
    }
    Ok(())
}

fn render(hops: &[SshJumpPolicy]) -> Result<String, String> {
    validate(hops)?;
    let mut config = String::new();
    for (index, hop) in hops.iter().enumerate() {
        config.push_str(&format!(
            "Host bycoda-hop-{index}\n  HostName {}\n  Port {}\n  StrictHostKeyChecking yes\n",
            hop.host, hop.port
        ));
        if let Some(user) = &hop.user {
            config.push_str(&format!("  User {user}\n"));
        }
        if let Some(path) = &hop.identity_file {
            config.push_str(&format!(
                "  IdentityFile {}\n  IdentitiesOnly yes\n",
                literal_path(path)?
            ));
        }
        if let Some(path) = &hop.certificate_file {
            config.push_str(&format!("  CertificateFile {}\n", literal_path(path)?));
        }
        if let Some(path) = &hop.known_hosts_file {
            config.push_str(&format!(
                "  UserKnownHostsFile {}\n  GlobalKnownHostsFile none\n",
                literal_path(path)?
            ));
        }
    }
    // OpenSSH uses the first obtained value. Defaults must follow hop stanzas.
    config.push_str("Host *\n  StrictHostKeyChecking yes\n  ForwardAgent no\n  ForwardX11 no\n  PermitLocalCommand no\n  ControlMaster no\n  ControlPath none\n  ClearAllForwardings yes\n  ServerAliveInterval 30\n  ServerAliveCountMax 3\n  ConnectTimeout 15\n");
    Ok(config)
}

/// Keep this guard alive until its owning SSH/PTY/SFTP process has exited.
/// The file contains public endpoint/reference metadata, never key contents.
/// No Drop implementation may remove a directory or a non-owned path.
#[derive(Debug)]
pub(crate) struct PreparedJumpConfig {
    path: PathBuf,
    jump_argument: String,
    fingerprint: String,
    file_identity: FileIdentity,
}

#[derive(Debug, PartialEq, Eq)]
struct FileIdentity {
    created: Option<std::time::SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}
impl FileIdentity {
    fn from_metadata(metadata: &fs::Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Self {
            created: metadata.created().ok(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
        }
    }
}

impl PartialEq for PreparedJumpConfig {
    fn eq(&self, other: &Self) -> bool {
        self.fingerprint == other.fingerprint
    }
}
impl Eq for PreparedJumpConfig {}

impl PreparedJumpConfig {
    pub(crate) fn create(hops: &[SshJumpPolicy]) -> Result<Self, String> {
        Self::create_in(&std::env::temp_dir(), hops)
    }

    fn create_in(parent: &Path, hops: &[SshJumpPolicy]) -> Result<Self, String> {
        let text = render(hops)?;
        let path = parent.join(format!("bycoda-ssh-jump-{}.conf", uuid::Uuid::new_v4()));
        // The path is passed as argv AND inherited by OpenSSH's generated child
        // command. Reject its interpolation tokens rather than trusting quoting.
        literal_path(path.to_str().ok_or("Invalid jump config path")?)?;
        if path
            .to_string_lossy()
            .chars()
            .any(|c| matches!(c, '\'' | '`' | '&' | '|' | ';' | '<' | '>'))
        {
            return Err("Unsupported characters in SSH jump config directory".into());
        }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .map_err(|_| "Cannot create private SSH jump config")?;
        let guard = Self {
            path,
            fingerprint: format!("{:x}", Sha256::digest(text.as_bytes())),
            file_identity: FileIdentity::from_metadata(
                &file
                    .metadata()
                    .map_err(|_| "Cannot inspect SSH jump config")?,
            ),
            jump_argument: (0..hops.len())
                .map(|i| format!("bycoda-hop-{i}"))
                .collect::<Vec<_>>()
                .join(","),
        };
        file.write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot write SSH jump config")?;
        Ok(guard)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn jump_argument(&self) -> &str {
        &self.jump_argument
    }
    pub(crate) fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
    pub(crate) fn matches(&self, hops: &[SshJumpPolicy]) -> Result<bool, String> {
        Ok(format!("{:x}", Sha256::digest(render(hops)?.as_bytes())) == self.fingerprint)
    }
}

impl Drop for PreparedJumpConfig {
    fn drop(&mut self) {
        // Preserve replacements and symlinks. This bounded check is not a claim
        // of race-free unlink against another process running as the same user.
        const MAX_CONFIG_BYTES: u64 = 128 * 1024;
        let Ok(metadata) = fs::symlink_metadata(&self.path) else {
            return;
        };
        if !metadata.file_type().is_file()
            || metadata.len() > MAX_CONFIG_BYTES
            || FileIdentity::from_metadata(&metadata) != self.file_identity
        {
            return;
        }
        let Ok(file) = fs::File::open(&self.path) else {
            return;
        };
        let Ok(opened) = file.metadata() else {
            return;
        };
        if FileIdentity::from_metadata(&opened) != self.file_identity {
            return;
        }
        let mut bytes = Vec::new();
        if file
            .take(MAX_CONFIG_BYTES + 1)
            .read_to_end(&mut bytes)
            .is_err()
            || bytes.len() as u64 > MAX_CONFIG_BYTES
            || format!("{:x}", Sha256::digest(&bytes)) != self.fingerprint
        {
            return;
        }
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
#[path = "ssh_jump_config_tests.rs"]
pub(crate) mod native_tests;

#[cfg(test)]
mod tests {
    use super::*;
    fn reference(value: &str) -> String {
        if cfg!(windows) {
            format!("C:{value}")
        } else {
            value.into()
        }
    }
    fn hop() -> SshJumpPolicy {
        SshJumpPolicy {
            host: "one.example".into(),
            user: Some("alice".into()),
            port: 2201,
            identity_file: Some(reference("/keys/one key")),
            certificate_file: Some(reference("/certs/one.pub")),
            known_hosts_file: Some(reference("/hosts/one")),
        }
    }

    #[test]
    fn independent_policy_is_explicit_and_never_runs_config_commands() {
        let mut second = hop();
        second.host = "two.example".into();
        second.user = Some("bob".into());
        second.port = 2202;
        second.identity_file = Some(reference("/keys/two"));
        second.certificate_file = None;
        let config = render(&[hop(), second]).unwrap();
        let (first, rest) = config.split_once("Host bycoda-hop-1").unwrap();
        assert!(
            first.contains("HostName one.example\n")
                && first.contains("User alice\n")
                && first.contains(&format!(
                    "IdentityFile {}",
                    literal_path(&reference("/keys/one key")).unwrap()
                ))
        );
        assert!(
            rest.contains("HostName two.example\n")
                && rest.contains("User bob\n")
                && rest.contains(&format!(
                    "IdentityFile {}",
                    literal_path(&reference("/keys/two")).unwrap()
                ))
        );
        assert!(!rest.contains("CertificateFile"));
        assert_eq!(config.matches("StrictHostKeyChecking yes").count(), 3);
        for forbidden in [
            "Include ",
            "ProxyCommand ",
            "LocalCommand ",
            "ForwardAgent yes",
            "StrictHostKeyChecking ask",
            "StrictHostKeyChecking no",
        ] {
            assert!(!config
                .lines()
                .any(|line| line.trim_start().starts_with(forbidden)));
        }
    }

    #[test]
    fn reject_option_config_and_expansion_injection_before_file_creation() {
        for bad in [
            "x\nProxyCommand evil",
            "\"quoted",
            "%h/key",
            "${HOME}/key",
            "\0",
            "",
        ] {
            let mut value = hop();
            value.known_hosts_file = Some(bad.into());
            assert!(render(&[value]).is_err(), "{bad:?}");
        }
        for bad in ["-oProxyCommand=evil", "x\nHost *", "alice@host"] {
            let mut value = hop();
            value.host = bad.into();
            assert!(render(&[value]).is_err());
        }
        assert!(render(&[]).is_err());
        assert!(render(&vec![hop(); 9]).is_err());
    }

    #[test]
    fn file_references_are_absolute_or_explicit_native_home() {
        for value in ["key", "./key", "../known_hosts", "~other/key", "C:key"] {
            assert!(literal_path(value).is_err(), "{value}");
        }
        #[cfg(windows)]
        assert!(literal_path("/drive-relative/key").is_err());
        let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let native_home = PathBuf::from(std::env::var_os(key).unwrap());
        let expected = native_home
            .join(".ssh/key")
            .to_string_lossy()
            .replace('\\', "/");
        assert_eq!(
            literal_path("~/.ssh/key").unwrap(),
            format!("\"{expected}\"")
        );
        assert!(literal_path(&reference("/absolute/key")).is_ok());
    }

    #[test]
    fn process_guard_owns_only_unique_file_and_cleans_it_on_drop() {
        let first = PreparedJumpConfig::create(&[hop()]).unwrap();
        let second = PreparedJumpConfig::create(&[hop(), hop()]).unwrap();
        let first_path = first.path().to_owned();
        let second_path = second.path().to_owned();
        let equivalent = PreparedJumpConfig::create(&[hop()]).unwrap();
        assert_eq!(first, equivalent);
        assert_eq!(first.fingerprint(), equivalent.fingerprint());
        assert_ne!(first.fingerprint(), second.fingerprint());
        assert_ne!(first_path, second_path);
        assert_eq!(second.jump_argument(), "bycoda-hop-0,bycoda-hop-1");
        assert!(fs::read_to_string(&first_path)
            .unwrap()
            .contains("Host bycoda-hop-0"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first_path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(first);
        assert!(!first_path.exists());
        assert!(second_path.exists());
        drop(second);
        assert!(!second_path.exists());
    }

    #[test]
    fn prepared_guard_never_matches_mutated_policy() {
        let original = hop();
        let guard = PreparedJumpConfig::create(std::slice::from_ref(&original)).unwrap();
        assert!(guard.matches(std::slice::from_ref(&original)).unwrap());
        let mut changed = original.clone();
        changed.host = "changed.example".into();
        assert!(!guard.matches(&[changed]).unwrap());
        let mut changed = original.clone();
        changed.identity_file = Some(reference("/keys/changed"));
        assert!(!guard.matches(&[changed]).unwrap());
        let mut changed = original.clone();
        changed.known_hosts_file = Some(reference("/hosts/changed"));
        assert!(!guard.matches(&[changed]).unwrap());
        let mut changed = original;
        changed.certificate_file = Some(reference("/certs/changed.pub"));
        assert!(!guard.matches(&[changed]).unwrap());
        assert!(guard.matches(&[]).is_err());
    }

    #[test]
    fn drop_preserves_replaced_file_and_symlink() {
        let guard = PreparedJumpConfig::create(&[hop()]).unwrap();
        let path = guard.path().to_owned();
        fs::remove_file(&path).unwrap();
        fs::write(&path, "owner replacement").unwrap();
        drop(guard);
        assert_eq!(fs::read_to_string(&path).unwrap(), "owner replacement");
        fs::remove_file(path).unwrap();
        #[cfg(unix)]
        {
            let target = PreparedJumpConfig::create(&[hop()]).unwrap();
            let guard = PreparedJumpConfig::create(&[hop()]).unwrap();
            let path = guard.path().to_owned();
            fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(target.path(), &path).unwrap();
            drop(guard);
            assert!(fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_symlink());
            assert!(target.path().exists());
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    #[ignore = "Runs installed OpenSSH config resolution; no network or credentials are accessed"]
    fn openssh_resolves_independent_hop_policy_and_inherits_config_path() {
        let mut second = hop();
        second.host = "two.example".into();
        second.user = Some("bob".into());
        second.port = 2202;
        second.identity_file = Some(reference("/keys/two"));
        second.certificate_file = None;
        second.known_hosts_file = Some(reference("/hosts/two"));
        let config = PreparedJumpConfig::create(&[hop(), second]).unwrap();
        let query = |alias: &str| {
            let output = std::process::Command::new("ssh")
                .arg("-G")
                .arg("-F")
                .arg(config.path())
                .arg(alias)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap().replace('\\', "/")
        };
        let first = query("bycoda-hop-0");
        let second = query("bycoda-hop-1");
        assert!(
            first.contains("hostname one.example")
                && first.contains("user alice")
                && first.contains("port 2201")
        );
        assert!(
            first.contains(&format!("identityfile {}", reference("/keys/one key")))
                && first.contains(&format!("certificatefile {}", reference("/certs/one.pub")))
        );
        assert!(
            second.contains(&format!("identityfile {}", reference("/keys/two")))
                && second.contains(&format!("userknownhostsfile {}", reference("/hosts/two")))
        );
        assert!(
            !second.contains(&format!("identityfile {}", reference("/keys/one")))
                && !second.contains(&format!("certificatefile {}", reference("/certs/one.pub")))
        );
        for value in [&first, &second] {
            assert!(value.contains("stricthostkeychecking true"));
            assert!(value.contains("forwardagent no"));
        }
        let output = std::process::Command::new("ssh")
            .args(["-vv", "-G", "-F"])
            .arg(config.path())
            .arg("-J")
            .arg(config.jump_argument())
            .arg("-i")
            .arg(config.path())
            .arg("target.example")
            .output()
            .unwrap();
        assert!(output.status.success());
        let debug = String::from_utf8_lossy(&output.stderr);
        assert!(
            debug.contains("-F")
                && debug.contains("bycoda-ssh-jump-")
                && debug.contains("bycoda-hop-0")
                && debug.contains("bycoda-hop-1"),
            "{debug}"
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("identityfile "));
        assert!(!String::from_utf8_lossy(&output.stdout)
            .replace('\\', "/")
            .contains(&format!("identityfile {}", reference("/keys/one key"))));
    }
}
