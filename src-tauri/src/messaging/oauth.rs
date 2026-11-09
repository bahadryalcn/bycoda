//! Browser sign-in (OAuth authorization code + PKCE over a loopback redirect) for Google
//! (Gmail IMAP/SMTP) and Slack (user token). Tokens stay native: the UI opens the
//! authorize URL, polls a handle and attaches the handle when it saves the account.
use super::types::{now_ms, Secret};
use crate::oauth_loopback::{
    bind, code_challenge, random_token, respond, sanitize, wait_for_callback, Callback, Waited,
    CALLBACK_PATH,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
/// How long the browser has to finish sign-in.
const SIGN_IN_WINDOW: Duration = Duration::from_secs(300);
/// How long finished tokens wait for the account to be saved.
const DONE_KEEP: Duration = Duration::from_secs(600);
const MAX_PENDING: usize = 8;
const REFRESH_MARGIN_MS: u64 = 60_000;
/// Slack matches localhost redirects by port, so its listener uses a fixed one.
pub(crate) const SLACK_REDIRECT_PORT: u16 = 47213;
/// Distributed Slack apps need an HTTPS redirect; this static page forwards the code and
/// state to `http://localhost:47213/callback` without storing anything.
pub(crate) const SLACK_REDIRECT_URL: &str = "https://bycoda.codes/oauth/slack/";
const EXPIRED_REQUEST: &str = "This sign-in request expired. Start again.";

const GOOGLE_AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_SCOPE: &str = "https://mail.google.com/ openid email";
const SLACK_AUTHORIZE: &str = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN: &str = "https://slack.com/api/oauth.v2.access";
/// User scopes; the same names the bot flow needs.
pub(crate) const SLACK_USER_SCOPE: &str = "channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,users:read,chat:write";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Purpose {
    Google,
    Slack,
}

impl Purpose {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "google" => Ok(Self::Google),
            "slack" => Ok(Self::Slack),
            _ => Err("Unknown browser sign-in.".into()),
        }
    }

    /// Key of the token record inside the account secret.
    pub(crate) fn secret_key(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Slack => "slack",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Google => "Google",
            Self::Slack => "Slack",
        }
    }

    fn reconnect(self) -> String {
        format!("{} sign-in expired. Reconnect this account.", self.label())
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStart {
    pub handle: String,
    pub authorize_url: String,
    pub expires_in: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPoll {
    /// pending | done | denied | expired | failed
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Signed-in address or workspace, once done.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
}

enum State {
    Waiting,
    Done(Value),
    Denied,
    Failed(String),
}

struct Pending {
    purpose: Purpose,
    state: State,
    expires: Instant,
    cancel: Arc<AtomicBool>,
}

static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn pending_map() -> Result<std::sync::MutexGuard<'static, HashMap<String, Pending>>, String> {
    PENDING
        .lock()
        .map_err(|_| "Browser sign-in is busy.".to_string())
}

/// Drops expired requests (stopping their listeners) and, when full, the oldest one.
fn prune(map: &mut HashMap<String, Pending>, now: Instant) {
    map.retain(|_, pending| {
        let keep = pending.expires > now;
        if !keep {
            pending.cancel.store(true, Ordering::Relaxed);
        }
        keep
    });
    while map.len() >= MAX_PENDING {
        let Some(oldest) = map
            .iter()
            .min_by_key(|(_, pending)| pending.expires)
            .map(|(handle, _)| handle.clone())
        else {
            break;
        };
        if let Some(pending) = map.remove(&oldest) {
            pending.cancel.store(true, Ordering::Relaxed);
        }
    }
}

// ---- Client registration ----

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Client {
    pub id: String,
    pub secret: Option<String>,
}

fn valid_client_id(purpose: Purpose, id: &str) -> bool {
    let allowed = |c: char| match purpose {
        Purpose::Google => c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'),
        Purpose::Slack => c.is_ascii_digit() || c == '.',
    };
    !id.is_empty() && id.len() <= 200 && id.chars().all(allowed)
}

fn built_in(name: &str, compiled: Option<&'static str>) -> Option<String> {
    compiled
        .map(str::to_string)
        .or_else(|| std::env::var(name).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Explicit client ID (advanced settings) wins; otherwise the build or runtime registration.
pub(crate) fn resolve_client(
    purpose: Purpose,
    explicit_id: Option<&str>,
    explicit_secret: Option<&str>,
) -> Result<Client, String> {
    let explicit_id = explicit_id.map(str::trim).filter(|id| !id.is_empty());
    let explicit_secret = explicit_secret
        .map(str::trim)
        .filter(|secret| !secret.is_empty())
        .map(str::to_string);
    let (id, secret) = match (purpose, explicit_id) {
        (_, Some(id)) => (Some(id.to_string()), explicit_secret),
        (Purpose::Google, None) => (
            built_in(
                "BYCODA_GOOGLE_CLIENT_ID",
                option_env!("BYCODA_GOOGLE_CLIENT_ID"),
            ),
            built_in(
                "BYCODA_GOOGLE_CLIENT_SECRET",
                option_env!("BYCODA_GOOGLE_CLIENT_SECRET"),
            ),
        ),
        (Purpose::Slack, None) => (
            built_in(
                "BYCODA_SLACK_CLIENT_ID",
                option_env!("BYCODA_SLACK_CLIENT_ID"),
            ),
            None,
        ),
    };
    let id = id.ok_or_else(|| {
        format!(
            "{} sign-in needs an app registration. Add a client ID in advanced options.",
            purpose.label()
        )
    })?;
    if !valid_client_id(purpose, &id) {
        return Err(format!("The {} client ID is not valid.", purpose.label()));
    }
    Ok(Client { id, secret })
}

// ---- PKCE and URLs ----

pub(crate) fn redirect_uri(purpose: Purpose, port: u16) -> String {
    match purpose {
        Purpose::Google => format!("http://127.0.0.1:{port}{CALLBACK_PATH}"),
        Purpose::Slack => SLACK_REDIRECT_URL.to_string(),
    }
}

pub(crate) fn authorize_url(
    purpose: Purpose,
    client_id: &str,
    redirect: &str,
    state: &str,
    challenge: &str,
    login_hint: Option<&str>,
) -> String {
    let base = match purpose {
        Purpose::Google => GOOGLE_AUTHORIZE,
        Purpose::Slack => SLACK_AUTHORIZE,
    };
    let mut url = url::Url::parse(base).expect("static authorize URL");
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256");
        match purpose {
            Purpose::Google => {
                query
                    .append_pair("response_type", "code")
                    .append_pair("scope", GOOGLE_SCOPE)
                    .append_pair("access_type", "offline")
                    .append_pair("prompt", "consent");
                if let Some(hint) = login_hint.map(str::trim).filter(|hint| !hint.is_empty()) {
                    query.append_pair("login_hint", hint);
                }
            }
            Purpose::Slack => {
                query
                    .append_pair("scope", "")
                    .append_pair("user_scope", SLACK_USER_SCOPE);
            }
        }
    }
    url.into()
}

// ---- Token endpoint ----

fn post_form(purpose: Purpose, url: &str, fields: &[(&str, &str)]) -> Result<Value, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish();
    let response = crate::integrations::http::agent(HTTP_TIMEOUT, Some(0))
        .post(url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Accept", "application/json")
        .send_string(&body);
    let response = match response {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(error)) => {
            return Err(format!(
                "Could not reach {} sign-in ({}).",
                purpose.label(),
                error.kind()
            ))
        }
    };
    let text = response.into_string().unwrap_or_default();
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

#[derive(Debug, PartialEq)]
pub(crate) struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Seconds; `None` means the token does not expire.
    pub expires_in: Option<u64>,
    pub user_id: Option<String>,
    pub team: Option<String>,
}

#[derive(Debug, PartialEq)]
pub(crate) enum TokenError {
    /// The grant or refresh token is no longer valid; the user must sign in again.
    Reconnect,
    Failed(String),
}

fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn number_field(value: &Value, key: &str) -> Option<u64> {
    match value.get(key)? {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// Parses a Google or Slack token reply (exchange or refresh).
pub(crate) fn parse_tokens(purpose: Purpose, body: &Value) -> Result<Tokens, TokenError> {
    match purpose {
        Purpose::Google => {
            if let Some(error) = str_field(body, "error") {
                return Err(if error == "invalid_grant" {
                    TokenError::Reconnect
                } else {
                    let detail = str_field(body, "error_description").unwrap_or(error);
                    TokenError::Failed(format!("Google sign-in failed: {}", sanitize(&detail)))
                });
            }
            let access_token = str_field(body, "access_token").ok_or_else(|| {
                TokenError::Failed("Google sign-in returned no access token.".into())
            })?;
            Ok(Tokens {
                access_token,
                refresh_token: str_field(body, "refresh_token"),
                expires_in: Some(
                    number_field(body, "expires_in")
                        .unwrap_or(3600)
                        .clamp(60, 86_400),
                ),
                user_id: None,
                team: None,
            })
        }
        Purpose::Slack => {
            if body.get("ok").and_then(Value::as_bool) != Some(true) {
                let error = str_field(body, "error").unwrap_or_else(|| "unknown_error".into());
                return Err(match error.as_str() {
                    "invalid_refresh_token" | "invalid_grant_type" | "token_revoked"
                    | "invalid_code" | "code_already_used" => TokenError::Reconnect,
                    "bad_redirect_uri" => TokenError::Failed(format!(
                        "Slack rejected the redirect URL. Add {SLACK_REDIRECT_URL} under OAuth & Permissions > Redirect URLs and turn on PKCE."
                    )),
                    _ => TokenError::Failed(format!("Slack sign-in failed: {}", sanitize(&error))),
                });
            }
            // Exchange replies carry the user token under authed_user; refresh replies at the top.
            let user = body
                .get("authed_user")
                .filter(|user| user.get("access_token").is_some());
            let source = user.unwrap_or(body);
            let access_token = str_field(source, "access_token").ok_or_else(|| {
                TokenError::Failed("Slack sign-in returned no user token.".into())
            })?;
            Ok(Tokens {
                access_token,
                refresh_token: str_field(source, "refresh_token"),
                expires_in: number_field(source, "expires_in")
                    .map(|secs| secs.clamp(60, 86_400 * 30)),
                user_id: str_field(source, "id").or_else(|| str_field(body, "user_id")),
                team: body.get("team").and_then(|team| str_field(team, "name")),
            })
        }
    }
}

fn token_url(purpose: Purpose) -> &'static str {
    match purpose {
        Purpose::Google => GOOGLE_TOKEN,
        Purpose::Slack => SLACK_TOKEN,
    }
}

fn exchange(
    purpose: Purpose,
    client: &Client,
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<Tokens, String> {
    let mut fields = vec![
        ("client_id", client.id.as_str()),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect),
    ];
    if purpose == Purpose::Google {
        fields.push(("grant_type", "authorization_code"));
    }
    if let Some(secret) = &client.secret {
        fields.push(("client_secret", secret));
    }
    let body = post_form(purpose, token_url(purpose), &fields)?;
    parse_tokens(purpose, &body).map_err(|error| match error {
        TokenError::Reconnect => EXPIRED_REQUEST.to_string(),
        TokenError::Failed(message) => message,
    })
}

fn google_email(access_token: &str) -> Result<String, String> {
    let response = crate::integrations::http::agent(HTTP_TIMEOUT, Some(0))
        .get(GOOGLE_USERINFO)
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
        .map_err(|_| "Google sign-in could not read the account address.".to_string())?;
    let body: Value = response
        .into_string()
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or_else(|| "Google sign-in could not read the account address.".to_string())?;
    str_field(&body, "email").ok_or_else(|| "Google did not share the account address.".into())
}

/// Stored token record; `expiresAt` 0 means the access token does not expire.
pub(crate) fn token_record(tokens: &Tokens, client: &Client, identity: &str, now: u64) -> Value {
    let mut record = json!({
        "accessToken": tokens.access_token,
        "refreshToken": tokens.refresh_token.clone().unwrap_or_default(),
        "expiresAt": tokens.expires_in.map(|secs| now + secs * 1000).unwrap_or(0),
        "clientId": client.id,
        "identity": identity,
    });
    let object = record.as_object_mut().expect("record is an object");
    if let Some(secret) = &client.secret {
        object.insert("clientSecret".into(), json!(secret));
    }
    if let Some(user_id) = &tokens.user_id {
        object.insert("userId".into(), json!(user_id));
    }
    if let Some(team) = &tokens.team {
        object.insert("team".into(), json!(team));
    }
    record
}

fn finish(purpose: Purpose, client: &Client, tokens: Tokens) -> Result<Value, String> {
    let identity = match purpose {
        Purpose::Google => google_email(&tokens.access_token)?,
        Purpose::Slack => tokens.team.clone().unwrap_or_else(|| "Slack".into()),
    };
    Ok(token_record(&tokens, client, &identity, now_ms()))
}

fn bind_listener(purpose: Purpose) -> Result<TcpListener, String> {
    bind(match purpose {
        Purpose::Google => 0,
        Purpose::Slack => SLACK_REDIRECT_PORT,
    })
}

fn set_state(handle: &str, state: State) {
    if let Ok(mut map) = pending_map() {
        if let Some(pending) = map.get_mut(handle) {
            if matches!(state, State::Done(_)) {
                pending.expires = Instant::now() + DONE_KEEP;
            }
            pending.state = state;
        }
    }
}

struct Flow {
    purpose: Purpose,
    handle: String,
    client: Client,
    state: String,
    verifier: String,
    redirect: String,
    cancel: Arc<AtomicBool>,
    deadline: Instant,
}

fn listen(listener: TcpListener, flow: Flow) {
    let (callback, mut stream) =
        match wait_for_callback(&listener, &flow.state, &flow.cancel, flow.deadline) {
            Waited::Callback(callback, stream, _) => (callback, stream),
            Waited::Failed => {
                set_state(
                    &flow.handle,
                    State::Failed("Could not start browser sign-in.".into()),
                );
                return;
            }
            Waited::Cancelled | Waited::TimedOut => return,
        };
    match callback {
        Callback::Ignore => {}
        Callback::Denied => {
            respond(
                &mut stream,
                "200 OK",
                "Sign-in was cancelled. You can close this tab.",
            );
            set_state(&flow.handle, State::Denied);
        }
        Callback::Error(code, _) => {
            let message = format!("{} sign-in failed: {code}", flow.purpose.label());
            respond(
                &mut stream,
                "200 OK",
                "Sign-in failed. Return to bycoda for details.",
            );
            set_state(&flow.handle, State::Failed(message));
        }
        Callback::Code(code) => {
            let result = exchange(
                flow.purpose,
                &flow.client,
                &code,
                &flow.verifier,
                &flow.redirect,
            )
            .and_then(|tokens| finish(flow.purpose, &flow.client, tokens));
            match result {
                Ok(record) => {
                    respond(
                        &mut stream,
                        "200 OK",
                        "Signed in. You can close this tab and return to bycoda.",
                    );
                    set_state(&flow.handle, State::Done(record));
                }
                Err(message) => {
                    respond(
                        &mut stream,
                        "200 OK",
                        "Sign-in failed. Return to bycoda for details.",
                    );
                    set_state(&flow.handle, State::Failed(message));
                }
            }
        }
    }
}

// ---- Public flow API ----

pub(crate) fn start(
    purpose: Purpose,
    client_id: Option<&str>,
    client_secret: Option<&str>,
    login_hint: Option<&str>,
) -> Result<BrowserStart, String> {
    let client = resolve_client(purpose, client_id, client_secret)?;
    {
        // One flow per purpose: a new attempt replaces the previous one and frees its port.
        let mut map = pending_map()?;
        map.retain(|_, pending| {
            let replace = pending.purpose == purpose && matches!(pending.state, State::Waiting);
            if replace {
                pending.cancel.store(true, Ordering::Relaxed);
            }
            !replace
        });
    }
    let listener = bind_listener(purpose)?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not start browser sign-in.".to_string())?
        .port();
    let redirect = redirect_uri(purpose, port);
    let state = random_token();
    let verifier = random_token();
    let url = authorize_url(
        purpose,
        &client.id,
        &redirect,
        &state,
        &code_challenge(&verifier),
        login_hint,
    );
    let handle = uuid::Uuid::new_v4().to_string();
    let now = Instant::now();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = pending_map()?;
        prune(&mut map, now);
        map.insert(
            handle.clone(),
            Pending {
                purpose,
                state: State::Waiting,
                expires: now + SIGN_IN_WINDOW,
                cancel: cancel.clone(),
            },
        );
    }
    let flow = Flow {
        purpose,
        handle: handle.clone(),
        client,
        state,
        verifier,
        redirect,
        cancel,
        deadline: now + SIGN_IN_WINDOW,
    };
    std::thread::Builder::new()
        .name("messaging-oauth".into())
        .spawn(move || listen(listener, flow))
        .map_err(|_| "Could not start browser sign-in.".to_string())?;
    Ok(BrowserStart {
        handle,
        authorize_url: url,
        expires_in: SIGN_IN_WINDOW.as_secs(),
    })
}

fn poll_status(status: &str, error: Option<String>, identity: Option<String>) -> BrowserPoll {
    BrowserPoll {
        status: status.into(),
        error,
        identity,
    }
}

pub(crate) fn poll(handle: &str) -> Result<BrowserPoll, String> {
    let mut map = pending_map()?;
    prune(&mut map, Instant::now());
    let Some(pending) = map.get(handle) else {
        return Ok(poll_status("expired", Some(EXPIRED_REQUEST.into()), None));
    };
    Ok(match &pending.state {
        State::Waiting => poll_status("pending", None, None),
        State::Done(record) => poll_status("done", None, str_field(record, "identity")),
        State::Denied => poll_status("denied", Some("Sign-in was declined.".into()), None),
        State::Failed(message) => poll_status("failed", Some(message.clone()), None),
    })
}

pub(crate) fn cancel(handle: &str) {
    if let Ok(mut map) = pending_map() {
        if let Some(pending) = map.remove(handle) {
            pending.cancel.store(true, Ordering::Relaxed);
        }
    }
}

/// True when the handle belongs to a browser sign-in (not a Microsoft device flow).
pub(crate) fn owns(handle: &str) -> bool {
    pending_map().is_ok_and(|map| map.contains_key(handle))
}

/// Returns finished tokens without consuming them, so a failed save can retry.
pub(crate) fn tokens(handle: &str) -> Result<(Purpose, Value), String> {
    let mut map = pending_map()?;
    prune(&mut map, Instant::now());
    match map.get(handle) {
        None => Err(EXPIRED_REQUEST.into()),
        Some(Pending {
            purpose,
            state: State::Done(record),
            ..
        }) => Ok((*purpose, record.clone())),
        Some(_) => Err("Finish browser sign-in first.".into()),
    }
}

/// Forgets a finished flow once its tokens are stored with an account.
pub(crate) fn forget(handle: &str) {
    cancel(handle);
}

// ---- Stored tokens ----

fn record_mut(purpose: Purpose, secret: &mut Secret) -> Result<&mut Map<String, Value>, String> {
    secret
        .get_mut(purpose.secret_key())
        .and_then(Value::as_object_mut)
        .ok_or_else(|| purpose.reconnect())
}

pub(crate) fn needs_refresh(expires_at: u64, now: u64) -> bool {
    expires_at != 0 && expires_at <= now.saturating_add(REFRESH_MARGIN_MS)
}

/// Writes refreshed tokens into the record, keeping the old refresh token when not rotated.
pub(crate) fn apply_refresh(record: &mut Map<String, Value>, tokens: &Tokens, now: u64) {
    record.insert("accessToken".into(), json!(tokens.access_token));
    if let Some(refresh) = &tokens.refresh_token {
        record.insert("refreshToken".into(), json!(refresh));
    }
    record.insert(
        "expiresAt".into(),
        json!(tokens.expires_in.map(|secs| now + secs * 1000).unwrap_or(0)),
    );
}

/// Returns a valid access token from `secret[purpose]`, refreshing it in place when it
/// expires within a minute.
pub(crate) fn access_token(purpose: Purpose, secret: &mut Secret) -> Result<String, String> {
    let record = record_mut(purpose, secret)?;
    let access = str_field(&Value::Object(record.clone()), "accessToken");
    let expires_at = record.get("expiresAt").and_then(Value::as_u64).unwrap_or(0);
    match access {
        Some(access) if !needs_refresh(expires_at, now_ms()) => Ok(access),
        _ => refresh_access_token(purpose, secret),
    }
}

/// Refreshes unconditionally (for example after a 401) and stores the new tokens.
pub(crate) fn refresh_access_token(
    purpose: Purpose,
    secret: &mut Secret,
) -> Result<String, String> {
    let record = Value::Object(record_mut(purpose, secret)?.clone());
    let refresh = str_field(&record, "refreshToken").ok_or_else(|| purpose.reconnect())?;
    let client_id = str_field(&record, "clientId").ok_or_else(|| purpose.reconnect())?;
    let client_secret = str_field(&record, "clientSecret");
    let mut fields = vec![
        ("grant_type", "refresh_token"),
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh.as_str()),
    ];
    if let Some(secret) = &client_secret {
        fields.push(("client_secret", secret));
    }
    let body = post_form(purpose, token_url(purpose), &fields)?;
    match parse_tokens(purpose, &body) {
        Ok(tokens) => {
            apply_refresh(record_mut(purpose, secret)?, &tokens, now_ms());
            Ok(tokens.access_token)
        }
        Err(TokenError::Reconnect) => Err(purpose.reconnect()),
        Err(TokenError::Failed(message)) => Err(message),
    }
}

#[cfg(test)]
#[path = "oauth_tests.rs"]
mod tests;
