//! Account endpoints and the public OAuth client. Nothing here is secret: the desktop
//! client is a public PKCE client, but no deployment value is hard-coded in the source. The
//! build supplies them with `option_env!`; a build without them has no account
//! (`not_configured`) and the app runs as a guest. Per environment: production
//! `BYCODA_CLERK_ISSUER`, `BYCODA_CLERK_CLIENT_ID`, `BYCODA_ACCOUNT_API_URL`; staging the same
//! names with a `BYCODA_STAGING_` prefix. `BYCODA_ACCOUNT_ENV=staging` selects staging. Debug
//! builds let a runtime variable of the same name win; a release build reads only the selector
//! at runtime.
use super::error::AccountError;
use serde::Serialize;

pub(crate) const SCOPES: &str = "profile email offline_access";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Config {
    pub api_base_url: String,
    pub issuer: String,
    /// Always set once configured; kept optional for `require_client_id` callers.
    pub client_id: Option<String>,
    pub environment: Environment,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Environment {
    Production,
    Staging,
}

/// Compile-time values of one environment; `None` when the build did not set them.
#[derive(Default, Clone, Copy)]
pub(crate) struct EnvValues {
    pub api_url: Option<&'static str>,
    pub issuer: Option<&'static str>,
    pub client_id: Option<&'static str>,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct Compiled {
    pub environment: Option<&'static str>,
    pub production: EnvValues,
    pub staging: EnvValues,
}

pub(crate) const COMPILED: Compiled = Compiled {
    environment: option_env!("BYCODA_ACCOUNT_ENV"),
    production: EnvValues {
        api_url: option_env!("BYCODA_ACCOUNT_API_URL"),
        issuer: option_env!("BYCODA_CLERK_ISSUER"),
        client_id: option_env!("BYCODA_CLERK_CLIENT_ID"),
    },
    staging: EnvValues {
        api_url: option_env!("BYCODA_STAGING_ACCOUNT_API_URL"),
        issuer: option_env!("BYCODA_STAGING_CLERK_ISSUER"),
        client_id: option_env!("BYCODA_STAGING_CLERK_CLIENT_ID"),
    },
};

fn pick(
    get: &impl Fn(&str) -> Option<String>,
    name: &str,
    compiled: Option<&'static str>,
) -> Option<String> {
    get(name)
        .or_else(|| compiled.map(str::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// HTTPS only, or plain HTTP to a loopback host for local development.
pub(crate) fn valid_origin(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    let allowed = url.scheme() == "https" || (url.scheme() == "http" && loopback);
    (allowed && url.host_str().is_some() && url.query().is_none() && url.fragment().is_none())
        .then(|| value.trim_end_matches('/').to_string())
}

pub(crate) fn resolve_from(
    get: impl Fn(&str) -> Option<String>,
    compiled: Compiled,
    debug: bool,
) -> Result<Config, AccountError> {
    // Release builds read only the environment selector at runtime.
    let release_get = |name: &str| get(name).filter(|_| debug || name == "BYCODA_ACCOUNT_ENV");
    let get = &release_get;
    let environment = match pick(get, "BYCODA_ACCOUNT_ENV", compiled.environment).as_deref() {
        Some("staging") => Environment::Staging,
        _ => Environment::Production,
    };
    let (values, api_name, issuer_name, client_name) = match environment {
        Environment::Production => (
            compiled.production,
            "BYCODA_ACCOUNT_API_URL",
            "BYCODA_CLERK_ISSUER",
            "BYCODA_CLERK_CLIENT_ID",
        ),
        Environment::Staging => (
            compiled.staging,
            "BYCODA_STAGING_ACCOUNT_API_URL",
            "BYCODA_STAGING_CLERK_ISSUER",
            "BYCODA_STAGING_CLERK_CLIENT_ID",
        ),
    };
    let origin = |name: &str, compiled| pick(get, name, compiled).and_then(|v| valid_origin(&v));
    let (Some(api_base_url), Some(issuer), Some(client_id)) = (
        origin(api_name, values.api_url),
        origin(issuer_name, values.issuer),
        pick(get, client_name, values.client_id)
            .filter(|id| id.len() <= 200 && id.chars().all(|c| c.is_ascii_graphic())),
    ) else {
        return Err(AccountError::not_configured());
    };
    Ok(Config {
        api_base_url,
        issuer,
        client_id: Some(client_id),
        environment,
    })
}

pub(crate) fn resolve() -> Result<Config, AccountError> {
    resolve_from(
        |name| std::env::var(name).ok(),
        COMPILED,
        cfg!(debug_assertions),
    )
}

impl Config {
    pub(crate) fn require_client_id(&self) -> Result<&str, AccountError> {
        self.client_id
            .as_deref()
            .ok_or_else(AccountError::not_configured)
    }

    /// Keychain account name; staging and production never share a token.
    pub(crate) fn keychain_account(&self) -> String {
        format!("refresh-token:{}", self.issuer)
    }
}
