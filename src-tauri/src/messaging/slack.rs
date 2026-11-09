//! Slack provider over the Web API, authenticated either by a browser sign-in user token
//! (`secret.slack`, see `oauth`) or a pasted bot token (`xoxb-`). A thread is one
//! conversation (channel, private channel, DM or group DM); only top-level messages are read.
use super::oauth::{self, Purpose};
use super::types::{Account, Attachment, Message, Provider, Secret, Thread};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const API: &str = "https://slack.com/api/";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RETRY_WAIT_SECS: u64 = 5;
const PAGE_SIZE: &str = "200";
const MAX_PAGES: usize = 5;
const HISTORY_LIMIT: &str = "50";
/// users.info calls per command; names beyond the budget fall back to the user ID.
const MAX_USER_LOOKUPS: usize = 80;

/// Scopes the app needs, as bot scopes or as user scopes (`oauth::SLACK_USER_SCOPE`);
/// shown when Slack reports a missing scope.
pub(crate) const REQUIRED_SCOPES: &[&str] = &[
    "channels:read",
    "channels:history",
    "groups:read",
    "groups:history",
    "im:read",
    "im:history",
    "mpim:read",
    "mpim:history",
    "users:read",
    "chat:write",
];

/// App manifest the user pastes into "Create an app > From a manifest".
#[allow(dead_code)] // shortcut: the settings card may show it later.
pub(crate) const SLACK_APP_MANIFEST: &str = r#"display_information:
  name: bycoda
  description: Read and reply to Slack conversations from bycoda.
features:
  bot_user:
    display_name: bycoda
    always_online: false
oauth_config:
  redirect_urls:
    - https://bycoda.codes/oauth/slack/
  pkce_enabled: true
  scopes:
    user:
      - channels:read
      - channels:history
      - groups:read
      - groups:history
      - im:read
      - im:history
      - mpim:read
      - mpim:history
      - users:read
      - chat:write
    bot:
      - channels:read
      - channels:history
      - groups:read
      - groups:history
      - im:read
      - im:history
      - mpim:read
      - mpim:history
      - users:read
      - chat:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
"#;

pub(crate) fn normalize_config(config: &Value) -> Result<Value, String> {
    match config {
        Value::Null | Value::Object(_) => Ok(json!({})),
        _ => Err("Slack settings are invalid.".into()),
    }
}

pub(crate) fn verify(_config: &Value, secret: &mut Secret) -> Result<String, String> {
    if !uses_user_token(secret) {
        let token = bot_token(secret)?;
        secret.insert("botToken".into(), Value::String(token));
    }
    run(secret, verify_with)
}

pub(crate) fn list_threads(
    account: &Account,
    secret: &mut Secret,
    limit: usize,
) -> Result<Vec<Thread>, String> {
    run(secret, |http| list_threads_with(http, &account.id, limit))
}

pub(crate) fn thread_messages(
    _account: &Account,
    secret: &mut Secret,
    thread_id: &str,
) -> Result<Vec<Message>, String> {
    valid_conversation_id(thread_id)?;
    run(secret, |http| thread_messages_with(http, thread_id))
}

pub(crate) fn reply(
    _account: &Account,
    secret: &mut Secret,
    thread_id: &str,
    body: &str,
) -> Result<Message, String> {
    valid_conversation_id(thread_id)?;
    run(secret, |http| reply_with(http, thread_id, body))
}

/// Runs one command over HTTP with the account token.
fn run<T>(
    secret: &mut Secret,
    mut op: impl FnMut(&mut dyn Http) -> Result<T, String>,
) -> Result<T, String> {
    run_with(
        secret,
        resolve_token,
        |secret| oauth::refresh_access_token(Purpose::Slack, secret),
        |token| op(&mut UreqHttp::new(token)),
    )
}

/// A rejected user token is refreshed once and the command retried; user-token errors
/// are reworded for a person instead of a bot.
pub(super) fn run_with<T>(
    secret: &mut Secret,
    resolve: impl FnOnce(&mut Secret) -> Result<Token, String>,
    refresh: impl FnOnce(&mut Secret) -> Result<String, String>,
    mut op: impl FnMut(&str) -> Result<T, String>,
) -> Result<T, String> {
    let token = match resolve(secret)? {
        Token::Bot(token) => return op(&token),
        Token::User(token) => token,
    };
    let result = match op(&token) {
        Err(error) if error == BOT_REJECTED => op(&refresh(secret)?),
        other => other,
    };
    result.map_err(user_wording)
}

