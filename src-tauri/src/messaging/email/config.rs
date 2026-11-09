//! Email account config: presets, validation and credentials.
use crate::messaging::types::Secret;
use base64::Engine as _;
use serde_json::{json, Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Security {
    Tls,
    StartTls,
}

impl Security {
    fn as_str(self) -> &'static str {
        match self {
            Security::Tls => "tls",
            Security::StartTls => "starttls",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AuthKind {
    Password,
    Microsoft,
    Google,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Server {
    pub host: String,
    pub port: u16,
    pub security: Security,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct EmailConfig {
    pub preset: String,
    pub address: String,
    pub display_name: String,
    pub username: String,
    pub imap: Server,
    pub smtp: Server,
    pub auth: AuthKind,
    pub client_id: Option<String>,
}

struct Preset {
    name: &'static str,
    imap: (&'static str, u16, Security),
    smtp: (&'static str, u16, Security),
    auth: AuthKind,
}

const PRESETS: &[Preset] = &[
    Preset {
        name: "gmail",
        imap: ("imap.gmail.com", 993, Security::Tls),
        smtp: ("smtp.gmail.com", 465, Security::Tls),
        auth: AuthKind::Google,
    },
    Preset {
        name: "outlook",
        imap: ("outlook.office365.com", 993, Security::Tls),
        smtp: ("smtp.office365.com", 587, Security::StartTls),
        auth: AuthKind::Microsoft,
    },
    Preset {
        name: "yahoo",
        imap: ("imap.mail.yahoo.com", 993, Security::Tls),
        smtp: ("smtp.mail.yahoo.com", 465, Security::Tls),
        auth: AuthKind::Password,
    },
    Preset {
        name: "icloud",
        imap: ("imap.mail.me.com", 993, Security::Tls),
        smtp: ("smtp.mail.me.com", 587, Security::StartTls),
        auth: AuthKind::Password,
    },
];

/// Guesses a preset from the address domain when the UI sent none.
fn preset_for_domain(address: &str) -> &'static str {
    let domain = address
        .rsplit('@')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let label = domain.split('.').next().unwrap_or("");
    match label {
        "gmail" | "googlemail" => "gmail",
        "outlook" | "hotmail" | "live" | "msn" => "outlook",
        "yahoo" | "ymail" => "yahoo",
        _ if matches!(domain.as_str(), "icloud.com" | "me.com" | "mac.com") => "icloud",
        _ => "custom",
    }
}

fn text(config: &Value, key: &str) -> Result<Option<String>, String> {
    match config.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let value = value.trim();
            Ok((!value.is_empty()).then(|| value.to_string()))
        }
        Some(_) => Err(format!("The email setting \"{key}\" must be text.")),
    }
}

fn has_control(value: &str) -> bool {
    value.chars().any(char::is_control)
}

pub(super) fn valid_address(address: &str) -> bool {
    let Some((local, domain)) = address.rsplit_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && address.len() <= 254
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !address
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | ',' | ';'))
        && domain
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '[' | ']' | ':'))
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with(['.', '-'])
        && !host.ends_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

fn host(config: &Value, key: &str, label: &str, fallback: Option<&str>) -> Result<String, String> {
    let host = match text(config, key)? {
        Some(host) => host.to_ascii_lowercase(),
        None => match fallback {
            Some(host) => host.to_string(),
            None => return Err(format!("Enter the {label} server.")),
        },
    };
    if !valid_host(&host) {
        return Err(format!(
            "The {label} server must be a host name like mail.example.com, without spaces or https://."
        ));
    }
    Ok(host)
}

fn port(config: &Value, key: &str, label: &str, fallback: Option<u16>) -> Result<u16, String> {
    let invalid = || format!("The {label} port must be a number from 1 to 65535.");
    let parsed = match config.get(key) {
        None | Some(Value::Null) => None,
        Some(Value::Number(number)) => Some(number.as_u64().ok_or_else(invalid)?),
        Some(Value::String(value)) if value.trim().is_empty() => None,
        Some(Value::String(value)) => Some(value.trim().parse::<u64>().map_err(|_| invalid())?),
        Some(_) => return Err(invalid()),
    };
    match parsed {
        Some(value) if (1..=65535).contains(&value) => Ok(value as u16),
        Some(_) => Err(invalid()),
        None => fallback.ok_or_else(|| format!("Enter the {label} port.")),
    }
}

fn security(
    config: &Value,
    key: &str,
    port: u16,
    fallback: Option<Security>,
) -> Result<Security, String> {
    match text(config, key)?
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("tls" | "ssl") => Ok(Security::Tls),
        Some("starttls") => Ok(Security::StartTls),
        Some(_) => Err("Connection security must be TLS or STARTTLS.".into()),
        None => Ok(fallback.unwrap_or(match port {
            993 | 465 => Security::Tls,
            _ => Security::StartTls,
        })),
    }
}

