//! OAuth endpoints of the account provider: discovery, authorize URL, code exchange,
//! refresh and revocation. Parsing is pure so refresh error mapping is unit tested.
use super::config::{valid_origin, Config, SCOPES};
use crate::integrations::http::agent;
use serde_json::Value;
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Endpoints {
    pub authorization: String,
    pub token: String,
    pub revocation: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TokenSet {
    pub access_token: String,
    /// Absent when the provider keeps the previous refresh token.
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum TokenError {
    /// The grant, code or refresh token is no longer valid.
    InvalidGrant,
    /// No response: offline, DNS, TLS or timeout.
    Network,
    /// The service answered with an error that does not end the session.
    Failed(String),
}

/// Everything the session needs from the provider; replaced by a fake in tests.
pub(crate) trait TokenBackend: Send + Sync {
    fn refresh(&self, refresh_token: &str) -> Result<TokenSet, TokenError>;
    fn revoke(&self, refresh_token: &str);
}

impl<T: TokenBackend + ?Sized> TokenBackend for std::sync::Arc<T> {
    fn refresh(&self, refresh_token: &str) -> Result<TokenSet, TokenError> {
        (**self).refresh(refresh_token)
    }
    fn revoke(&self, refresh_token: &str) {
        (**self).revoke(refresh_token)
    }
}

fn endpoint(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    valid_origin(text)?;
    Some(text.to_string())
}

/// Reads the endpoints out of an OpenID discovery document.
pub(crate) fn parse_discovery(body: &Value) -> Option<Endpoints> {
    Some(Endpoints {
        authorization: endpoint(body.get("authorization_endpoint"))?,
        token: endpoint(body.get("token_endpoint"))?,
        revocation: endpoint(body.get("revocation_endpoint")),
    })
}

pub(crate) fn discover(issuer: &str) -> Result<Endpoints, TokenError> {
    let url = format!("{issuer}/.well-known/openid-configuration");
    let response = match agent(HTTP_TIMEOUT, Some(0)).get(&url).call() {
        Ok(response) => response,
        Err(ureq::Error::Status(..)) => {
            return Err(TokenError::Failed(
                "Sign-in is not available right now.".into(),
            ))
        }
        Err(ureq::Error::Transport(_)) => return Err(TokenError::Network),
    };
    let body: Value = response
        .into_string()
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null);
    parse_discovery(&body)
        .ok_or_else(|| TokenError::Failed("Sign-in returned an unexpected configuration.".into()))
}

pub(crate) fn authorize_url(
    endpoints: &Endpoints,
    client_id: &str,
    redirect: &str,
    state: &str,
    challenge: &str,
) -> Result<String, String> {
    let mut url = url::Url::parse(&endpoints.authorization)
        .map_err(|_| "Sign-in returned an unexpected configuration.".to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("scope", SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(url.into())
}

fn text(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Maps a token endpoint reply to tokens or a classified error. `status` is the HTTP
/// status; error codes follow RFC 6749 section 5.2.
pub(crate) fn parse_token_response(status: u16, body: &Value) -> Result<TokenSet, TokenError> {
    if let Some(error) = text(body, "error") {
        return Err(match error.as_str() {
            "invalid_grant" | "invalid_token" | "unauthorized_client" | "access_denied" => {
                TokenError::InvalidGrant
            }
            _ => TokenError::Failed(format!(
                "Sign-in failed ({}).",
                crate::oauth_loopback::sanitize(&error)
            )),
        });
    }
    if status == 400 || status == 401 {
        return Err(TokenError::InvalidGrant);
    }
    if !(200..300).contains(&status) {
        return Err(TokenError::Failed(format!(
            "Sign-in failed (HTTP {status})."
        )));
    }
    let access_token = text(body, "access_token")
        .ok_or_else(|| TokenError::Failed("Sign-in returned no access token.".into()))?;
    let expires_in = body
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3600)
        .clamp(60, 86_400);
    Ok(TokenSet {
        access_token,
        refresh_token: text(body, "refresh_token"),
        expires_in,
    })
}

fn post_form(url: &str, fields: &[(&str, &str)]) -> Result<(u16, Value), TokenError> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish();
    let response = agent(HTTP_TIMEOUT, Some(0))
        .post(url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Accept", "application/json")
        .send_string(&body);
    let response = match response {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(_)) => return Err(TokenError::Network),
    };
    let status = response.status();
    let text = response.into_string().unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

pub(crate) fn exchange_code(
    endpoints: &Endpoints,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<TokenSet, TokenError> {
    let (status, body) = post_form(
        &endpoints.token,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect),
        ],
    )?;
    parse_token_response(status, &body)
}

/// Talks to the configured Clerk instance; endpoints are discovered once per backend.
pub(crate) struct HttpBackend {
    config: Config,
    endpoints: std::sync::Mutex<Option<Endpoints>>,
}

impl HttpBackend {
    pub(crate) fn new(config: Config) -> Self {
        Self {
            config,
            endpoints: std::sync::Mutex::new(None),
        }
    }

    pub(crate) fn endpoints(&self) -> Result<Endpoints, TokenError> {
        let mut cached = self.endpoints.lock().map_err(|_| TokenError::Network)?;
        if let Some(endpoints) = cached.as_ref() {
            return Ok(endpoints.clone());
        }
        let found = discover(&self.config.issuer)?;
        *cached = Some(found.clone());
        Ok(found)
    }
}

impl TokenBackend for HttpBackend {
    fn refresh(&self, refresh_token: &str) -> Result<TokenSet, TokenError> {
        let client_id = self
            .config
            .client_id
            .as_deref()
            .ok_or_else(|| TokenError::Failed("Account sign-in is not set up.".into()))?;
        let endpoints = self.endpoints()?;
        let (status, body) = post_form(
            &endpoints.token,
            &[
                ("grant_type", "refresh_token"),
                ("client_id", client_id),
                ("refresh_token", refresh_token),
            ],
        )?;
        parse_token_response(status, &body)
    }

    /// Best effort: a failed revocation never blocks sign-out.
    fn revoke(&self, refresh_token: &str) {
        let (Some(client_id), Ok(endpoints)) = (self.config.client_id.as_deref(), self.endpoints())
        else {
            return;
        };
        let Some(url) = endpoints.revocation else {
            return;
        };
        let _ = post_form(
            &url,
            &[
                ("token", refresh_token),
                ("token_type_hint", "refresh_token"),
                ("client_id", client_id),
            ],
        ); // -- local sign-out proceeds even when the provider is unreachable.
    }
}