// ---- HTTP layer (injectable for tests) ----

pub(super) struct Response {
    pub status: u16,
    pub retry_after: Option<f64>,
    /// Value of `X-OAuth-Scopes`, when Slack sends it.
    pub scopes: Option<String>,
    pub body: String,
}

pub(super) trait Http {
    /// `json_body` makes the request a JSON POST; otherwise it is a GET.
    fn send(&mut self, url: &str, json_body: Option<&str>) -> Result<Response, String>;
    fn wait(&mut self, delay: Duration) {
        std::thread::sleep(delay);
    }
}

struct UreqHttp {
    agent: ureq::Agent,
    authorization: String,
}

impl UreqHttp {
    fn new(token: &str) -> Self {
        Self {
            agent: crate::integrations::http::agent(HTTP_TIMEOUT, Some(0)),
            authorization: format!("Bearer {token}"),
        }
    }
}

impl Http for UreqHttp {
    fn send(&mut self, url: &str, json_body: Option<&str>) -> Result<Response, String> {
        let result = match json_body {
            Some(body) => self
                .agent
                .post(url)
                .set("Authorization", &self.authorization)
                .set("Content-Type", "application/json; charset=utf-8")
                .send_string(body),
            None => self
                .agent
                .get(url)
                .set("Authorization", &self.authorization)
                .call(),
        };
        let response = match result {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(ureq::Error::Transport(_)) => {
                return Err("Could not reach Slack. Check your connection and try again.".into())
            }
        };
        let status = response.status();
        let retry_after = response
            .header("Retry-After")
            .and_then(|value| value.trim().parse::<f64>().ok());
        let scopes = response.header("X-OAuth-Scopes").map(str::to_string);
        let body = response
            .into_string()
            .map_err(|_| "Slack returned an unreadable response.".to_string())?;
        Ok(Response {
            status,
            retry_after,
            scopes,
            body,
        })
    }
}

#[derive(Debug, PartialEq)]
pub(super) enum ApiError {
    RateLimited(u64),
    Failed(String),
}

impl ApiError {
    fn text(self) -> String {
        match self {
            ApiError::RateLimited(seconds) => rate_limit_text(seconds),
            ApiError::Failed(message) => message,
        }
    }
}

fn rate_limit_text(seconds: u64) -> String {
    format!("Slack is rate limiting requests. Try again in {seconds} seconds.")
}

fn api_url(method: &str, params: &[(&str, &str)]) -> String {
    let mut url = url::Url::parse(API)
        .and_then(|base| base.join(method))
        .expect("static Slack API URL");
    if !params.is_empty() {
        url.query_pairs_mut().extend_pairs(params.iter().copied());
    }
    url.into()
}

/// One Web API call; on a rate limit it waits once when Slack asks for at most 5 s.
fn call(
    http: &mut dyn Http,
    method: &str,
    params: &[(&str, &str)],
    body: Option<&Value>,
    retry: bool,
) -> Result<(Value, Response), ApiError> {
    let url = api_url(method, params);
    let payload = body.map(Value::to_string);
    let mut retried = false;
    loop {
        let mut response = http
            .send(&url, payload.as_deref())
            .map_err(ApiError::Failed)?;
        match parse_response(&response) {
            Err(ApiError::RateLimited(seconds))
                if retry && !retried && seconds <= MAX_RETRY_WAIT_SECS =>
            {
                retried = true;
                http.wait(Duration::from_secs(seconds));
            }
            Ok(value) => {
                response.body.clear();
                return Ok((value, response));
            }
            Err(error) => return Err(error),
        }
    }
}

fn retry_seconds(retry_after: Option<f64>) -> u64 {
    retry_after
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        .map(|seconds| seconds.ceil() as u64)
        .unwrap_or(1)
        .max(1)
}