impl EmailConfig {
    /// Validates and trims a UI or stored config, filling preset defaults.
    pub(super) fn parse(config: &Value) -> Result<Self, String> {
        if !config.is_object() {
            return Err("Email settings are missing.".into());
        }
        let address = text(config, "address")?.ok_or("Enter the email address.")?;
        if !valid_address(&address) {
            return Err("Enter a valid email address, like name@example.com.".into());
        }
        let preset_name = match text(config, "preset")? {
            Some(name) => name.to_ascii_lowercase(),
            None => preset_for_domain(&address).to_string(),
        };
        let preset = PRESETS.iter().find(|preset| preset.name == preset_name);
        if preset.is_none() && preset_name != "custom" {
            return Err("Choose Gmail, Outlook, Yahoo, iCloud or Custom.".into());
        }
        let display_name = text(config, "displayName")?.unwrap_or_default();
        if has_control(&display_name) || display_name.chars().count() > 200 {
            return Err("The display name is too long or has invalid characters.".into());
        }
        let username = text(config, "username")?.unwrap_or_else(|| address.clone());
        if has_control(&username) || username.len() > 320 {
            return Err("The user name has invalid characters.".into());
        }
        let imap_host = host(config, "imapHost", "IMAP", preset.map(|p| p.imap.0))?;
        let imap_port = port(config, "imapPort", "IMAP", preset.map(|p| p.imap.1))?;
        let imap_security = security(config, "imapSecurity", imap_port, preset.map(|p| p.imap.2))?;
        let smtp_host = host(config, "smtpHost", "SMTP", preset.map(|p| p.smtp.0))?;
        let smtp_port = port(config, "smtpPort", "SMTP", preset.map(|p| p.smtp.1))?;
        let smtp_security = security(config, "smtpSecurity", smtp_port, preset.map(|p| p.smtp.2))?;
        let auth = match text(config, "auth")?
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("password") => AuthKind::Password,
            Some("microsoft") => AuthKind::Microsoft,
            Some("google") => AuthKind::Google,
            Some(_) => return Err("Sign-in must be a password, Google or Microsoft.".into()),
            None => preset.map(|p| p.auth).unwrap_or(AuthKind::Password),
        };
        if auth == AuthKind::Microsoft && !matches!(preset_name.as_str(), "outlook" | "custom") {
            return Err(
                "Microsoft sign-in works only with Outlook or custom Microsoft 365 accounts."
                    .into(),
            );
        }
        if auth == AuthKind::Google && !matches!(preset_name.as_str(), "gmail" | "custom") {
            return Err(
                "Google sign-in works only with Gmail or custom Google Workspace accounts.".into(),
            );
        }
        let client_id = text(config, "clientId")?;
        if let Some(id) = &client_id {
            let allowed = |c: char| {
                c.is_ascii_alphanumeric()
                    || c == '-'
                    || (auth == AuthKind::Google && matches!(c, '.' | '_'))
            };
            if id.len() > 200 || !id.chars().all(allowed) {
                return Err(if auth == AuthKind::Google {
                    "The Google client ID is not valid.".into()
                } else {
                    "The Microsoft client ID must be an application (client) ID.".into()
                });
            }
        }
        Ok(Self {
            preset: preset_name,
            address,
            display_name,
            username,
            imap: Server {
                host: imap_host,
                port: imap_port,
                security: imap_security,
            },
            smtp: Server {
                host: smtp_host,
                port: smtp_port,
                security: smtp_security,
            },
            auth,
            client_id,
        })
    }

    pub(super) fn to_value(&self) -> Value {
        let mut value = json!({
            "preset": self.preset,
            "address": self.address,
            "displayName": self.display_name,
            "username": self.username,
            "imapHost": self.imap.host,
            "imapPort": self.imap.port,
            "imapSecurity": self.imap.security.as_str(),
            "smtpHost": self.smtp.host,
            "smtpPort": self.smtp.port,
            "smtpSecurity": self.smtp.security.as_str(),
            "auth": match self.auth {
                AuthKind::Password => "password",
                AuthKind::Microsoft => "microsoft",
                AuthKind::Google => "google",
            },
        });
        if let (Some(id), Some(object)) = (&self.client_id, value.as_object_mut()) {
            object.insert("clientId".into(), Value::String(id.clone()));
        }
        value
    }

    /// Provider-specific hint appended to sign-in failures.
    pub(super) fn sign_in_hint(&self) -> &'static str {
        match (self.preset.as_str(), self.auth) {
            (_, AuthKind::Microsoft) => " Sign in with Microsoft again.",
            (_, AuthKind::Google) => " Sign in with Google again.",
            ("gmail", _) => " Gmail needs an app password (Google Account > Security > App passwords) and IMAP enabled.",
            ("yahoo", _) => " Yahoo needs an app password from Account security.",
            ("icloud", _) => " iCloud needs an app-specific password from appleid.apple.com.",
            ("outlook", _) => " Outlook accounts usually need Microsoft sign-in instead of a password.",
            _ => " Check the user name and password.",
        }
    }
}

