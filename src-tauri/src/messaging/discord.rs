//! Discord provider: a bot token over the REST API (no gateway). A thread is one configured
//! channel; direct messages are not listed because REST cannot enumerate them.
use super::types::{Account, Attachment, Message, Provider, Secret, Thread};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const API: &str = "https://discord.com/api/v10";
const USER_AGENT: &str = "DiscordBot (https://github.com/bahadryalcn/bycoda, 1)";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RETRY_WAIT_SECS: f64 = 5.0;
const MAX_CHANNELS: usize = 50;
const MAX_CONTENT_CHARS: usize = 2000;
const DISCORD_EPOCH_MS: u64 = 1_420_070_400_000;
const CONTENT_INTENT_HINT: &str =
    "[No text available: enable the Message Content intent for this bot in the Discord Developer Portal (Bot > Privileged Gateway Intents).]";

pub(crate) fn normalize_config(config: &Value) -> Result<Value, String> {
    let raw = match config {
        Value::Null => None,
        Value::Object(map) => map.get("channelIds"),
        _ => return Err("Discord settings are invalid.".into()),
    };
    let entries: Vec<String> = match raw {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::String(text)) => text
            .split(|ch: char| ch == ',' || ch.is_whitespace())
            .map(str::to_string)
            .collect(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "Channel IDs must be text.".to_string())
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err("Channel IDs must be a list.".into()),
    };
    let mut ids: Vec<String> = Vec::new();
    for entry in entries {
        let id = entry.trim();
        if id.is_empty() {
            continue;
        }
        if !is_snowflake(id) {
            return Err(format!(
                "\"{}\" is not a Discord channel ID. Copy it with Developer Mode > Copy Channel ID.",
                id.chars().take(40).collect::<String>()
            ));
        }
        if !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
    }
    if ids.len() > MAX_CHANNELS {
        return Err(format!("Add at most {MAX_CHANNELS} Discord channels."));
    }
    Ok(json!({ "channelIds": ids }))
}

pub(crate) fn verify(config: &Value, secret: &mut Secret) -> Result<String, String> {
    let token = bot_token(secret)?;
    secret.insert("botToken".into(), Value::String(token.clone()));
    verify_with(&mut UreqHttp::new(&token), &channel_ids(config))
}

pub(crate) fn list_threads(
    account: &Account,
    secret: &mut Secret,
    limit: usize,
) -> Result<Vec<Thread>, String> {
    let token = bot_token(secret)?;
    let mut ids = channel_ids(&account.config);
    ids.truncate(limit);
    list_threads_with(&mut UreqHttp::new(&token), &account.id, &ids)
}

pub(crate) fn thread_messages(
    account: &Account,
    secret: &mut Secret,
    thread_id: &str,
) -> Result<Vec<Message>, String> {
    configured_channel(&account.config, thread_id)?;
    let token = bot_token(secret)?;
    thread_messages_with(&mut UreqHttp::new(&token), thread_id)
}

pub(crate) fn reply(
    account: &Account,
    secret: &mut Secret,
    thread_id: &str,
    body: &str,
) -> Result<Message, String> {
    configured_channel(&account.config, thread_id)?;
    let token = bot_token(secret)?;
    reply_with(&mut UreqHttp::new(&token), thread_id, body)
}

// ---- HTTP layer (injectable for tests) ----

pub(super) struct Response {
    pub status: u16,
    pub retry_after: Option<f64>,
    pub body: String,
}

pub(super) trait Http {
    /// `json_body` makes the request a JSON POST; otherwise it is a GET.
    fn send(&mut self, path: &str, json_body: Option<&str>) -> Result<Response, String>;
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
            authorization: format!("Bot {token}"),
        }
    }
}

impl Http for UreqHttp {
    fn send(&mut self, path: &str, json_body: Option<&str>) -> Result<Response, String> {
        let url = format!("{API}{path}");
        let result = match json_body {
            Some(body) => self
                .agent
                .post(&url)
                .set("Authorization", &self.authorization)
                .set("User-Agent", USER_AGENT)
                .set("Content-Type", "application/json")
                .send_string(body),
            None => self
                .agent
                .get(&url)
                .set("Authorization", &self.authorization)
                .set("User-Agent", USER_AGENT)
                .call(),
        };
        let response = match result {
            Ok(response) | Err(ureq::Error::Status(_, response)) => response,
            Err(ureq::Error::Transport(_)) => {
                return Err("Could not reach Discord. Check your connection and try again.".into())
            }
        };
        let status = response.status();
        let retry_after = response
            .header("Retry-After")
            .and_then(|value| value.trim().parse::<f64>().ok());
        let body = response
            .into_string()
            .map_err(|_| "Discord returned an unreadable response.".to_string())?;
        Ok(Response {
            status,
            retry_after,
            body,
        })
    }
}