pub(super) fn parse_response(response: &Response) -> Result<Value, ApiError> {
    if response.status == 429 {
        return Err(ApiError::RateLimited(retry_seconds(response.retry_after)));
    }
    let value: Value = match serde_json::from_str(&response.body) {
        Ok(value) => value,
        Err(_) if response.status >= 500 => {
            return Err(ApiError::Failed(format!(
                "Slack is unavailable right now ({}).",
                response.status
            )))
        }
        Err(_) => {
            return Err(ApiError::Failed(
                "Slack returned an unreadable response.".into(),
            ))
        }
    };
    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(value);
    }
    let code = value.get("error").and_then(Value::as_str).unwrap_or("");
    if code == "ratelimited" {
        return Err(ApiError::RateLimited(retry_seconds(response.retry_after)));
    }
    let needed = value.get("needed").and_then(Value::as_str);
    Err(ApiError::Failed(error_text(code, needed)))
}

fn safe_code(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | ':' | ',' | '.' | '-'))
        .take(80)
        .collect()
}

pub(super) fn error_text(code: &str, needed: Option<&str>) -> String {
    match code {
        "invalid_auth" | "not_authed" | "account_inactive" | "token_revoked" | "token_expired"
        | "no_permission" => BOT_REJECTED.into(),
        "missing_scope" => {
            let needed = needed.map(safe_code).filter(|scope| !scope.is_empty());
            let required = REQUIRED_SCOPES.join(", ");
            match needed {
                Some(scope) => format!(
                    "The Slack app is missing the {scope} scope. Add it under OAuth & Permissions and reconnect. Required scopes: {required}."
                ),
                None => format!(
                    "The Slack app is missing a scope. Required scopes: {required}."
                ),
            }
        }
        "not_in_channel" | "channel_not_found" => BOT_NOT_MEMBER.into(),
        "is_archived" => "This conversation is archived.".into(),
        "msg_too_long" => "This message is too long for Slack.".into(),
        "restricted_action" | "cant_post" => BOT_CANT_POST.into(),
        "" => "Slack request failed.".into(),
        other => format!("Slack request failed: {}.", safe_code(other)),
    }
}

const BOT_REJECTED: &str =
    "Slack rejected the bot token. Reinstall the app and paste its current xoxb- token.";
const BOT_NOT_MEMBER: &str =
    "The bot is not a member of this conversation. Invite it with /invite @bycoda.";
const BOT_CANT_POST: &str = "Slack does not allow the bot to post in this conversation.";

/// Rewords bot-specific errors for a signed-in person.
pub(super) fn user_wording(error: String) -> String {
    match error.as_str() {
        BOT_REJECTED => "Slack sign-in expired. Reconnect this account.".into(),
        BOT_NOT_MEMBER => "You are not a member of this Slack conversation.".into(),
        BOT_CANT_POST => "Slack does not allow you to post in this conversation.".into(),
        _ => error,
    }
}

// ---- Token and IDs ----

#[derive(Debug, PartialEq)]
pub(super) enum Token {
    Bot(String),
    User(String),
}

/// Browser sign-in stores a token record under `slack`; it wins over a pasted bot token.
pub(super) fn uses_user_token(secret: &Secret) -> bool {
    secret
        .get(Purpose::Slack.secret_key())
        .is_some_and(Value::is_object)
}

/// The user token is refreshed in place when it is about to expire.
pub(super) fn resolve_token(secret: &mut Secret) -> Result<Token, String> {
    if !uses_user_token(secret) {
        return bot_token(secret).map(Token::Bot);
    }
    let token = oauth::access_token(Purpose::Slack, secret)?;
    if token.len() > 512 || !token.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err("Slack sign-in returned an invalid token. Reconnect this account.".into());
    }
    Ok(Token::User(token))
}

pub(super) fn bot_token(secret: &Secret) -> Result<String, String> {
    let token = secret
        .get("botToken")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if token.is_empty() {
        return Err("Paste the Slack bot token (xoxb-…).".into());
    }
    let well_formed = token.starts_with("xoxb-")
        && token.len() <= 256
        && token
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-');
    if !well_formed {
        return Err(
            "This is not a Slack bot token. Copy the Bot User OAuth Token that starts with xoxb-."
                .into(),
        );
    }
    Ok(token.to_string())
}

