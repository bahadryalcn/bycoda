//! SSH-only policy and side-effect-free import/public metadata inspection.
//! This module never reads a private key, accepts a host key, or executes config.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::PathBuf};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshEndpoint {
    pub host: String,
    pub user: Option<String>,
    pub port: u16,
    pub identity_file: Option<String>,
    pub certificate_file: Option<String>,
    pub jump_host: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub jump_hosts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub jump_policies: Vec<crate::ssh_jump_config::SshJumpPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_proxy: Option<crate::ssh_http_proxy::HttpProxyEndpoint>,
    #[serde(skip)]
    pub(crate) prepared_jump_config:
        Option<std::sync::Arc<crate::ssh_jump_config::PreparedJumpConfig>>,
    #[serde(skip)]
    pub(crate) runtime_configuration: Option<std::sync::Arc<RuntimeConfiguration>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeConfiguration {
    pub digest: String,
    pub environment: Vec<crate::ssh_group_defaults::LiteralEnvironment>,
    pub shell_kind: Option<crate::ssh_group_defaults::RemoteShellKind>,
    pub provenance: std::collections::BTreeMap<String, crate::ssh_group_defaults::Provenance>,
}

fn safe_atom(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_:@[]".contains(c))
}

pub(crate) fn validate_endpoint(endpoint: &SshEndpoint) -> Result<(), String> {
    if let Some(proxy) = &endpoint.http_proxy {
        proxy.validate()?;
        if endpoint.jump_host.is_some()
            || !endpoint.jump_hosts.is_empty()
            || !endpoint.jump_policies.is_empty()
        {
            return Err("HTTP upstream proxy cannot be combined with SSH jump hosts".into());
        }
    }
    if !endpoint.jump_policies.is_empty() {
        if endpoint.jump_host.is_some() || !endpoint.jump_hosts.is_empty() {
            return Err("Use either legacy jumps or per-hop policies".into());
        }
        crate::ssh_jump_config::validate(&endpoint.jump_policies)?;
        if (0..endpoint.jump_policies.len()).any(|index| {
            endpoint
                .host
                .eq_ignore_ascii_case(&format!("bycoda-hop-{index}"))
        }) {
            return Err("Final hostname conflicts with an internal jump alias; use its address or another hostname".into());
        }
    }
    if !safe_atom(&endpoint.host) || endpoint.host.contains('@') || endpoint.port == 0 {
        return Err("Invalid SSH host or port".into());
    }
    if let Some(user) = &endpoint.user {
        if !safe_atom(user) || user.contains(['@', ':', '[', ']']) {
            return Err("Invalid SSH username".into());
        }
    }
    for reference in [&endpoint.identity_file, &endpoint.certificate_file]
        .into_iter()
        .flatten()
    {
        if reference.is_empty()
            || reference.len() > 4096
            || reference.chars().any(|c| c.is_control() || c == '%')
        {
            return Err("Invalid SSH key or certificate file reference".into());
        }
    }
    if endpoint
        .certificate_file
        .as_ref()
        .is_some_and(|path| path.contains('"'))
    {
        return Err("Certificate file paths cannot contain double quotes".into());
    }
    if endpoint.jump_host.is_some() && !endpoint.jump_hosts.is_empty() {
        return Err("Use either a legacy jump host or an ordered jump chain".into());
    }
    if endpoint.jump_hosts.len() > 8 {
        return Err("Use at most eight SSH jump hosts".into());
    }
    for jump in endpoint.jump_host.iter().chain(endpoint.jump_hosts.iter()) {
        // Concrete hops only. Each is one argv-safe literal; comma joins happen
        // below after validation, never by accepting options or shell text.
        if !safe_atom(jump) || jump.matches('@').count() > 1 || jump == "none" {
            return Err("Invalid SSH jump host".into());
        }
        if let Some((user, _)) = jump.split_once('@') {
            if !safe_atom(user) || user.contains(['@', ':', '[', ']']) {
                return Err("Invalid SSH jump username".into());
            }
        }
        let address = jump.rsplit('@').next().unwrap_or_default();
        if !address.starts_with('[') && address.matches(':').count() > 1 {
            return Err("Use brackets around an IPv6 jump host".into());
        }
        let (host, port) = if address.starts_with('[') {
            let end = address.find(']').ok_or("Invalid jump IPv6 address")?;
            let tail = &address[end + 1..];
            let port = if tail.is_empty() {
                None
            } else {
                Some(tail.strip_prefix(':').ok_or("Invalid jump port")?)
            };
            (&address[1..end], port)
        } else if address.matches(':').count() == 1 {
            let (host, port) = address.rsplit_once(':').unwrap();
            (host, Some(port))
        } else {
            (address, None)
        };
        if host.is_empty()
            || port.is_some_and(|p| p.parse::<u16>().ok().filter(|p| *p != 0).is_none())
        {
            return Err("Invalid SSH jump host or port".into());
        }
        if jump.starts_with('@') {
            return Err("Invalid SSH jump username".into());
        }
    }
    Ok(())
}

