//! Native-only selected-profile Host bootstrap. No credential crosses a Tauri
//! command, renderer, argv or environment. Association metadata is not authority.
#![allow(dead_code)] // Application runtime composition is in the next module.

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_RECORD: usize = 8192;
const MAX_BODY: usize = 8192;
const BOOTSTRAP_PATH: &str = "/native-authority/bootstrap";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BootstrapError {
    Unavailable,
    ChangedHost,
    InvalidResponse,
    BodyTooLarge,
}
impl std::fmt::Display for BootstrapError {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "NATIVE_AUTHORITY_BOOTSTRAP_{self:?}")
    }
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Credentials {
    pid: u32,
    port: u16,
    secret: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProvisioningLauncher {
    pub node_executable: String,
    pub entry_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Description {
    version: u8,
    pub environment_id: String,
    qualified: bool,
    #[serde(default)]
    pub source_registration_available: bool,
    #[serde(default)]
    pub provisioning_launcher: Option<ProvisioningLauncher>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Association {
    version: u8,
    pub association_id: String,
    pub source_epoch: String,
    pub environment_id: String,
    pub source_store_id: String,
    pub source_profile_id: String,
    pub writer_protocol: u64,
    qualified: bool,
}
impl Association {
    fn validate(&self, environment: &str) -> Result<(), BootstrapError> {
        if self.version != 1
            || self.qualified
            || self.environment_id != environment
            || !uuid(&self.association_id)
            || !uuid(&self.source_epoch)
            || !identifier(&self.source_store_id)
            || !identifier(&self.source_profile_id)
            || self.writer_protocol != crate::session_store::authority::WRITER_PROTOCOL
        {
            return Err(BootstrapError::InvalidResponse);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Lookup {
    Pending {
        version: u8,
        qualified: bool,
    },
    Absent {
        version: u8,
        qualified: bool,
    },
    Failed {
        version: u8,
        qualified: bool,
    },
    Associated {
        version: u8,
        qualified: bool,
        association: Association,
    },
}

pub(crate) struct HostBootstrap {
    base: PathBuf,
    credentials: Credentials,
    pub description: Description,
}
impl HostBootstrap {
    /// `base` is selected by native application configuration, never RPC routing.
    pub(crate) fn discover(base: &Path) -> Result<Self, BootstrapError> {
        let base = base
            .canonicalize()
            .map_err(|_| BootstrapError::Unavailable)?;
        let credentials = credentials(&base)?;
        let raw = post(&credentials, &json!({"version":1,"action":"describe"}))?;
        let description: Description =
            serde_json::from_slice(&raw).map_err(|_| BootstrapError::InvalidResponse)?;
        if description.version != 1
            || description.qualified
            || !identifier(&description.environment_id)
        {
            return Err(BootstrapError::InvalidResponse);
        }
        if let Some(launcher) = &description.provisioning_launcher {
            if !absolute_file(&launcher.node_executable) || !absolute_file(&launcher.entry_path) {
                return Err(BootstrapError::InvalidResponse);
            }
        }
        let selected = Self {
            base,
            credentials,
            description,
        };
        selected.assert_current()?;
        Ok(selected)
    }
    pub(crate) fn directory(&self) -> &Path {
        &self.base
    }
    /// Native-only selected-profile locator; never exposes its administrative credential.
    pub(crate) fn recovery_endpoint(&self) -> Result<String, BootstrapError> {
        self.assert_current()?;
        Ok(format!("http://127.0.0.1:{}", self.credentials.port))
    }
    pub(crate) fn assert_current(&self) -> Result<(), BootstrapError> {
        if credentials(&self.base)? != self.credentials {
            return Err(BootstrapError::ChangedHost);
        }
        Ok(())
    }
    fn request<T: serde::de::DeserializeOwned>(&self, body: Value) -> Result<T, BootstrapError> {
        self.assert_current()?;
        let raw = post(&self.credentials, &body)?;
        self.assert_current()?;
        serde_json::from_slice(&raw).map_err(|_| BootstrapError::InvalidResponse)
    }
    pub(crate) fn register(
        &self,
        address: &str,
        nonce: &str,
        deployment_id: &str,
    ) -> Result<Association, BootstrapError> {
        if crate::native_authority_pipe::AuthorityPipeAddress::parse_local(address).is_err()
            || !uuid(nonce)
            || !uuid(deployment_id)
        {
            return Err(BootstrapError::InvalidResponse);
        }
        let value: Association = self.request(json!({"version":1,"action":"register-source","address":address,
            "registrationNonce":nonce,"deploymentId":deployment_id,"expectedHostEnvironmentId":self.description.environment_id}))?;
        value.validate(&self.description.environment_id)?;
        Ok(value)
    }
    pub(crate) fn lookup(
        &self,
        nonce: &str,
        deployment_id: &str,
    ) -> Result<Lookup, BootstrapError> {
        if !uuid(nonce) || !uuid(deployment_id) {
            return Err(BootstrapError::InvalidResponse);
        }
        let value: Lookup = self.request(json!({"version":1,"action":"lookup-source","registrationNonce":nonce,
            "deploymentId":deployment_id,"expectedHostEnvironmentId":self.description.environment_id}))?;
        let (version, qualified) = match &value {
            Lookup::Pending { version, qualified }
            | Lookup::Absent { version, qualified }
            | Lookup::Failed { version, qualified } => (*version, *qualified),
            Lookup::Associated {
                version,
                qualified,
                association,
            } => {
                association.validate(&self.description.environment_id)?;
                (*version, *qualified)
            }
        };
        if version != 1 || qualified {
            return Err(BootstrapError::InvalidResponse);
        }
        Ok(value)
    }
    pub(crate) fn status(&self, current: &Association) -> Result<Association, BootstrapError> {
        let value: Association = self.request(json!({"version":1,"action":"source-status",
            "associationId":current.association_id,"sourceEpoch":current.source_epoch}))?;
        value.validate(&self.description.environment_id)?;
        if value.association_id != current.association_id
            || value.source_epoch != current.source_epoch
            || value.source_store_id != current.source_store_id
            || value.source_profile_id != current.source_profile_id
        {
            return Err(BootstrapError::InvalidResponse);
        }
        Ok(value)
    }
    pub(crate) fn unregister(&self, current: &Association) -> Result<(), BootstrapError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Retired {
            version: u8,
            association_id: String,
            source_epoch: String,
            retired: bool,
            qualified: bool,
        }
        let value: Retired = self.request(json!({"version":1,"action":"unregister-source",
            "associationId":current.association_id,"sourceEpoch":current.source_epoch}))?;
        if value.version != 1
            || !value.retired
            || value.qualified
            || value.association_id != current.association_id
            || value.source_epoch != current.source_epoch
        {
            return Err(BootstrapError::InvalidResponse);
        }
        Ok(())
    }
}

fn absolute_file(value: &str) -> bool {
    value.len() <= 4096 && !value.contains('\0') && Path::new(value).is_absolute()
}
fn identifier(value: &str) -> bool {
    crate::native_authority_channel::AuthorityScope::new(value, "bootstrap", "bootstrap", 0).is_ok()
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn credentials(base: &Path) -> Result<Credentials, BootstrapError> {
    let path = base.join("running.json");
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| BootstrapError::Unavailable)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_RECORD as u64
    {
        return Err(BootstrapError::Unavailable);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(BootstrapError::Unavailable);
        }
    }
    let file = std::fs::File::open(path).map_err(|_| BootstrapError::Unavailable)?;
    let mut bytes = Vec::new();
    file.take(MAX_RECORD as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| BootstrapError::Unavailable)?;
    if bytes.len() > MAX_RECORD {
        return Err(BootstrapError::Unavailable);
    }
    let value: Credentials =
        serde_json::from_slice(&bytes).map_err(|_| BootstrapError::Unavailable)?;
    if value.pid == 0
        || value.port == 0
        || !(32..=128).contains(&value.secret.len())
        || !value
            .secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err(BootstrapError::Unavailable);
    }
    Ok(value)
}
fn post(credentials: &Credentials, body: &Value) -> Result<Vec<u8>, BootstrapError> {
    let text = serde_json::to_string(body).map_err(|_| BootstrapError::InvalidResponse)?;
    if text.len() > MAX_BODY {
        return Err(BootstrapError::BodyTooLarge);
    }
    // Local administrative credentials must never follow redirects or proxies.
    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .redirects(0)
        .timeout(Duration::from_secs(10))
        .build();
    let response = agent
        .post(&format!(
            "http://127.0.0.1:{}{BOOTSTRAP_PATH}",
            credentials.port
        ))
        .set("Authorization", &format!("Bearer {}", credentials.secret))
        .set("Content-Type", "application/json")
        .send_string(&text)
        .map_err(|_| BootstrapError::Unavailable)?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| BootstrapError::Unavailable)?;
    if bytes.len() > MAX_BODY {
        return Err(BootstrapError::BodyTooLarge);
    }
    Ok(bytes)
}

#[cfg(test)]
#[path = "native_authority_bootstrap_tests.rs"]
mod tests;

#[cfg(test)]
mod recovery_endpoint_tests {
    use super::*;

    #[test]
    fn selected_recovery_endpoint_revalidates_record_without_exposing_credential() {
        let temporary = std::env::temp_dir().canonicalize().unwrap();
        let base = temporary.join(format!(
            "bycoda-recovery-bootstrap-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&base).unwrap();
        let secret = "isolatedNativeRecoveryFixtureSecret0123456789";
        let record =
            |port| json!({"pid":std::process::id(),"port":port,"secret":secret}).to_string();
        std::fs::write(base.join("running.json"), record(3774)).unwrap();
        let selected = HostBootstrap {
            base: base.clone(),
            credentials: credentials(&base).unwrap(),
            description: serde_json::from_value(
                json!({"version":1,"environmentId":"selected-host","qualified":false}),
            )
            .unwrap(),
        };
        let endpoint = selected.recovery_endpoint().unwrap();
        assert_eq!(endpoint, "http://127.0.0.1:3774");
        assert!(!endpoint.contains(secret));
        std::fs::write(base.join("running.json"), record(3776)).unwrap();
        assert_eq!(
            selected.recovery_endpoint(),
            Err(BootstrapError::ChangedHost)
        );
        assert_eq!(base.parent(), Some(temporary.as_path()));
        assert!(!std::fs::symlink_metadata(&base)
            .unwrap()
            .file_type()
            .is_symlink());
        std::fs::remove_dir_all(base).unwrap();
    }
}