pub(super) fn valid_conversation_id(id: &str) -> Result<(), String> {
    let valid = (9..=24).contains(&id.len())
        && matches!(id.as_bytes()[0], b'C' | b'D' | b'G')
        && id
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    if valid {
        Ok(())
    } else {
        Err("This Slack conversation ID is invalid.".into())
    }
}

fn valid_user_id(id: &str) -> bool {
    (3..=24).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

// ---- Commands over the injectable HTTP layer ----

/// `auth.test` result; a user token has the person's `user_id` and no `bot_id`.
struct Identity {
    team: String,
    user: String,
    user_id: String,
    bot_id: String,
}

fn auth_test(http: &mut dyn Http) -> Result<(Identity, Option<String>), String> {
    let (value, response) = call(http, "auth.test", &[], None, true).map_err(ApiError::text)?;
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    Ok((
        Identity {
            team: text("team"),
            user: text("user"),
            user_id: text("user_id"),
            bot_id: text("bot_id"),
        },
        response.scopes,
    ))
}

/// Scopes from `X-OAuth-Scopes` that the app still lacks.
pub(super) fn missing_scopes(granted: &str) -> Vec<&'static str> {
    let granted: HashSet<&str> = granted.split(',').map(str::trim).collect();
    REQUIRED_SCOPES
        .iter()
        .copied()
        .filter(|scope| !granted.contains(scope))
        .collect()
}

pub(super) fn verify_with(http: &mut dyn Http) -> Result<String, String> {
    let (identity, scopes) = auth_test(http)?;
    if let Some(granted) = scopes {
        let missing = missing_scopes(&granted);
        if !missing.is_empty() {
            return Err(format!(
                "The Slack app is missing these scopes: {}. Add them under OAuth & Permissions and reconnect.",
                missing.join(", ")
            ));
        }
    }
    let team = if identity.team.is_empty() {
        "Slack"
    } else {
        identity.team.as_str()
    };
    Ok(if identity.user.is_empty() {
        team.to_string()
    } else {
        format!("{team} ({})", identity.user)
    })
}

/// Per-command user name cache with a lookup budget.
#[derive(Default)]
pub(super) struct Users {
    names: HashMap<String, String>,
    failed: HashSet<String>,
    lookups: usize,
    blocked: bool,
}

impl Users {
    fn known(&self, id: &str) -> Option<String> {
        self.names.get(id).cloned()
    }

    fn resolve(&mut self, http: &mut dyn Http, id: &str) -> Option<String> {
        if let Some(name) = self.names.get(id) {
            return Some(name.clone());
        }
        if self.blocked
            || self.lookups >= MAX_USER_LOOKUPS
            || self.failed.contains(id)
            || !valid_user_id(id)
        {
            return None;
        }
        self.lookups += 1;
        match call(http, "users.info", &[("user", id)], None, false) {
            Ok((value, _)) => match value.get("user").and_then(user_display_name) {
                Some(name) => {
                    self.names.insert(id.to_string(), name.clone());
                    Some(name)
                }
                None => {
                    self.failed.insert(id.to_string());
                    None
                }
            },
            Err(ApiError::RateLimited(_)) => {
                self.blocked = true;
                None
            }
            Err(ApiError::Failed(_)) => {
                self.failed.insert(id.to_string());
                None
            }
        }
    }
}

fn non_empty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

pub(super) fn user_display_name(user: &Value) -> Option<String> {
    let profile = user.get("profile");
    non_empty(profile.and_then(|profile| profile.get("display_name")))
        .or_else(|| non_empty(profile.and_then(|profile| profile.get("real_name"))))
        .or_else(|| non_empty(user.get("real_name")))
        .or_else(|| non_empty(user.get("name")))
}