/// One policy for terminal, SFTP and forwarding; callers add only their mode.
pub(crate) fn connection_args(endpoint: &SshEndpoint) -> Result<Vec<String>, String> {
    validate_endpoint(endpoint)?;
    let config = endpoint.prepared_jump_config.as_ref();
    if config.is_some_and(|config| !config.matches(&endpoint.jump_policies).unwrap_or(false)) {
        return Err("Prepared SSH jump policy no longer matches this endpoint".into());
    }
    if !endpoint.jump_policies.is_empty() && config.is_none() {
        return Err("Per-hop SSH policy must be prepared before launching".into());
    }
    let mut args = vec![
        "-F".into(),
        config
            .map(|c| c.path().to_string_lossy().into_owned())
            .unwrap_or_else(|| "none".into()),
    ];
    for option in [
        "StrictHostKeyChecking=yes",
        "ForwardAgent=no",
        "ForwardX11=no",
        "PermitLocalCommand=no",
        "ControlMaster=no",
        "ControlPath=none",
        "ClearAllForwardings=yes",
        "ServerAliveInterval=30",
        "ServerAliveCountMax=3",
        "ConnectTimeout=15",
    ] {
        args.extend(["-o".into(), option.into()]);
    }
    args.extend(["-p".into(), endpoint.port.to_string()]);
    if let Some(user) = &endpoint.user {
        args.extend(["-l".into(), user.clone()]);
    }
    if let Some(identity) = &endpoint.identity_file {
        let expanded = if let Some(tail) = identity
            .strip_prefix("~/")
            .or_else(|| identity.strip_prefix("~\\"))
        {
            ssh_dir()?
                .parent()
                .ok_or("Home directory unavailable")?
                .join(tail)
                .to_string_lossy()
                .into_owned()
        } else {
            identity.clone()
        };
        args.extend([
            "-o".into(),
            "IdentitiesOnly=yes".into(),
            "-i".into(),
            expanded,
        ]);
    }
    if let Some(certificate) = &endpoint.certificate_file {
        let expanded = if let Some(tail) = certificate
            .strip_prefix("~/")
            .or_else(|| certificate.strip_prefix("~\\"))
        {
            ssh_dir()?
                .parent()
                .ok_or("Home directory unavailable")?
                .join(tail)
                .to_string_lossy()
                .into_owned()
        } else {
            certificate.clone()
        };
        args.extend(["-o".into(), format!("CertificateFile=\"{expanded}\"")]);
    }
    let jumps: Vec<&str> = endpoint
        .jump_host
        .iter()
        .chain(endpoint.jump_hosts.iter())
        .map(String::as_str)
        .collect();
    if let Some(config) = config {
        args.extend(["-J".into(), config.jump_argument().into()]);
    } else if !jumps.is_empty() {
        args.extend(["-J".into(), jumps.join(",")]);
    } else if endpoint.http_proxy.is_some() {
        let executable =
            std::env::current_exe().map_err(|_| "Application executable is unavailable")?;
        args.extend([
            "-o".into(),
            format!(
                "ProxyCommand={}",
                crate::ssh_http_proxy::proxy_command(&executable)?
            ),
        ]);
    } else {
        args.extend(["-o".into(), "ProxyCommand=none".into()]);
    }
    Ok(args)
}