#[derive(Debug, PartialEq)]
pub(super) enum ApiError {
    RateLimited(f64),
    /// HTTP status with Discord's own error message, when it sent one.
    Status(u16, Option<String>),
    Failed(String),
}

fn rate_limit_text(seconds: f64) -> String {
    format!(
        "Discord is rate limiting requests. Try again in {} seconds.",
        seconds.ceil().max(1.0) as u64
    )
}

/// Readable text for an API error; `channel` names the channel the call was about.
pub(super) fn error_text(error: ApiError, channel: Option<&str>, posting: bool) -> String {
    match error {
        ApiError::RateLimited(seconds) => rate_limit_text(seconds),
        ApiError::Failed(message) => message,
        ApiError::Status(401, _) => {
            "Discord rejected the bot token. Reset the token under Bot in the Developer Portal and paste the new one.".into()
        }
        ApiError::Status(403, _) => match (channel, posting) {
            (Some(id), true) => format!(
                "The bot cannot post in channel {id}. Give it the Send Messages permission."
            ),
            (Some(id), false) => format!(
                "The bot cannot read channel {id}. Give it View Channel and Read Message History."
            ),
            (None, _) => "The bot does not have permission for this request.".into(),
        },
        ApiError::Status(404, _) => match channel {
            Some(id) => format!(
                "Channel {id} was not found, or the bot has not been added to its server."
            ),
            None => "Discord could not find this resource.".into(),
        },
        ApiError::Status(status, _) if status >= 500 => {
            format!("Discord is unavailable right now ({status}).")
        }
        ApiError::Status(status, Some(message)) => format!(
            "Discord request failed ({status}): {}",
            message.chars().take(200).collect::<String>()
        ),
        ApiError::Status(status, None) => format!("Discord request failed ({status})."),
    }
}

pub(super) fn parse_response(response: &Response) -> Result<Value, ApiError> {
    let value: Option<Value> = serde_json::from_str(&response.body).ok();
    if response.status == 429 {
        let seconds = value
            .as_ref()
            .and_then(|value| value.get("retry_after"))
            .and_then(Value::as_f64)
            .or(response.retry_after)
            .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
            .unwrap_or(1.0);
        return Err(ApiError::RateLimited(seconds));
    }
    if !(200..300).contains(&response.status) {
        let message = value
            .as_ref()
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string);
        return Err(ApiError::Status(response.status, message));
    }
    value.ok_or_else(|| ApiError::Failed("Discord returned an unreadable response.".into()))
}

/// One REST call; a 429 waits once when Discord asks for at most 5 s.
fn call(http: &mut dyn Http, path: &str, body: Option<&Value>) -> Result<Value, ApiError> {
    let payload = body.map(Value::to_string);
    let mut retried = false;
    loop {
        let response = http
            .send(path, payload.as_deref())
            .map_err(ApiError::Failed)?;
        match parse_response(&response) {
            Err(ApiError::RateLimited(seconds)) if !retried && seconds <= MAX_RETRY_WAIT_SECS => {
                retried = true;
                http.wait(Duration::from_secs_f64(seconds));
            }
            other => return other,
        }
    }
}

// ---- Token, IDs, config ----

pub(super) fn bot_token(secret: &Secret) -> Result<String, String> {
    let raw = secret
        .get("botToken")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let token = raw.strip_prefix("Bot ").unwrap_or(raw).trim();
    if token.is_empty() {
        return Err("Paste the Discord bot token.".into());
    }
    let well_formed = (20..=200).contains(&token.len())
        && token
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'));
    if !well_formed {
        return Err(
            "This is not a Discord bot token. Copy it from Bot > Reset Token in the Developer Portal."
                .into(),
        );
    }
    Ok(token.to_string())
}

pub(super) fn is_snowflake(id: &str) -> bool {
    (17..=20).contains(&id.len())
        && id.bytes().all(|byte| byte.is_ascii_digit())
        && id.parse::<u64>().is_ok()
}