/// Paginates users.conversations; a rate limit after the first page keeps what was read.
fn conversations(http: &mut dyn Http) -> Result<Vec<Value>, String> {
    let mut all = Vec::new();
    let mut cursor = String::new();
    let mut seen = HashSet::new();
    for page in 0..MAX_PAGES {
        let mut params = vec![
            ("types", "public_channel,private_channel,im,mpim"),
            ("exclude_archived", "true"),
            ("limit", PAGE_SIZE),
        ];
        if !cursor.is_empty() {
            params.push(("cursor", cursor.as_str()));
        }
        let value = match call(http, "users.conversations", &params, None, true) {
            Ok((value, _)) => value,
            Err(ApiError::RateLimited(_)) if page > 0 => break,
            Err(error) => return Err(error.text()),
        };
        if let Some(channels) = value.get("channels").and_then(Value::as_array) {
            all.extend(channels.iter().cloned());
        }
        let next = value
            .pointer("/response_metadata/next_cursor")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if next.is_empty() || !seen.insert(next.clone()) {
            break;
        }
        cursor = next;
    }
    Ok(all)
}

fn conversation_activity(conversation: &Value) -> u64 {
    let updated = conversation.get("updated").and_then(Value::as_u64);
    let created = conversation
        .get("created")
        .and_then(Value::as_u64)
        .map(|seconds| seconds.saturating_mul(1000));
    updated.or(created).unwrap_or(0)
}

/// `mpdm-ana--bora--cem-1` → `ana, bora, cem`.
pub(super) fn group_dm_title(name: &str) -> String {
    let inner = name.strip_prefix("mpdm-").unwrap_or(name);
    let inner = match inner.rfind('-') {
        Some(index) if inner[index + 1..].bytes().all(|byte| byte.is_ascii_digit()) => {
            &inner[..index]
        }
        _ => inner,
    };
    let names: Vec<&str> = inner.split("--").filter(|part| !part.is_empty()).collect();
    if names.is_empty() {
        "Group message".into()
    } else {
        names.join(", ")
    }
}

pub(super) fn list_threads_with(
    http: &mut dyn Http,
    account_id: &str,
    limit: usize,
) -> Result<Vec<Thread>, String> {
    let mut conversations = conversations(http)?;
    conversations.retain(|conversation| {
        conversation
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| valid_conversation_id(id).is_ok())
    });
    conversations
        .sort_by_key(|conversation| std::cmp::Reverse(conversation_activity(conversation)));
    conversations.truncate(limit);

    let mut users = Users::default();
    let mut threads = Vec::new();
    let mut history_open = true;
    let mut history_ok = 0usize;
    let mut history_error: Option<String> = None;
    for conversation in &conversations {
        let id = conversation["id"].as_str().unwrap_or_default().to_string();
        let mut latest: Option<Value> = None;
        if history_open {
            match call(
                http,
                "conversations.history",
                &[("channel", id.as_str()), ("limit", "1")],
                None,
                false,
            ) {
                Ok((value, _)) => {
                    history_ok += 1;
                    latest = value
                        .get("messages")
                        .and_then(Value::as_array)
                        .and_then(|messages| messages.first())
                        .cloned();
                }
                Err(ApiError::RateLimited(_)) => history_open = false,
                Err(ApiError::Failed(message)) => {
                    history_error.get_or_insert(message);
                }
            }
        }
        let title = conversation_title(http, &mut users, conversation);
        let preview = latest
            .as_ref()
            .map(|message| message_text(message, &|id| users.known(id)))
            .unwrap_or_default();
        let updated_at = latest
            .as_ref()
            .and_then(|message| message.get("ts"))
            .and_then(Value::as_str)
            .and_then(ts_to_ms)
            .unwrap_or_else(|| conversation_activity(conversation));
        threads.push(Thread {
            id,
            account_id: account_id.to_string(),
            provider: Provider::Slack,
            title,
            participants: Vec::new(),
            preview,
            updated_at,
            unread: false,
            url: None,
        });
    }
    // Every history call failing (usually a missing *:history scope) is an error, not empty threads.
    if history_ok == 0 {
        if let Some(message) = history_error {
            return Err(message);
        }
    }
    threads.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at));
    Ok(threads)
}