/// Native-only process lease. Only public endpoint references enter the file.
pub(crate) fn prepare_endpoint(mut endpoint: SshEndpoint) -> Result<SshEndpoint, String> {
    validate_endpoint(&endpoint)?;
    if endpoint.jump_policies.is_empty() {
        endpoint.prepared_jump_config = None;
    } else if !endpoint
        .prepared_jump_config
        .as_ref()
        .is_some_and(|config| config.matches(&endpoint.jump_policies).unwrap_or(false))
    {
        endpoint.prepared_jump_config = Some(std::sync::Arc::new(
            crate::ssh_jump_config::PreparedJumpConfig::create(&endpoint.jump_policies)?,
        ));
    }
    Ok(endpoint)
}

/// Fresh one-use relay per child, including every SFTP metadata/transfer batch.
/// Public endpoint resolution never opens a proxy connection or retains credentials.
#[cfg(test)]
pub(crate) fn start_http_proxy(
    endpoint: &SshEndpoint,
) -> Result<Option<std::sync::Arc<crate::ssh_http_proxy::HttpProxyLease>>, String> {
    start_http_proxy_authorized(endpoint, None)
}

pub(crate) fn start_http_proxy_authorized(
    endpoint: &SshEndpoint,
    grant: Option<&crate::ssh_http_proxy_credentials::HttpProxyGrant>,
) -> Result<Option<std::sync::Arc<crate::ssh_http_proxy::HttpProxyLease>>, String> {
    validate_endpoint(endpoint)?;
    let credentials = grant
        .map(|grant| grant.credentials_for(endpoint))
        .transpose()?;
    endpoint
        .http_proxy
        .as_ref()
        .map(|proxy| {
            let host = endpoint
                .host
                .strip_prefix('[')
                .and_then(|value| value.strip_suffix(']'))
                .unwrap_or(&endpoint.host)
                .to_string();
            crate::ssh_http_proxy::HttpProxyLease::start(
                proxy.clone(),
                crate::ssh_http_proxy::HttpProxyTarget {
                    host,
                    port: endpoint.port,
                },
                credentials,
            )
            .map(std::sync::Arc::new)
        })
        .transpose()
}

/// Reattach identity binds configuration content, never an ephemeral filename.
pub(crate) fn stable_args(endpoint: &SshEndpoint, args: &[String]) -> Vec<String> {
    let mut args = args.to_vec();
    if let Some(configuration) = &endpoint.runtime_configuration {
        args.push(format!(
            "bycoda-effective-configuration:{}",
            configuration.digest
        ));
    }
    if let Some(proxy) = &endpoint.http_proxy {
        // The fixed helper argv contains no proxy address. Bind the effective
        // upstream separately so edits cannot reattach an old route silently.
        args.push(format!(
            "bycoda-{}-upstream:{}:{}",
            if proxy.scheme == crate::ssh_http_proxy::HttpProxyScheme::Https {
                "https"
            } else {
                "http"
            },
            proxy.host.to_ascii_lowercase(),
            proxy.port
        ));
    }
    if let Some(config) = &endpoint.prepared_jump_config {
        for index in 0..args.len().saturating_sub(1) {
            if args[index] == "-F" && args[index + 1] == config.path().to_string_lossy() {
                args[index + 1] = format!("prepared-jump:{}", config.fingerprint());
            }
        }
    }
    args
}