fn channel_ids(config: &Value) -> Vec<String> {
    config
        .get("channelIds")
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .filter(|id| is_snowflake(id))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Only configured channels are read or posted to; the ID is a validated snowflake.
pub(super) fn configured_channel(config: &Value, thread_id: &str) -> Result<(), String> {
    if !is_snowflake(thread_id) {
        return Err("This Discord channel ID is invalid.".into());
    }
    if !channel_ids(config).iter().any(|id| id == thread_id) {
        return Err("This channel is no longer in the account's channel list.".into());
    }
    Ok(())
}

// ---- Commands over the injectable HTTP layer ----

struct BotUser {
    id: String,
    name: String,
}

fn bot_user(http: &mut dyn Http) -> Result<BotUser, String> {
    let value = call(http, "/users/@me", None).map_err(|error| error_text(error, None, false))?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let name = user_name(&value).unwrap_or_else(|| "Discord bot".into());
    Ok(BotUser { id, name })
}

pub(super) fn verify_with(http: &mut dyn Http, channel_ids: &[String]) -> Result<String, String> {
    let bot = bot_user(http)?;
    for id in channel_ids {
        call(http, &format!("/channels/{id}"), None)
            .map_err(|error| error_text(error, Some(id), false))?;
    }
    Ok(bot.name)
}

pub(super) fn list_threads_with(
    http: &mut dyn Http,
    account_id: &str,
    channel_ids: &[String],
) -> Result<Vec<Thread>, String> {
    let mut threads = Vec::new();
    let mut first_error: Option<String> = None;
    for id in channel_ids {
        if !is_snowflake(id) {
            continue;
        }
        let channel = match call(http, &format!("/channels/{id}"), None) {
            Ok(channel) => channel,
            Err(error @ ApiError::RateLimited(_)) => {
                first_error.get_or_insert(error_text(error, Some(id), false));
                break;
            }
            Err(error) => {
                first_error.get_or_insert(error_text(error, Some(id), false));
                continue;
            }
        };
        let latest = match call(http, &format!("/channels/{id}/messages?limit=1"), None) {
            Ok(value) => value.as_array().and_then(|items| items.first()).cloned(),
            Err(ApiError::RateLimited(_)) => {
                threads.push(channel_thread(account_id, id, &channel, None));
                break;
            }
            Err(error) => {
                first_error.get_or_insert(error_text(error, Some(id), false));
                None
            }
        };
        threads.push(channel_thread(account_id, id, &channel, latest.as_ref()));
    }
    if threads.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }
    }
    threads.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at));
    Ok(threads)
}

pub(super) fn channel_thread(
    account_id: &str,
    id: &str,
    channel: &Value,
    latest: Option<&Value>,
) -> Thread {
    let name = channel.get("name").and_then(Value::as_str).unwrap_or("");
    let title = if !name.is_empty() {
        format!("#{name}")
    } else {
        let recipients: Vec<String> = channel
            .get("recipients")
            .and_then(Value::as_array)
            .map(|users| users.iter().filter_map(user_name).collect())
            .unwrap_or_default();
        if recipients.is_empty() {
            format!("Channel {id}")
        } else {
            recipients.join(", ")
        }
    };
    let updated_at = latest
        .and_then(message_time)
        .or_else(|| {
            channel
                .get("last_message_id")
                .and_then(Value::as_str)
                .and_then(snowflake_ms)
        })
        .or_else(|| snowflake_ms(id))
        .unwrap_or(0);
    let guild = channel
        .get("guild_id")
        .and_then(Value::as_str)
        .filter(|guild| is_snowflake(guild))
        .unwrap_or("@me");
    Thread {
        id: id.to_string(),
        account_id: account_id.to_string(),
        provider: Provider::Discord,
        title,
        participants: Vec::new(),
        preview: latest.map(message_body).unwrap_or_default(),
        updated_at,
        unread: false,
        url: Some(format!("https://discord.com/channels/{guild}/{id}")),
    }
}

pub(super) fn thread_messages_with(
    http: &mut dyn Http,
    thread_id: &str,
) -> Result<Vec<Message>, String> {
    let bot = bot_user(http)?;
    let value = call(
        http,
        &format!("/channels/{thread_id}/messages?limit=50"),
        None,
    )
    .map_err(|error| error_text(error, Some(thread_id), false))?;
    let mut messages: Vec<Message> = value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|raw| map_message(raw, thread_id, &bot.id))
                .collect()
        })
        .unwrap_or_default();
    messages.sort_by(|left, right| left.at.cmp(&right.at).then_with(|| left.id.cmp(&right.id)));
    Ok(messages)
}