/// Sign-in material for one connection. Deliberately not `Debug`: it holds secrets.
pub(super) enum Credential {
    Password { user: String, password: String },
    OAuth { user: String, token: String },
}

impl Credential {
    pub(super) fn load(config: &EmailConfig, secret: &mut Secret) -> Result<Self, String> {
        let user = config.username.clone();
        match config.auth {
            AuthKind::Password => {
                let password = password(secret).ok_or("Enter the password or app password.")?;
                Ok(Credential::Password { user, password })
            }
            AuthKind::Microsoft => {
                if !secret.contains_key("microsoft") {
                    return Err("Sign in with Microsoft to connect this account.".into());
                }
                let token = crate::messaging::microsoft::access_token(secret)?;
                Ok(Credential::OAuth { user, token })
            }
            AuthKind::Google => {
                let purpose = crate::messaging::oauth::Purpose::Google;
                if !secret.contains_key(purpose.secret_key()) {
                    return Err("Sign in with Google to connect this account.".into());
                }
                let token = crate::messaging::oauth::access_token(purpose, secret)?;
                Ok(Credential::OAuth { user, token })
            }
        }
    }
}

fn password(secret: &Map<String, Value>) -> Option<String> {
    secret
        .get("password")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// SASL XOAUTH2 initial response, base64 encoded.
pub(super) fn xoauth2(user: &str, token: &str) -> String {
    base64::engine::general_purpose::STANDARD
        .encode(format!("user={user}\x01auth=Bearer {token}\x01\x01"))
}

/// SASL PLAIN initial response, base64 encoded.
pub(super) fn sasl_plain(user: &str, password: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(format!("\0{user}\0{password}"))
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
