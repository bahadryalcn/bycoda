//! Explicit public-certificate inspection only. No enrollment, private-key reads,
//! authentication or remote mutation. The caller supplies a file reference, never contents.
use base64::Engine;
use serde::Serialize;
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const MAX_CERT: u64 = 65_536;
const MAX_OUTPUT: u64 = 65_536;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshCertificateMetadata {
    pub certificate_type: String,
    pub fingerprint: String,
    pub signing_ca_fingerprint: Option<String>,
    pub serial: String,
    pub validity: String,
    pub principals: Vec<String>,
}

fn public_snapshot(reference: &str) -> Result<Vec<u8>, String> {
    if reference.is_empty() || reference.len() > 4096 || reference.chars().any(char::is_control) {
        return Err("Invalid public certificate reference".into());
    }
    let path = if let Some(tail) = reference
        .strip_prefix("~/")
        .or_else(|| reference.strip_prefix("~\\"))
    {
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(std::path::PathBuf::from)
            .ok_or("Home directory unavailable")?
            .join(tail)
    } else {
        reference.into()
    };
    let metadata =
        std::fs::symlink_metadata(&path).map_err(|_| "Cannot inspect public certificate file")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_CERT {
        return Err("Choose a regular public certificate file no larger than 64 KiB".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let mut file = options
        .open(path)
        .map_err(|_| "Cannot open public certificate file")?;
    let opened = file
        .metadata()
        .map_err(|_| "Cannot inspect public certificate handle")?;
    if !opened.is_file() || opened.file_type().is_symlink() || opened.len() > MAX_CERT {
        return Err("Public certificate file changed or is not regular".into());
    }
    // Read only the bounded type token before deciding whether to read a body.
    // A private-key header is rejected here; its body is never read or exposed.
    let mut header = Vec::new();
    loop {
        let mut byte = [0];
        if file
            .read(&mut byte)
            .map_err(|_| "Cannot read certificate type")?
            != 1
        {
            return Err("Invalid public certificate type".into());
        }
        if byte[0] == b' ' {
            break;
        }
        if header.len() >= 96 || !byte[0].is_ascii_graphic() {
            return Err("Invalid public certificate type".into());
        }
        header.push(byte[0]);
    }
    let algorithm = std::str::from_utf8(&header).map_err(|_| "Invalid public certificate type")?;
    if !algorithm.ends_with("-cert-v01@openssh.com")
        || !algorithm
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-@.".contains(&c))
    {
        return Err(
            "Select an OpenSSH public certificate, not a private or ordinary public key".into(),
        );
    }
    let mut body = Vec::new();
    loop {
        let mut byte = [0];
        if file
            .read(&mut byte)
            .map_err(|_| "Cannot read public certificate")?
            == 0
            || byte[0].is_ascii_whitespace()
        {
            break;
        }
        if body.len() + header.len() + 1 >= MAX_CERT as usize {
            return Err("Public certificate exceeds 64 KiB".into());
        }
        body.push(byte[0]);
    }
    // Stop before comments or another line, which might contain unrelated private data.
    let encoded = std::str::from_utf8(&body).map_err(|_| "Invalid public certificate encoding")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid public certificate encoding")?;
    if decoded.len() < 4 {
        return Err("Invalid public certificate data".into());
    }
    let length = u32::from_be_bytes(decoded[..4].try_into().unwrap()) as usize;
    if length != header.len() || decoded.get(4..4 + length) != Some(header.as_slice()) {
        return Err("Public certificate type does not match its data".into());
    }
    // Drop comments and additional lines; only one validated public blob enters the tool.
    Ok(format!("{algorithm} {encoded}\n").into_bytes())
}

fn fingerprint(text: &str) -> Option<String> {
    let value = text.split_whitespace().find(|s| s.starts_with("SHA256:"))?;
    (value.len() <= 100
        && value.len() > 7
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b":+/=".contains(&c)))
    .then(|| value.to_string())
}

fn parse_metadata(text: &str) -> Result<SshCertificateMetadata, String> {
    let mut kind = None;
    let mut key = None;
    let mut ca = None;
    let mut serial = None;
    let mut validity = None;
    let mut principals = Vec::new();
    let mut in_principals = false;
    let mut principal_indent = 0;
    for line in text.lines() {
        if line.len() > 1024 || line.chars().any(|c| c.is_control() && c != '\t') {
            return Err("Unsupported certificate metadata".into());
        }
        let value = line.trim();
        let indentation = line.len() - line.trim_start().len();
        if in_principals {
            if indentation > principal_indent {
                if value != "(none)" {
                    if value.is_empty() || value.len() > 256 || principals.len() >= 128 {
                        return Err("Certificate principal list exceeds limits".into());
                    }
                    principals.push(value.to_string());
                }
                continue;
            }
            // OpenSSH also prints section headers with inline values, e.g.
            // `Critical Options: (none)`. Only deeper-indented entries belong
            // to Principals; a same-level section always terminates that list.
            in_principals = false;
        }
        if let Some(value) = value.strip_prefix("Type: ") {
            let suffix = if value.ends_with(" user certificate") {
                "user"
            } else if value.ends_with(" host certificate") {
                "host"
            } else {
                return Err("Unsupported certificate type".into());
            };
            kind = Some(suffix.to_string());
            in_principals = false;
        } else if let Some(value) = value.strip_prefix("Public key: ") {
            key = fingerprint(value);
            in_principals = false;
        } else if let Some(value) = value.strip_prefix("Signing CA: ") {
            ca = fingerprint(value);
            in_principals = false;
        } else if let Some(value) = value.strip_prefix("Serial: ") {
            value
                .parse::<u64>()
                .map_err(|_| "Invalid certificate serial")?;
            serial = Some(value.to_string());
            in_principals = false;
        } else if let Some(value) = value.strip_prefix("Valid: ") {
            if value.is_empty() || value.len() > 160 || !value.is_ascii() {
                return Err("Unsupported certificate validity".into());
            }
            validity = Some(value.to_string());
            in_principals = false;
        } else if value == "Principals:" {
            in_principals = true;
            principal_indent = indentation;
        } else if value.ends_with(':') || value.starts_with("Key ID:") {
            in_principals = false;
        }
    }
    Ok(SshCertificateMetadata {
        certificate_type: kind.ok_or("Missing certificate type")?,
        fingerprint: key.ok_or("Missing certificate fingerprint")?,
        signing_ca_fingerprint: ca,
        serial: serial.ok_or("Missing certificate serial")?,
        validity: validity.ok_or("Missing certificate validity")?,
        principals,
    })
}

#[tauri::command(async)]
pub fn ssh_certificate_inspect(reference: String) -> Result<SshCertificateMetadata, String> {
    let snapshot = public_snapshot(&reference)?;
    let mut command = Command::new(if cfg!(windows) {
        "ssh-keygen.exe"
    } else {
        "ssh-keygen"
    });
    command
        .args(["-L", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("SSH_ASKPASS_REQUIRE", "never");
    #[cfg(windows)]
    let spawned = crate::windows::spawn_managed(&mut command);
    #[cfg(not(windows))]
    let spawned = command.spawn();
    let mut child = spawned.map_err(|_| "OpenSSH certificate inspector unavailable")?;
    let mut input = child
        .stdin
        .take()
        .ok_or("Certificate inspector input unavailable")?;
    let output = child
        .stdout
        .take()
        .ok_or("Certificate inspector output unavailable")?;
    let writer = std::thread::spawn(move || input.write_all(&snapshot));
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .take(MAX_OUTPUT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let wrote = writer
        .join()
        .map_err(|_| "Certificate inspector input failed")?;
    let bytes = reader
        .join()
        .map_err(|_| "Certificate inspector output failed")?
        .map_err(|_| "Cannot read certificate metadata")?;
    if status.is_none() {
        return Err("Certificate inspection timed out".into());
    }
    if !status.unwrap().success() || wrote.is_err() {
        return Err("Invalid or unsupported public SSH certificate".into());
    }
    if bytes.len() > MAX_OUTPUT as usize {
        return Err("Certificate metadata exceeds limits".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid certificate metadata encoding")?;
    parse_metadata(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "manual disposable public certificate fixture; never owner credentials"]
    fn actual_public_certificate_inspection_and_rejection() {
        let reference = std::env::var("BYCODA_TEST_PUBLIC_CERT_FILE")
            .expect("Set disposable public certificate fixture");
        let metadata = ssh_certificate_inspect(reference).unwrap();
        assert_eq!(metadata.certificate_type, "user");
        assert_eq!(
            metadata.serial,
            std::env::var("BYCODA_TEST_CERT_SERIAL").unwrap_or_else(|_| "42".into())
        );
        assert_eq!(
            metadata.principals,
            vec![std::env::var("BYCODA_TEST_CERT_PRINCIPAL")
                .unwrap_or_else(|_| "bycoda-fixture".into())]
        );
        assert!(metadata.fingerprint.starts_with("SHA256:"));
        assert!(metadata
            .signing_ca_fingerprint
            .as_ref()
            .is_some_and(|value| value.starts_with("SHA256:")));
        let serialized = serde_json::to_string(&metadata).unwrap();
        for excluded in ["keyId", "comment", "raw", "reference"] {
            assert!(!serialized.contains(excluded));
        }
        for name in [
            "BYCODA_TEST_CERT_PRIVATE_FILE",
            "BYCODA_TEST_CERT_ORDINARY_PUBLIC_FILE",
            "BYCODA_TEST_CERT_MALFORMED_FILE",
        ] {
            if let Ok(reference) = std::env::var(name) {
                assert!(ssh_certificate_inspect(reference).is_err());
            }
        }
    }
    #[test]
    fn safe_projection_excludes_key_id_comment_and_extensions() {
        let parsed = parse_metadata("(stdin):\n Type: ssh-ed25519-cert-v01@openssh.com user certificate\n Public key: ED25519-CERT SHA256:abc123\n Signing CA: ED25519 SHA256:ca123 (using ssh-ed25519)\n Key ID: \"do-not-expose\"\n Serial: 42\n Valid: forever\n Principals:\n  alice\n Critical Options:\n  source-address private-option\n Extensions:\n  permit-pty\n").unwrap();
        assert_eq!(parsed.principals, vec!["alice"]);
        assert_eq!(parsed.certificate_type, "user");
        assert!(!serde_json::to_string(&parsed)
            .unwrap()
            .contains("do-not-expose"));
    }
    #[test]
    fn malformed_or_oversized_metadata_is_rejected() {
        assert!(parse_metadata("Public key: comment\nSerial: not-a-number").is_err());
        assert!(parse_metadata(&"X".repeat(1025)).is_err());
        assert!(parse_metadata("Type: bad\u{1b}value").is_err());
    }
    #[test]
    fn inline_sections_are_never_principals() {
        let prefix = "(stdin):\n    Type: ssh-ed25519-cert-v01@openssh.com user certificate\n    Public key: ED25519-CERT SHA256:abc123\n    Serial: 42\n    Valid: forever\n";
        for suffix in [
            "    Principals:\n        fixture-user\n    Critical Options: (none)\n    Extensions:\n        permit-pty\n",
            "    Principals:\n        fixture-user\n    Extensions: (none)\n",
        ] {
            assert_eq!(parse_metadata(&format!("{prefix}{suffix}")).unwrap().principals, vec!["fixture-user"]);
        }
        assert!(parse_metadata(&format!("{prefix}    Principals: (none)\n    Critical Options: (none)\n    Extensions: (none)\n")).unwrap().principals.is_empty());
    }
    #[test]
    fn snapshot_rejects_private_and_ordinary_keys_and_excludes_trailing_data() {
        let path =
            std::env::temp_dir().join(format!("bycoda-public-cert-{}", uuid::Uuid::new_v4()));
        for text in [
            "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-read",
            "ssh-ed25519 AAAA comment",
        ] {
            std::fs::write(&path, text).unwrap();
            assert!(public_snapshot(path.to_str().unwrap()).is_err());
        }
        let algorithm = "ssh-ed25519-cert-v01@openssh.com";
        let mut wire = (algorithm.len() as u32).to_be_bytes().to_vec();
        wire.extend_from_slice(algorithm.as_bytes());
        let encoded = base64::engine::general_purpose::STANDARD.encode(wire);
        std::fs::write(
            &path,
            format!("{algorithm} {encoded} excluded-comment\nexcluded-next-line"),
        )
        .unwrap();
        assert_eq!(
            public_snapshot(path.to_str().unwrap()).unwrap(),
            format!("{algorithm} {encoded}\n").as_bytes()
        );
        std::fs::remove_file(path).unwrap();
    }
}