pub(super) fn reply_with(
    http: &mut dyn Http,
    thread_id: &str,
    body: &str,
) -> Result<Message, String> {
    if body.chars().count() > MAX_CONTENT_CHARS {
        return Err(format!(
            "Discord messages are limited to {MAX_CONTENT_CHARS} characters."
        ));
    }
    let payload = json!({ "content": body, "allowed_mentions": { "parse": [] } });
    let value = call(
        http,
        &format!("/channels/{thread_id}/messages"),
        Some(&payload),
    )
    .map_err(|error| error_text(error, Some(thread_id), true))?;
    let author_id = value
        .pointer("/author/id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut message =
        map_message(&value, thread_id, &author_id).ok_or("Discord did not confirm the message.")?;
    message.outbound = true;
    Ok(message)
}

// ---- Pure mapping ----

/// Creation time encoded in a snowflake, in milliseconds.
pub(super) fn snowflake_ms(id: &str) -> Option<u64> {
    let value: u64 = id.parse().ok()?;
    Some((value >> 22) + DISCORD_EPOCH_MS)
}

pub(super) fn iso_ms(text: &str) -> Option<u64> {
    let parsed =
        time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).ok()?;
    u64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

fn message_time(raw: &Value) -> Option<u64> {
    raw.get("timestamp")
        .and_then(Value::as_str)
        .and_then(iso_ms)
        .or_else(|| raw.get("id").and_then(Value::as_str).and_then(snowflake_ms))
}

fn user_name(user: &Value) -> Option<String> {
    ["global_name", "username"].into_iter().find_map(|key| {
        user.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    })
}

/// Plain body: mentions resolved, embeds as a fallback, and an intent hint for empty content.
pub(super) fn message_body(raw: &Value) -> String {
    let mut names = HashMap::new();
    if let Some(mentions) = raw.get("mentions").and_then(Value::as_array) {
        for user in mentions {
            if let (Some(id), Some(name)) =
                (user.get("id").and_then(Value::as_str), user_name(user))
            {
                names.insert(id.to_string(), name);
            }
        }
    }
    let content = raw.get("content").and_then(Value::as_str).unwrap_or("");
    if !content.trim().is_empty() {
        return content_to_plain(content, &names);
    }
    let embeds: Vec<String> = raw
        .get("embeds")
        .and_then(Value::as_array)
        .map(|embeds| {
            embeds
                .iter()
                .flat_map(|embed| {
                    ["title", "description"]
                        .into_iter()
                        .filter_map(|key| embed.get(key).and_then(Value::as_str))
                        .filter(|text| !text.trim().is_empty())
                        .map(|text| content_to_plain(text, &names))
                        .collect::<Vec<_>>()
                })
                .collect()
        })
        .unwrap_or_default();
    if !embeds.is_empty() {
        return embeds.join("\n");
    }
    let has_extras = ["attachments", "sticker_items"].into_iter().any(|key| {
        raw.get(key)
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
    });
    // Default (0) and reply (19) messages with nothing visible were hidden by the missing intent.
    let kind = raw.get("type").and_then(Value::as_u64).unwrap_or(0);
    if !has_extras && (kind == 0 || kind == 19) {
        CONTENT_INTENT_HINT.into()
    } else {
        String::new()
    }
}

/// `<@id>`/`<@!id>` → @name, `<@&id>` → @role, `<#id>` → #channel, `<:name:id>` → :name:.
pub(super) fn content_to_plain(content: &str, names: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let replaced = after
            .find('>')
            .and_then(|end| render_token(&after[..end], names).map(|text| (text, end)));
        match replaced {
            Some((text, end)) => {
                out.push_str(&text);
                rest = &after[end + 1..];
            }
            None => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn render_token(token: &str, names: &HashMap<String, String>) -> Option<String> {
    if let Some(id) = token.strip_prefix("@&") {
        return is_snowflake(id).then(|| "@role".to_string());
    }
    if let Some(id) = token.strip_prefix('@') {
        let id = id.strip_prefix('!').unwrap_or(id);
        if !is_snowflake(id) {
            return None;
        }
        let name = names
            .get(id)
            .cloned()
            .unwrap_or_else(|| "unknown-user".into());
        return Some(format!("@{name}"));
    }
    if let Some(id) = token.strip_prefix('#') {
        return is_snowflake(id).then(|| "#channel".to_string());
    }
    let emoji = token
        .strip_prefix("a:")
        .or_else(|| token.strip_prefix(':'))?;
    let (name, id) = emoji.split_once(':')?;
    (!name.is_empty() && is_snowflake(id)).then(|| format!(":{name}:"))
}

pub(super) fn map_message(raw: &Value, thread_id: &str, bot_id: &str) -> Option<Message> {
    let id = raw.get("id").and_then(Value::as_str)?.to_string();
    let author = raw.get("author");
    let author_id = author
        .and_then(|author| author.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let attachments = raw
        .get("attachments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| Attachment {
                    name: item
                        .get("filename")
                        .and_then(Value::as_str)
                        .filter(|name| !name.is_empty())
                        .unwrap_or("File")
                        .to_string(),
                    size: item.get("size").and_then(Value::as_u64),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(Message {
        at: message_time(raw).unwrap_or(0),
        id,
        thread_id: thread_id.to_string(),
        author: author
            .and_then(user_name)
            .unwrap_or_else(|| "Discord".into()),
        author_address: None,
        body: message_body(raw),
        outbound: !bot_id.is_empty() && author_id == bot_id,
        attachments,
    })
}

#[cfg(test)]
#[path = "discord_tests.rs"]
mod tests;