fn conversation_title(http: &mut dyn Http, users: &mut Users, conversation: &Value) -> String {
    let flag = |key: &str| conversation.get(key).and_then(Value::as_bool) == Some(true);
    let name = conversation
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("");
    if flag("is_im") {
        return conversation
            .get("user")
            .and_then(Value::as_str)
            .and_then(|user| users.resolve(http, user))
            .unwrap_or_else(|| "Direct message".into());
    }
    if flag("is_mpim") {
        return group_dm_title(name);
    }
    if name.is_empty() {
        "Conversation".into()
    } else {
        format!("#{name}")
    }
}

pub(super) fn thread_messages_with(
    http: &mut dyn Http,
    thread_id: &str,
) -> Result<Vec<Message>, String> {
    let (me, _) = auth_test(http)?;
    let (value, _) = call(
        http,
        "conversations.history",
        &[("channel", thread_id), ("limit", HISTORY_LIMIT)],
        None,
        true,
    )
    .map_err(ApiError::text)?;
    let raw = value
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut users = Users::default();
    for message in &raw {
        if let Some(user) = message.get("user").and_then(Value::as_str) {
            users.resolve(http, user);
        }
        let text = message.get("text").and_then(Value::as_str).unwrap_or("");
        for mentioned in mentioned_users(text) {
            users.resolve(http, &mentioned);
        }
    }
    let mut messages: Vec<Message> = raw
        .iter()
        .filter_map(|message| {
            map_message(message, thread_id, &me.user_id, &me.bot_id, &|id| {
                users.known(id)
            })
        })
        .collect();
    messages.sort_by(|left, right| left.at.cmp(&right.at).then_with(|| left.id.cmp(&right.id)));
    Ok(messages)
}

pub(super) fn reply_with(
    http: &mut dyn Http,
    thread_id: &str,
    body: &str,
) -> Result<Message, String> {
    let payload = json!({
        "channel": thread_id,
        "text": body,
        "unfurl_links": false,
        "unfurl_media": false,
    });
    let (value, _) =
        call(http, "chat.postMessage", &[], Some(&payload), true).map_err(ApiError::text)?;
    let ts = value
        .get("ts")
        .and_then(Value::as_str)
        .ok_or("Slack did not confirm the message.")?
        .to_string();
    let mut posted = value.get("message").cloned().unwrap_or_else(|| json!({}));
    if let Some(object) = posted.as_object_mut() {
        object.insert("ts".into(), Value::String(ts));
        if object
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            object.insert("text".into(), Value::String(body.to_string()));
        }
    }
    let mut users = Users::default();
    let user = posted
        .get("user")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !user.is_empty() {
        users.resolve(http, &user);
    }
    let bot_id = posted
        .get("bot_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut message = map_message(&posted, thread_id, &user, &bot_id, &|id| users.known(id))
        .ok_or("Slack did not confirm the message.")?;
    message.outbound = true;
    Ok(message)
}

// ---- Pure mapping ----

/// Slack `ts` (`seconds.micros`) → milliseconds.
pub(super) fn ts_to_ms(ts: &str) -> Option<u64> {
    let (seconds, fraction) = ts.split_once('.').unwrap_or((ts, ""));
    let seconds: u64 = seconds.parse().ok()?;
    if !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let millis: u64 = format!("{fraction:0<3}")[..3].parse().ok()?;
    Some(seconds.saturating_mul(1000).saturating_add(millis))
}

type Names<'a> = &'a dyn Fn(&str) -> Option<String>;