pub(crate) fn interactive_args(endpoint: &SshEndpoint) -> Result<Vec<String>, String> {
    let mut args = connection_args(endpoint)?;
    // OpenSSH presents its fingerprint and reads an explicit decision in the PTY.
    // Changed/revoked keys still fail; file transfers and forwards remain strict=yes.
    if let Some(policy) = args
        .iter_mut()
        .find(|arg| arg.as_str() == "StrictHostKeyChecking=yes")
    {
        *policy = "StrictHostKeyChecking=ask".into();
    }
    args.extend(["-tt".into(), "--".into(), endpoint.host.clone()]);
    Ok(args)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub endpoint: SshEndpoint,
    pub duplicate: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigPreview {
    pub hosts: Vec<SshConfigHost>,
    pub warnings: Vec<String>,
}

/// Parse literal Host blocks only. Unsupported semantics are conspicuous and
/// never silently execute. No filesystem reads or subprocesses occur here.
#[tauri::command]
pub fn ssh_config_preview(content: String) -> Result<SshConfigPreview, String> {
    if content.len() > 1024 * 1024 {
        return Err("SSH config exceeds 1 MiB".into());
    }
    let mut result = SshConfigPreview::default();
    let mut current = Vec::<usize>::new();
    let mut seen = HashSet::new();
    for (line_index, raw) in content.lines().enumerate() {
        let raw = raw.trim();
        if raw.is_empty() || raw.starts_with('#') {
            continue;
        }
        let Some(separator) = raw.find(|c: char| c.is_whitespace() || c == '=') else {
            result.warnings.push(format!(
                "Line {}: malformed directive ignored",
                line_index + 1
            ));
            continue;
        };
        let key = raw[..separator].to_ascii_lowercase();
        let value = raw[separator..]
            .trim_start_matches(|c: char| c.is_whitespace() || c == '=')
            .trim();
        if key == "host" {
            current.clear();
            for alias in value.split_whitespace() {
                if !safe_atom(alias) || alias.contains(['@', ':', '[', ']']) {
                    result.warnings.push(format!(
                        "Line {}: wildcard or nonliteral Host skipped",
                        line_index + 1
                    ));
                    continue;
                }
                let duplicate = !seen.insert(alias.to_ascii_lowercase());
                current.push(result.hosts.len());
                result.hosts.push(SshConfigHost {
                    alias: alias.into(),
                    endpoint: SshEndpoint {
                        host: alias.into(),
                        port: 22,
                        ..Default::default()
                    },
                    duplicate,
                });
            }
            continue;
        }
        if key == "match" {
            current.clear();
        }
        if !matches!(
            key.as_str(),
            "hostname" | "user" | "port" | "identityfile" | "certificatefile" | "proxyjump"
        ) {
            result.warnings.push(format!(
                "Line {}: {} ignored; not imported",
                line_index + 1,
                key
            ));
            continue;
        }
        if current.is_empty() {
            result.warnings.push(format!(
                "Line {}: global or unsupported block defaults not imported",
                line_index + 1
            ));
            continue;
        }
        // Accept a single quoted path, but do not implement shell escaping,
        // env/token substitutions, comments or config inheritance implicitly.
        let value = if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            &value[1..value.len() - 1]
        } else {
            value
        };
        for &index in &current {
            let endpoint = &mut result.hosts[index].endpoint;
            match key.as_str() {
                "hostname" => endpoint.host = value.into(),
                "user" => endpoint.user = Some(value.into()),
                "port" => endpoint.port = value.parse().unwrap_or(0),
                "identityfile" => endpoint.identity_file = Some(value.into()),
                "certificatefile" => endpoint.certificate_file = Some(value.into()),
                "proxyjump" => {
                    endpoint.jump_host = None;
                    endpoint.jump_hosts = if value.eq_ignore_ascii_case("none") {
                        Vec::new()
                    } else {
                        value.split(',').map(|hop| hop.trim().to_string()).collect()
                    };
                }
                _ => unreachable!(),
            }
        }
    }
    result.hosts.retain(|host| {
        if validate_endpoint(&host.endpoint).is_err() {
            result.warnings.push(format!(
                "Host {} skipped: invalid endpoint or unsupported expansion",
                host.alias
            ));
            false
        } else {
            true
        }
    });
    Ok(result)
}

fn ssh_dir() -> Result<PathBuf, String> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(key)
        .map(|home| PathBuf::from(home).join(".ssh"))
        .ok_or_else(|| "Home directory unavailable".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPublicMetadata {
    pub host_patterns: Option<String>,
    pub identity_file: Option<String>,
    pub key_type: String,
    pub fingerprint: String,
    pub marker: Option<String>,
}

fn fingerprint(value: &str) -> Option<String> {
    let bytes = STANDARD.decode(value).ok()?;
    if bytes.len() < 8 || bytes.len() > 64 * 1024 {
        return None;
    }
    Some(format!(
        "SHA256:{}",
        STANDARD.encode(Sha256::digest(bytes)).trim_end_matches('=')
    ))
}

/// Read a bounded public file only; symlinks are intentionally not traversed.
enum PublicFile {
    Unavailable,
    TooLarge,
    Text(String),
}
fn public_file(path: &std::path::Path) -> Result<PublicFile, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PublicFile::Unavailable)
        }
        Err(_) => return Err("Cannot inspect SSH public metadata".into()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Ok(PublicFile::Unavailable);
    }
    if metadata.len() > 1024 * 1024 {
        return Ok(PublicFile::TooLarge);
    }
    fs::read_to_string(path)
        .map(PublicFile::Text)
        .map_err(|_| "Cannot read SSH public metadata".into())
}

