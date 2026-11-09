use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Provider-owned secret fields (password, bot token, OAuth tokens). Never sent to the UI.
pub(crate) type Secret = Map<String, Value>;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Email,
    Slack,
    Discord,
    Teams,
}

/// Stored, non-secret account record.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    pub identity: String,
    pub config: Value,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    pub identity: String,
    pub config: Value,
    pub connected: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveAccountInput {
    pub id: Option<String>,
    pub provider: Provider,
    pub label: Option<String>,
    #[serde(default)]
    pub config: Value,
    pub secret: Option<Secret>,
    pub auth_handle: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub account_id: String,
    pub provider: Provider,
    pub title: String,
    pub participants: Vec<String>,
    pub preview: String,
    /// Milliseconds since the Unix epoch.
    pub updated_at: u64,
    pub unread: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_address: Option<String>,
    /// Plain text only; HTML bodies are converted before they leave the provider.
    pub body: String,
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    pub outbound: bool,
    pub attachments: Vec<Attachment>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub handle: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DevicePoll {
    /// "pending" | "done" | "expired" | "denied"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}