pub(super) fn map_message(
    raw: &Value,
    thread_id: &str,
    own_user: &str,
    own_bot: &str,
    names: Names,
) -> Option<Message> {
    let ts = raw.get("ts").and_then(Value::as_str)?;
    let at = ts_to_ms(ts)?;
    let user = raw.get("user").and_then(Value::as_str).unwrap_or("");
    let author = if !user.is_empty() {
        names(user)
            .or_else(|| {
                let profile = raw.get("user_profile");
                non_empty(profile.and_then(|profile| profile.get("display_name")))
                    .or_else(|| non_empty(profile.and_then(|profile| profile.get("real_name"))))
            })
            .unwrap_or_else(|| user.to_string())
    } else {
        non_empty(raw.get("username"))
            .or_else(|| non_empty(raw.pointer("/bot_profile/name")))
            .unwrap_or_else(|| "Slack".into())
    };
    // A user token has no bot ID, so only the person's own user ID marks outbound.
    let outbound = (!own_user.is_empty() && user == own_user)
        || (!own_bot.is_empty() && raw.get("bot_id").and_then(Value::as_str) == Some(own_bot));
    let mut body = message_text(raw, names);
    let replies = raw.get("reply_count").and_then(Value::as_u64).unwrap_or(0);
    if replies > 0 {
        let note = if replies == 1 {
            "(1 reply in thread)".to_string()
        } else {
            format!("({replies} replies in thread)")
        };
        body = if body.is_empty() {
            note
        } else {
            format!("{body}\n{note}")
        };
    }
    let attachments = raw
        .get("files")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .map(|file| Attachment {
                    name: non_empty(file.get("name"))
                        .or_else(|| non_empty(file.get("title")))
                        .unwrap_or_else(|| "File".into()),
                    size: file.get("size").and_then(Value::as_u64),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(Message {
        id: ts.to_string(),
        thread_id: thread_id.to_string(),
        author,
        author_address: None,
        body,
        at,
        outbound,
        attachments,
    })
}

/// Message text as plain text; legacy attachment fallbacks fill an empty `text`.
fn message_text(raw: &Value, names: Names) -> String {
    let text = raw.get("text").and_then(Value::as_str).unwrap_or("");
    if !text.trim().is_empty() {
        return mrkdwn_to_plain(text, names);
    }
    raw.get("attachments")
        .and_then(Value::as_array)
        .map(|attachments| {
            attachments
                .iter()
                .filter_map(|attachment| {
                    non_empty(attachment.get("text"))
                        .or_else(|| non_empty(attachment.get("fallback")))
                })
                .map(|text| mrkdwn_to_plain(&text, names))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// User IDs referenced as `<@U…>` in mrkdwn.
pub(super) fn mentioned_users(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("<@") {
        let after = &rest[start + 2..];
        let Some(end) = after.find('>') else { break };
        let id = after[..end].split('|').next().unwrap_or("");
        if valid_user_id(id) && !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
        rest = &after[end + 1..];
    }
    ids
}

/// Slack mrkdwn → plain text: mentions, channel links and URLs become their labels;
/// `&amp;`, `&lt;` and `&gt;` are decoded once.
pub(super) fn mrkdwn_to_plain(text: &str, names: Names) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        out.push_str(&decode_entities(&rest[..start]));
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else {
            out.push_str(&decode_entities(&rest[start..]));
            return out;
        };
        out.push_str(&decode_entities(&render_token(&after[..end], names)));
        rest = &after[end + 1..];
    }
    out.push_str(&decode_entities(rest));
    out
}

fn render_token(token: &str, names: Names) -> String {
    let (target, label) = match token.split_once('|') {
        Some((target, label)) => (target, Some(label).filter(|label| !label.is_empty())),
        None => (token, None),
    };
    if let Some(id) = target.strip_prefix('@') {
        let name = label
            .map(|label| label.trim_start_matches('@').to_string())
            .or_else(|| names(id))
            .unwrap_or_else(|| id.to_string());
        return format!("@{name}");
    }
    if let Some(id) = target.strip_prefix('#') {
        return format!("#{}", label.unwrap_or(id));
    }
    if let Some(special) = target.strip_prefix('!') {
        if let Some(label) = label {
            return label.to_string();
        }
        let keyword = special.split('^').next().unwrap_or(special);
        return format!("@{keyword}");
    }
    match label {
        Some(label) => label.to_string(),
        None => target.strip_prefix("mailto:").unwrap_or(target).to_string(),
    }
}

pub(super) fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find('&') {
        out.push_str(&rest[..index]);
        let tail = &rest[index..];
        let entity = [
            ("&amp;", '&'),
            ("&lt;", '<'),
            ("&gt;", '>'),
            ("&quot;", '"'),
            ("&#39;", '\''),
        ]
        .into_iter()
        .find(|(name, _)| tail.starts_with(name));
        match entity {
            Some((name, ch)) => {
                out.push(ch);
                rest = &tail[name.len()..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
#[path = "slack_tests.rs"]
mod tests;