#[tauri::command]
pub fn ssh_known_hosts_list() -> Result<Vec<SshPublicMetadata>, String> {
    known_hosts_at(&ssh_dir()?.join("known_hosts"))
}

fn known_hosts_at(path: &std::path::Path) -> Result<Vec<SshPublicMetadata>, String> {
    match public_file(path)? {
        PublicFile::Unavailable => Ok(vec![]),
        PublicFile::TooLarge => Err(
            "Known hosts metadata exceeds the 1 MiB display limit. The trust file is unchanged."
                .into(),
        ),
        PublicFile::Text(content) => Ok(parse_known_hosts(&content)),
    }
}

fn parse_known_hosts(content: &str) -> Vec<SshPublicMetadata> {
    content
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let first = fields.next()?;
            if first.starts_with('#') {
                return None;
            }
            let marker = first.starts_with('@').then(|| first.to_string());
            let hosts = if marker.is_some() {
                fields.next()?
            } else {
                first
            };
            let key_type = fields.next()?.to_string();
            let fingerprint = fingerprint(fields.next()?)?;
            Some(SshPublicMetadata {
                host_patterns: Some(hosts.into()),
                identity_file: None,
                key_type,
                fingerprint,
                marker,
            })
        })
        .take(10000)
        .collect()
}

#[tauri::command]
pub fn ssh_public_keys_list() -> Result<Vec<SshPublicMetadata>, String> {
    let directory = ssh_dir()?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("Cannot list SSH public keys".into()),
    };
    let mut result = vec![];
    for entry in entries.take(1000).flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("pub") {
            continue;
        }
        let PublicFile::Text(content) = public_file(&path)? else {
            continue;
        };
        let mut fields = content.split_whitespace();
        let Some(key_type) = fields.next().filter(|value| {
            value.starts_with("ssh-") || value.starts_with("ecdsa-") || value.starts_with("sk-")
        }) else {
            continue;
        };
        let Some(fingerprint) = fields.next().and_then(fingerprint) else {
            continue;
        };
        result.push(SshPublicMetadata {
            host_patterns: None,
            identity_file: Some(path.with_extension("").to_string_lossy().into_owned()),
            key_type: key_type.into(),
            fingerprint,
            marker: None,
        });
    }
    result.sort_by(|a, b| a.identity_file.cmp(&b.identity_file));
    Ok(result)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshAgentIdentity {
    pub bits: u32,
    pub fingerprint: String,
    pub key_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAgentInventory {
    /// available, empty, or unavailable; never infer authentication success.
    pub status: String,
    pub identities: Vec<SshAgentIdentity>,
}

fn parse_agent_identities(output: &str) -> Vec<SshAgentIdentity> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let bits = fields.next()?.parse::<u32>().ok()?;
            let fingerprint = fields.next()?.to_string();
            if !fingerprint.starts_with("SHA256:")
                || fingerprint.len() > 100
                || !fingerprint
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ":+/=".contains(c))
            {
                return None;
            }
            // Comments may contain arbitrary user text; never collect or display
            // them. The final parenthesized algorithm is public metadata only.
            let key_type = line.rsplit_once('(')?.1.strip_suffix(')')?;
            if key_type.is_empty()
                || key_type.len() > 80
                || !key_type
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_@.".contains(c))
            {
                return None;
            }
            Some(SshAgentIdentity {
                bits,
                fingerprint,
                key_type: key_type.into(),
            })
        })
        .take(256)
        .collect()
}

