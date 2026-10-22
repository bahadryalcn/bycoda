//! Canonical personal SSH group defaults in the existing application SQLite DB.
//! No connection copies, process launch, filesystem store or environment mutation.
use crate::ssh_security::SshEndpoint;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

const MAX_GROUPS: usize = 256;
const MAX_RECORD_BYTES: usize = 32 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectionDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate_file: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LiteralEnvironment {
    pub name: String,
    pub value: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RemoteShellKind {
    Posix,
    Powershell,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GroupDefaults {
    pub id: String,
    pub revision: u64,
    pub name: String,
    #[serde(default)]
    pub defaults: ConnectionDefaults,
    #[serde(default)]
    pub environment: Vec<LiteralEnvironment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_kind: Option<RemoteShellKind>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InheritedField {
    User,
    Port,
    IdentityFile,
    CertificateFile,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Inheritance {
    pub group_id: String,
    pub fields: Vec<InheritedField>,
    #[serde(default)]
    pub environment: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "camelCase")]
pub(crate) enum Provenance {
    Connection,
    Default,
    Group {
        #[serde(rename = "groupId")]
        group_id: String,
        revision: u64,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Effective {
    pub endpoint: SshEndpoint,
    pub provenance: BTreeMap<String, Provenance>,
    pub environment: Vec<LiteralEnvironment>,
    pub shell_kind: Option<RemoteShellKind>,
    pub digest: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}
fn contains_private_material(value: &str) -> bool {
    value.contains("-----BEGIN") || value.contains("-----END")
}
pub(crate) fn validate_environment(
    environment: &[LiteralEnvironment],
    shell: Option<RemoteShellKind>,
) -> Result<(), String> {
    if environment.len() > 32 || (!environment.is_empty() && shell.is_none()) {
        return Err(
            "Use at most 32 literal environment values and select their remote shell type".into(),
        );
    }
    let mut seen = HashSet::new();
    let mut total = 0usize;
    for entry in environment {
        let bytes = entry.name.as_bytes();
        if bytes.is_empty()
            || bytes.len() > 128
            || !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_')
            || !bytes
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        {
            return Err("Invalid remote environment variable name".into());
        }
        let upper = entry.name.to_ascii_uppercase();
        // Preserve the selected shell's variable-name semantics. Windows
        // PowerShell cannot keep differently-cased names as separate values.
        let identity = if shell == Some(RemoteShellKind::Powershell) {
            upper.clone()
        } else {
            entry.name.clone()
        };
        if !seen.insert(identity) {
            return Err("Duplicate remote environment variable".into());
        }
        let sensitive = [
            "TOKEN",
            "PASSWORD",
            "PASSPHRASE",
            "SECRET",
            "CREDENTIAL",
            "PRIVATE_KEY",
            "API_KEY",
            "ACCESS_KEY",
            "AUTHORIZATION",
        ]
        .iter()
        .any(|word| upper.contains(word));
        let reserved = matches!(
            upper.as_str(),
            "PATH"
                | "HOME"
                | "USER"
                | "LOGNAME"
                | "SHELL"
                | "ENV"
                | "BASH_ENV"
                | "SHELLOPTS"
                | "BASHOPTS"
                | "ZDOTDIR"
                | "FPATH"
                | "CDPATH"
                | "IFS"
                | "PS1"
                | "PS2"
                | "PS4"
                | "PROMPT_COMMAND"
                | "PROMPT"
                | "COMSPEC"
                | "PATHEXT"
                | "SYSTEMROOT"
                | "WINDIR"
                | "PSMODULEPATH"
                | "NODE_OPTIONS"
                | "NODE_PATH"
                | "NODE_EXTRA_CA_CERTS"
                | "NODE_TLS_REJECT_UNAUTHORIZED"
                | "PYTHONPATH"
                | "PYTHONHOME"
                | "PYTHONSTARTUP"
                | "RUBYOPT"
                | "RUBYLIB"
                | "PERL5OPT"
                | "PERL5LIB"
                | "JAVA_TOOL_OPTIONS"
                | "_JAVA_OPTIONS"
                | "JDK_JAVA_OPTIONS"
                | "CLASSPATH"
                | "DOTNET_STARTUP_HOOKS"
                | "DOTNET_ADDITIONAL_DEPS"
                | "DOTNET_SHARED_STORE"
                | "SSL_CERT_FILE"
                | "SSL_CERT_DIR"
                | "GIT_SSL_NO_VERIFY"
                | "GIT_EXEC_PATH"
                | "GIT_TEMPLATE_DIR"
        ) || [
            "LD_",
            "DYLD_",
            "SSH_",
            "BYCODA_",
            "BASH_FUNC_",
            "GIT_CONFIG_",
            "GIT_SSH",
        ]
        .iter()
        .any(|prefix| upper.starts_with(prefix));
        if sensitive || reserved {
            return Err("Secret, loader and shell bootstrap environment values require a separate reviewed capability".into());
        }
        if entry.value.len() > 4096
            || entry
                .value
                .chars()
                .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
            || contains_private_material(&entry.value)
        {
            return Err("Invalid literal remote environment value".into());
        }
        if url::Url::parse(&entry.value)
            .ok()
            .is_some_and(|url| !url.username().is_empty() || url.password().is_some())
        {
            return Err("Credentials cannot be stored in a literal environment URL".into());
        }
        total = total
            .checked_add(entry.name.len() + entry.value.len())
            .ok_or("Remote environment exceeds its size limit")?;
        if total > 16 * 1024 {
            return Err("Remote environment exceeds its 16 KiB limit".into());
        }
    }
    Ok(())
}
pub(crate) fn validate(group: &GroupDefaults) -> Result<(), String> {
    if !valid_id(&group.id)
        || group.name.trim().is_empty()
        || group.name.len() > 200
        || group.name.chars().any(char::is_control)
        || group.revision > i64::MAX as u64
    {
        return Err("Invalid SSH group identity, name or revision".into());
    }
    if group
        .defaults
        .user
        .as_ref()
        .is_some_and(|user| user.len() > 128)
        || [
            &group.defaults.identity_file,
            &group.defaults.certificate_file,
        ]
        .into_iter()
        .flatten()
        .any(|value| contains_private_material(value))
    {
        return Err("Group defaults accept public SSH references only".into());
    }
    for reference in [
        &group.defaults.identity_file,
        &group.defaults.certificate_file,
    ]
    .into_iter()
    .flatten()
    {
        let home = reference
            .strip_prefix("~/")
            .or_else(|| reference.strip_prefix("~\\"));
        let valid = match home {
            Some(tail) => !tail.is_empty() && !tail.starts_with(['/', '\\']),
            None => std::path::Path::new(reference).is_absolute(),
        };
        if !valid {
            return Err("Use absolute or ~/ group key and certificate file references".into());
        }
    }
    let endpoint = SshEndpoint {
        host: "validation.invalid".into(),
        user: group.defaults.user.clone(),
        port: group.defaults.port.unwrap_or(22),
        identity_file: group.defaults.identity_file.clone(),
        certificate_file: group.defaults.certificate_file.clone(),
        ..Default::default()
    };
    crate::ssh_security::validate_endpoint(&endpoint)?;
    validate_environment(&group.environment, group.shell_kind)?;
    if serde_json::to_vec(group)
        .map_err(|_| "Invalid SSH group")?
        .len()
        > MAX_RECORD_BYTES
    {
        return Err("SSH group configuration is too large".into());
    }
    Ok(())
}

pub(crate) fn migrate(connection: &Connection) -> Result<(), String> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS ssh_group_defaults (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), value TEXT NOT NULL);").map_err(|error| error.to_string())
}
fn decode_row(id: String, revision: i64, value: Option<String>) -> Result<GroupDefaults, String> {
    let value = value.ok_or("Saved SSH group exceeds its size limit")?;
    let group: GroupDefaults =
        serde_json::from_str(&value).map_err(|_| "Invalid saved SSH group configuration")?;
    if revision <= 0 || group.id != id || group.revision != revision as u64 {
        return Err("Saved SSH group identity or revision is inconsistent".into());
    }
    validate(&group)?;
    Ok(group)
}
pub(crate) fn list(connection: &Connection) -> Result<Vec<GroupDefaults>, String> {
    let mut statement=connection.prepare("SELECT id,revision,CASE WHEN length(CAST(value AS BLOB))<=?1 THEN value ELSE NULL END FROM ssh_group_defaults ORDER BY id LIMIT ?2").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![MAX_RECORD_BYTES as i64, (MAX_GROUPS + 1) as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let mut groups = Vec::new();
    for row in rows {
        let (id, revision, value) = row.map_err(|error| error.to_string())?;
        groups.push(decode_row(id, revision, value)?);
    }
    if groups.len() > MAX_GROUPS {
        return Err("Too many SSH groups".into());
    }
    Ok(groups)
}
pub(crate) fn get(connection: &Connection, id: &str) -> Result<Option<GroupDefaults>, String> {
    if !valid_id(id) {
        return Err("Invalid SSH group ID".into());
    }
    let row=connection.query_row("SELECT revision,CASE WHEN length(CAST(value AS BLOB))<=?2 THEN value ELSE NULL END FROM ssh_group_defaults WHERE id=?1",params![id,MAX_RECORD_BYTES as i64],|row| Ok((row.get::<_,i64>(0)?,row.get::<_,Option<String>>(1)?))).optional().map_err(|error| error.to_string())?;
    row.map(|(revision, value)| decode_row(id.to_string(), revision, value))
        .transpose()
}
pub(crate) fn save_cas(
    connection: &Connection,
    value: &GroupDefaults,
    expected_revision: Option<u64>,
) -> Result<GroupDefaults, String> {
    validate(value)?;
    let expected = expected_revision.unwrap_or(0);
    if value.revision != expected || expected >= i64::MAX as u64 || expected_revision == Some(0) {
        return Err("SSH group changed; reload it before saving".into());
    }
    let mut saved = value.clone();
    saved.name = saved.name.trim().to_string();
    saved.revision = expected + 1;
    saved
        .environment
        .sort_by(|left, right| left.name.cmp(&right.name));
    let json = serde_json::to_string(&saved).map_err(|_| "Invalid SSH group")?;
    let count=if let Some(expected)=expected_revision {
        connection.execute("UPDATE ssh_group_defaults SET revision=?2,value=?3 WHERE id=?1 AND revision=?4",params![saved.id,saved.revision as i64,json,expected as i64])
    } else {
        connection.execute("INSERT INTO ssh_group_defaults(id,revision,value) SELECT ?1,?2,?3 WHERE (SELECT count(*) FROM ssh_group_defaults)<?4 ON CONFLICT(id) DO NOTHING",params![saved.id,saved.revision as i64,json,MAX_GROUPS as i64])
    }.map_err(|error| error.to_string())?;
    if count != 1 {
        return Err("SSH group changed or its collection is full; reload before saving".into());
    }
    Ok(saved)
}
pub(crate) fn delete_cas(
    connection: &Connection,
    id: &str,
    expected_revision: u64,
) -> Result<(), String> {
    if !valid_id(id) || expected_revision == 0 || expected_revision > i64::MAX as u64 {
        return Err("Invalid SSH group ID or revision".into());
    }
    if connection
        .execute(
            "DELETE FROM ssh_group_defaults WHERE id=?1 AND revision=?2",
            params![id, expected_revision as i64],
        )
        .map_err(|error| error.to_string())?
        != 1
    {
        return Err("SSH group changed; reload it before deleting".into());
    }
    Ok(())
}

pub(crate) fn resolve(
    base: &SshEndpoint,
    selection: Option<&Inheritance>,
    group: Option<&GroupDefaults>,
) -> Result<Effective, String> {
    crate::ssh_security::validate_endpoint(base)?;
    let mut endpoint = base.clone();
    let mut environment = Vec::new();
    let mut shell_kind = None;
    let mut provenance = BTreeMap::from([
        (
            "user".to_string(),
            if base.user.is_some() {
                Provenance::Connection
            } else {
                Provenance::Default
            },
        ),
        ("port".to_string(), Provenance::Connection),
        (
            "identityFile".to_string(),
            if base.identity_file.is_some() {
                Provenance::Connection
            } else {
                Provenance::Default
            },
        ),
        (
            "certificateFile".to_string(),
            if base.certificate_file.is_some() {
                Provenance::Connection
            } else {
                Provenance::Default
            },
        ),
        ("environment".to_string(), Provenance::Default),
        ("shellKind".to_string(), Provenance::Default),
    ]);
    let mut group_identity = None;
    if let Some(selection) = selection {
        if !valid_id(&selection.group_id)
            || selection.fields.len() > 4
            || selection
                .fields
                .iter()
                .copied()
                .collect::<HashSet<_>>()
                .len()
                != selection.fields.len()
        {
            return Err("Invalid SSH group inheritance selection".into());
        }
        let group = group
            .filter(|group| group.id == selection.group_id && group.revision > 0)
            .ok_or("Selected SSH group no longer exists; review inheritance before connecting")?;
        validate(group)?;
        group_identity = Some((&group.id, group.revision));
        let source = Provenance::Group {
            group_id: group.id.clone(),
            revision: group.revision,
        };
        for field in &selection.fields {
            let name = match field {
                InheritedField::User => {
                    endpoint.user = Some(
                        group
                            .defaults
                            .user
                            .clone()
                            .ok_or("Selected group has no username default")?,
                    );
                    "user"
                }
                InheritedField::Port => {
                    endpoint.port = group
                        .defaults
                        .port
                        .ok_or("Selected group has no SSH port default")?;
                    "port"
                }
                InheritedField::IdentityFile => {
                    endpoint.identity_file = Some(
                        group
                            .defaults
                            .identity_file
                            .clone()
                            .ok_or("Selected group has no key reference default")?,
                    );
                    "identityFile"
                }
                InheritedField::CertificateFile => {
                    endpoint.certificate_file = Some(
                        group
                            .defaults
                            .certificate_file
                            .clone()
                            .ok_or("Selected group has no certificate reference default")?,
                    );
                    "certificateFile"
                }
            };
            provenance.insert(name.to_string(), source.clone());
        }
        if selection.environment {
            environment = group.environment.clone();
            environment.sort_by(|left, right| left.name.cmp(&right.name));
            shell_kind = group.shell_kind;
            provenance.insert("environment".into(), source.clone());
            provenance.insert(
                "shellKind".into(),
                if shell_kind.is_some() {
                    source
                } else {
                    Provenance::Default
                },
            );
        }
    }
    crate::ssh_security::validate_endpoint(&endpoint)?;
    let bytes = serde_json::to_vec(&(
        &endpoint,
        &environment,
        &shell_kind,
        &provenance,
        group_identity,
    ))
    .map_err(|_| "Could not bind effective SSH configuration")?;
    let digest = format!("{:x}", Sha256::digest(bytes));
    Ok(Effective {
        endpoint,
        provenance,
        environment,
        shell_kind,
        digest,
    })
}

#[cfg(test)]
#[path = "ssh_group_defaults_tests.rs"]
mod tests;