/// Agent inspection never loads/adds/forwards keys or reads private-key bytes.
#[tauri::command(async)]
pub fn ssh_agent_identities() -> SshAgentInventory {
    use std::{
        io::Read,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let unavailable = || SshAgentInventory {
        status: "unavailable".into(),
        identities: vec![],
    };
    let mut command = Command::new(if cfg!(windows) {
        "ssh-add.exe"
    } else {
        "ssh-add"
    });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .args(["-l", "-E", "sha256"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("SSH_ASKPASS_REQUIRE", "never");
    let Ok(mut child) = command.spawn() else {
        return unavailable();
    };
    let Some(output) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return unavailable();
    };
    let reader = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = output.take(64 * 1024 + 1).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return unavailable();
            }
        }
    };
    let Ok(bytes) = reader.join() else {
        return unavailable();
    };
    if bytes.len() > 64 * 1024 {
        return unavailable();
    }
    if status.code() == Some(1) {
        return SshAgentInventory {
            status: "empty".into(),
            identities: vec![],
        };
    }
    if !status.success() {
        return unavailable();
    }
    let Ok(output) = String::from_utf8(bytes) else {
        return unavailable();
    };
    let identities = parse_agent_identities(&output);
    SshAgentInventory {
        status: if identities.is_empty() {
            "empty"
        } else {
            "available"
        }
        .into(),
        identities,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_upstream_is_explicit_process_scoped_and_identity_bound() {
        let direct = SshEndpoint {
            host: "target.example".into(),
            port: 22,
            ..Default::default()
        };
        let endpoint = SshEndpoint {
            http_proxy: Some(crate::ssh_http_proxy::HttpProxyEndpoint {
                scheme: Default::default(),
                host: "127.0.0.1".into(),
                port: 3128,
            }),
            ..direct.clone()
        };
        let args = connection_args(&endpoint).unwrap();
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("ProxyCommand=") && arg.ends_with(" ssh-http-proxy")));
        assert!(!args.iter().any(|arg| arg.contains("3128")));
        let mut changed = endpoint.clone();
        changed.http_proxy.as_mut().unwrap().port = 8080;
        assert_eq!(
            connection_args(&endpoint).unwrap(),
            connection_args(&changed).unwrap()
        );
        assert_ne!(stable_args(&endpoint, &args), stable_args(&changed, &args));
        let mut secure = endpoint.clone();
        secure.http_proxy.as_mut().unwrap().scheme = crate::ssh_http_proxy::HttpProxyScheme::Https;
        assert_eq!(connection_args(&secure).unwrap(), args);
        assert_ne!(stable_args(&endpoint, &args), stable_args(&secure, &args));
        changed.jump_hosts = vec!["jump.example".into()];
        assert!(validate_endpoint(&changed).is_err());
        assert!(start_http_proxy(&direct).unwrap().is_none());
        let first = start_http_proxy(&endpoint).unwrap().unwrap();
        let second = start_http_proxy(&endpoint).unwrap().unwrap();
        assert_ne!(
            first.environment(),
            second.environment(),
            "Each child needs its own one-use capability"
        );
        assert!(!serde_json::to_string(&endpoint)
            .unwrap()
            .contains("CAPABILITY"));
    }
    #[test]
    fn chains_and_certificate_are_structured_and_keep_legacy_semantics() {
        let mut target = endpoint();
        target.certificate_file = Some("C:/Public certificates/server-cert.pub".into());
        target.jump_hosts = vec!["alice@one.test:2201".into(), "bob@[::1]:2202".into()];
        let args = connection_args(&target).unwrap();
        let jump = args.iter().position(|arg| arg == "-J").unwrap();
        assert_eq!(args[jump + 1], "alice@one.test:2201,bob@[::1]:2202");
        assert!(args
            .iter()
            .any(|arg| arg == "CertificateFile=\"C:/Public certificates/server-cert.pub\""));
        assert!(args.iter().any(|arg| arg == "StrictHostKeyChecking=yes"));
        target.jump_host = Some("legacy.test".into());
        assert!(connection_args(&target).is_err());
        target.jump_host = None;
        target.jump_hosts = vec!["hop.test".into(); 9];
        assert!(connection_args(&target).is_err());
        target.jump_hosts = vec!["alice:bad@hop.test".into()];
        assert!(connection_args(&target).is_err());
        target.jump_hosts.clear();
        target.certificate_file = Some("%d/cert".into());
        assert!(connection_args(&target).is_err());
        let legacy: SshEndpoint =
            serde_json::from_str(r#"{"host":"server.test","port":22,"jumpHost":"hop.test"}"#)
                .unwrap();
        assert!(legacy.jump_hosts.is_empty());
        assert!(legacy.certificate_file.is_none());
        assert!(connection_args(&legacy)
            .unwrap()
            .contains(&"hop.test".into()));
    }
    #[test]
    fn import_preserves_ordered_chain_and_certificate_without_reading_files() {
        let preview = ssh_config_preview("Host example\n HostName target.test\n ProxyJump alice@one.test:2201,bob@two.test:2202\n CertificateFile \"/not/read/public cert\"\nHost direct\n ProxyJump none".into()).unwrap();
        assert_eq!(preview.hosts.len(), 2);
        assert_eq!(
            preview.hosts[0].endpoint.jump_hosts,
            ["alice@one.test:2201", "bob@two.test:2202"]
        );
        assert_eq!(
            preview.hosts[0].endpoint.certificate_file.as_deref(),
            Some("/not/read/public cert")
        );
        assert!(preview.hosts[1].endpoint.jump_hosts.is_empty());
    }
    fn endpoint() -> SshEndpoint {
        SshEndpoint {
            host: "example.test".into(),
            user: Some("alice".into()),
            port: 22,
            identity_file: None,
            jump_host: None,
            jump_hosts: Vec::new(),
            certificate_file: None,
            ..Default::default()
        }
    }
    #[test]
    fn prepared_hops_are_native_only_and_stable_identity_excludes_temporary_names() {
        let mut canonical = endpoint();
        canonical.jump_policies = vec![crate::ssh_jump_config::SshJumpPolicy {
            host: "hop.fixture.invalid".into(),
            user: Some("operator".into()),
            port: 2222,
            identity_file: Some(
                if cfg!(windows) {
                    "C:/fixture/key-ref"
                } else {
                    "/fixture/key-ref"
                }
                .into(),
            ),
            certificate_file: None,
            known_hosts_file: Some(
                if cfg!(windows) {
                    "C:/fixture/trust-ref"
                } else {
                    "/fixture/trust-ref"
                }
                .into(),
            ),
        }];
        assert!(connection_args(&canonical).is_err());
        let first = prepare_endpoint(canonical.clone()).unwrap();
        let second = prepare_endpoint(canonical).unwrap();
        let first_path = first
            .prepared_jump_config
            .as_ref()
            .unwrap()
            .path()
            .to_path_buf();
        let second_path = second
            .prepared_jump_config
            .as_ref()
            .unwrap()
            .path()
            .to_path_buf();
        assert_ne!(first_path, second_path);
        assert!(first_path.exists() && second_path.exists());
        assert_eq!(
            stable_args(&first, &interactive_args(&first).unwrap()),
            stable_args(&second, &interactive_args(&second).unwrap())
        );
        let encoded = serde_json::to_string(&first).unwrap();
        assert!(!encoded.contains("prepared_jump") && !encoded.contains("bycoda-ssh-jump-"));
        let decoded: SshEndpoint = serde_json::from_str(&encoded).unwrap();
        assert!(decoded.prepared_jump_config.is_none());
        assert_eq!(decoded.jump_policies, first.jump_policies);
        let mut changed = first.clone();
        changed.jump_policies[0].host = "different-hop.fixture.invalid".into();
        assert!(connection_args(&changed).is_err());
        let changed = prepare_endpoint(changed).unwrap();
        assert_ne!(
            stable_args(&first, &interactive_args(&first).unwrap()),
            stable_args(&changed, &interactive_args(&changed).unwrap())
        );
        let mut no_hops = changed;
        no_hops.jump_policies.clear();
        let no_hops = prepare_endpoint(no_hops).unwrap();
        assert!(no_hops.prepared_jump_config.is_none());
        drop(first);
        drop(second);
        assert!(!first_path.exists() && !second_path.exists());
    }
    #[test]
    fn interactive_is_explicit_and_has_no_remote_command() {
        let args = interactive_args(&endpoint()).unwrap();
        assert_eq!(&args[..2], ["-F", "none"]);
        assert!(args.contains(&"StrictHostKeyChecking=ask".into()));
        assert!(connection_args(&endpoint())
            .unwrap()
            .contains(&"StrictHostKeyChecking=yes".into()));
        assert!(args.contains(&"ForwardAgent=no".into()));
        assert_eq!(&args[args.len() - 3..], ["-tt", "--", "example.test"]);
    }
    #[test]
    fn rejects_option_shell_and_token_injection() {
        for host in ["-oProxyCommand=evil", "$(evil)", "a\nb", "x;evil", "%h"] {
            let mut value = endpoint();
            value.host = host.into();
            assert!(interactive_args(&value).is_err());
        }
        let mut value = endpoint();
        value.identity_file = Some("%d/key".into());
        assert!(interactive_args(&value).is_err());
        value.identity_file = None;
        for jump in ["-evil", "a,b", "u@host:0", "@host", "a:evil", "x\n"] {
            value.jump_host = Some(jump.into());
            assert!(interactive_args(&value).is_err(), "{jump}");
        }
        value.jump_host = Some("alice@[::1]:2222".into());
        assert!(interactive_args(&value).is_ok());
    }
    #[test]
    fn import_is_preview_only_and_suppresses_executable_semantics() {
        let preview = ssh_config_preview("Include /private/*\nHost build\n HostName build.test\n User alice\n IdentityFile \"C:/Keys/key name\"\n ProxyCommand echo stolen\n LocalCommand touch bad\nMatch exec evil\n HostName wrong\nHost build\n Port 2222".into()).unwrap();
        assert_eq!(preview.hosts.len(), 2);
        assert_eq!(preview.hosts[0].endpoint.host, "build.test");
        assert_eq!(
            preview.hosts[0].endpoint.identity_file.as_deref(),
            Some("C:/Keys/key name")
        );
        assert!(preview.hosts[1].duplicate);
        assert!(preview
            .warnings
            .iter()
            .any(|warning| warning.contains("proxycommand")));
        assert!(preview
            .warnings
            .iter()
            .any(|warning| warning.contains("include")));
    }
    #[test]
    fn invalid_import_and_wildcards_are_not_ready_endpoints() {
        let preview = ssh_config_preview(
            "Host *\n User root\nHost invalid\n HostName evil;run\nHost okay\n Port 2200".into(),
        )
        .unwrap();
        assert_eq!(preview.hosts.len(), 1);
        assert_eq!(preview.hosts[0].alias, "okay");
        assert_eq!(preview.hosts[0].endpoint.user, None);
    }
    #[test]
    fn known_hosts_exports_only_public_fingerprint_and_marker() {
        let blob = STANDARD.encode(b"public-key-fixture");
        let rows = parse_known_hosts(&format!("# comment\n@revoked host.test ssh-ed25519 {blob}\n|1|hashed|value ssh-rsa {blob}\nbad row"));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].marker.as_deref(), Some("@revoked"));
        assert!(rows[0].fingerprint.starts_with("SHA256:"));
        assert_eq!(rows[1].host_patterns.as_deref(), Some("|1|hashed|value"));
    }

    #[test]
    fn known_hosts_oversized_metadata_is_not_reported_as_an_empty_file() {
        let root =
            std::env::temp_dir().join(format!("bycoda-known-hosts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("known_hosts");
        assert!(known_hosts_at(&path).unwrap().is_empty());
        std::fs::write(&path, "").unwrap();
        assert!(known_hosts_at(&path).unwrap().is_empty());
        std::fs::write(&path, vec![b'#'; 1024 * 1024 + 1]).unwrap();
        assert!(known_hosts_at(&path)
            .unwrap_err()
            .contains("1 MiB display limit"));
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 1024 * 1024 + 1);
        // Public-key enumeration still deliberately skips oversized files.
        assert!(matches!(public_file(&path).unwrap(), PublicFile::TooLarge));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn agent_inventory_omits_comments_and_rejects_arbitrary_output() {
        let rows = parse_agent_identities("256 SHA256:abcdef1234 do-not-collect-comment (ED25519)\n2048 SHA256:other123 cardno:123 (RSA)\nnot an identity\n256 SHA256:evil;run comment (ED25519)\n256 SHA256:bad comment (bad type)");
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[0],
            SshAgentIdentity {
                bits: 256,
                fingerprint: "SHA256:abcdef1234".into(),
                key_type: "ED25519".into()
            }
        );
        assert!(!format!("{rows:?}").contains("collect-comment"));
    }

    #[test]
    fn real_agent_inventory_is_read_only_and_bounded() {
        let started = std::time::Instant::now();
        let result = ssh_agent_identities();
        assert!(["available", "empty", "unavailable"].contains(&result.status.as_str()));
        assert!(started.elapsed() < std::time::Duration::from_secs(6));
        assert!(result.identities.len() <= 256);
    }
}
