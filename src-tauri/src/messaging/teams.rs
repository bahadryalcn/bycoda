//! Microsoft Teams chats through Microsoft Graph v1.0 with delegated device-code tokens.
//! A thread is one chat (1:1, group or meeting chat).
mod html;

use super::microsoft;
use super::types::{now_ms, Account, Attachment, Message, Provider, Secret, Thread};
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const GRAPH_ORIGIN: &str = "https://graph.microsoft.com/";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RETRY_WAIT: Duration = Duration::from_secs(5);
const MAX_PAGES: usize = 8;
const PREVIEW_CHARS: usize = 200;
const MAX_TITLE_NAMES: usize = 4;
const MAX_PARTICIPANTS: usize = 20;
const ORDER_RECENT: &str = "$orderby=lastMessagePreview/createdDateTime%20desc";
const INVALID_CHAT: &str = "This Teams chat is not valid.";

/// Set when Graph rejects expanding members together with the last message preview.
static MEMBERS_EXPAND_UNSUPPORTED: AtomicBool = AtomicBool::new(false);

pub(crate) fn normalize_config(config: &Value) -> Result<Value, String> {
    if !matches!(config, Value::Null | Value::Object(_)) {
        return Err("Teams settings are invalid.".into());
    }
    let client_id = crate::integrations::http::string_field(config, "clientId").unwrap_or_default();
    let tenant = microsoft::normalize_tenant(config.get("tenant").and_then(Value::as_str))?;
    let mut out = Map::new();
    if !client_id.is_empty() {
        out.insert(
            "clientId".into(),
            json!(microsoft::resolve_client_id(Some(&client_id), None)?),
        );
    }
    out.insert("tenant".into(), json!(tenant));
    Ok(Value::Object(out))
}

pub(crate) fn verify(_config: &Value, secret: &mut Secret) -> Result<String, String> {
    let purpose = secret
        .get("microsoft")
        .and_then(|record| record.get("purpose"))
        .and_then(Value::as_str);
    if purpose != Some("teams") {
        return Err("Sign in with Microsoft for Teams first.".into());
    }
    let me = graph(
        secret,
        Method::Get,
        &format!("{GRAPH}/me?$select=id,displayName,userPrincipalName,mail"),
        None,
    )?;
    store_user_id(secret, text(&me, &["id"]));
    Ok(identity(&me))
}

pub(crate) fn list_threads(
    account: &Account,
    secret: &mut Secret,
    limit: usize,
) -> Result<Vec<Thread>, String> {
    let me = me_id(secret)?;
    let chats = if MEMBERS_EXPAND_UNSUPPORTED.load(Ordering::Relaxed) {
        fetch_chats(secret, limit, false).map_err(|failure| failure.message)?
    } else {
        match fetch_chats(secret, limit, true) {
            Err(failure) if failure.status == Some(400) => {
                MEMBERS_EXPAND_UNSUPPORTED.store(true, Ordering::Relaxed);
                fetch_chats(secret, limit, false).map_err(|failure| failure.message)?
            }
            other => other.map_err(|failure| failure.message)?,
        }
    };
    let mut threads: Vec<Thread> = chats
        .iter()
        .filter_map(|chat| chat_to_thread(&account.id, &me, chat))
        .collect();
    threads.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at));
    threads.truncate(limit);
    Ok(threads)
}

pub(crate) fn thread_messages(
    _account: &Account,
    secret: &mut Secret,
    thread_id: &str,
) -> Result<Vec<Message>, String> {
    let chat = chat_segment(thread_id)?;
    let me = me_id(secret)?;
    let page = graph(
        secret,
        Method::Get,
        &format!("{GRAPH}/chats/{chat}/messages?$top=50"),
        None,
    )?;
    let mut messages: Vec<Message> = items(&page)
        .iter()
        .filter_map(|item| graph_message(thread_id, &me, item))
        .collect();
    messages.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
    Ok(messages)
}

pub(crate) fn reply(
    _account: &Account,
    secret: &mut Secret,
    thread_id: &str,
    body: &str,
) -> Result<Message, String> {
    let chat = chat_segment(thread_id)?;
    let me = me_id(secret)?;
    // HTML keeps the reply's line breaks; the text is escaped so it shows verbatim.
    let payload = json!({ "body": { "contentType": "html", "content": html::text_to_html(body) } });
    let posted = graph(
        secret,
        Method::Post,
        &format!("{GRAPH}/chats/{chat}/messages"),
        Some(&payload),
    )?;
    let sent = graph_message(thread_id, &me, &posted).unwrap_or_else(|| Message {
        id: Some(text(&posted, &["id"]))
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        thread_id: thread_id.to_string(),
        author: "You".into(),
        author_address: None,
        body: body.to_string(),
        at: now_ms(),
        outbound: true,
        attachments: Vec::new(),
    });
    Ok(Message {
        outbound: true,
        ..sent
    })
}

// ---- Graph HTTP ----

#[derive(Clone, Copy)]
enum Method {
    Get,
    Post,
}

#[derive(Debug)]
struct Failure {
    status: Option<u16>,
    message: String,
}

impl Failure {
    fn new(status: Option<u16>, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

fn graph(
    secret: &mut Secret,
    method: Method,
    url: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    graph_raw(secret, method, url, body).map_err(|failure| failure.message)
}

/// One Graph call. A 401 refreshes the token once; 429 (and 503 for reads) waits once
/// when Graph asks for at most 5 s. Posts are not retried on 503 to avoid double sends.
fn graph_raw(
    secret: &mut Secret,
    method: Method,
    url: &str,
    body: Option<&Value>,
) -> Result<Value, Failure> {
    let mut token = microsoft::access_token(secret).map_err(|error| Failure::new(None, error))?;
    let mut refreshed = false;
    let mut retried = false;
    let agent = crate::integrations::http::agent(HTTP_TIMEOUT, Some(0));
    loop {
        let request = match method {
            Method::Get => agent.get(url),
            Method::Post => agent.post(url),
        }
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/json");
        let result = match body {
            Some(body) => request
                .set("Content-Type", "application/json")
                .send_string(&body.to_string()),
            None => request.call(),
        };
        match result {
            Ok(response) => return read_json(response).map_err(|error| Failure::new(None, error)),
            Err(ureq::Error::Status(401, _)) if !refreshed => {
                refreshed = true;
                token = microsoft::refresh_access_token(secret)
                    .map_err(|error| Failure::new(Some(401), error))?;
            }
            Err(ureq::Error::Status(401, _)) => {
                return Err(Failure::new(Some(401), microsoft::RECONNECT));
            }
            Err(ureq::Error::Status(status @ (429 | 503), response)) => {
                let header = response.header("Retry-After").map(str::to_string);
                let may_retry = status == 429 || matches!(method, Method::Get);
                match retry_delay(header.as_deref()) {
                    Some(wait) if may_retry && !retried => {
                        retried = true;
                        std::thread::sleep(wait);
                    }
                    _ => return Err(Failure::new(Some(status), busy_message(header.as_deref()))),
                }
            }
            Err(ureq::Error::Status(status, response)) => {
                let body = read_json(response).unwrap_or(Value::Null);
                return Err(Failure::new(Some(status), status_message(status, &body)));
            }
            Err(ureq::Error::Transport(error)) => {
                return Err(Failure::new(
                    None,
                    format!("Could not reach Microsoft Teams ({}).", error.kind()),
                ));
            }
        }
    }
}

fn read_json(response: ureq::Response) -> Result<Value, String> {
    let text = response
        .into_string()
        .map_err(|_| "Microsoft Teams returned an unreadable response.".to_string())?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text)
        .map_err(|_| "Microsoft Teams returned an unreadable response.".into())
}

/// Retry-After in whole seconds, only when short enough to wait inline.
pub(crate) fn retry_delay(header: Option<&str>) -> Option<Duration> {
    let seconds: u64 = header?.trim().parse().ok()?;
    let wait = Duration::from_secs(seconds.max(1));
    (wait <= MAX_RETRY_WAIT).then_some(wait)
}

fn busy_message(header: Option<&str>) -> String {
    match header.and_then(|value| value.trim().parse::<u64>().ok()) {
        Some(seconds) => format!("Microsoft Teams is busy. Try again in {seconds} seconds."),
        None => "Microsoft Teams is busy. Try again in a moment.".into(),
    }
}

pub(crate) fn status_message(status: u16, body: &Value) -> String {
    let detail = microsoft::sanitize_description(text(body, &["error", "message"]));
    let suffix = if detail.is_empty() {
        String::new()
    } else {
        format!(": {detail}")
    };
    match status {
        403 => format!(
            "Microsoft Teams denied access{suffix}. An administrator may need to grant consent for Chat.ReadWrite."
        ),
        404 => "This Teams chat was not found.".into(),
        _ => format!("Microsoft Teams request failed ({status}){suffix}."),
    }
}

/// Follows `@odata.nextLink` only on the Graph origin so the bearer token stays there.
pub(crate) fn next_link(page: &Value) -> Option<String> {
    let link = page.get("@odata.nextLink")?.as_str()?;
    let safe = link.starts_with(GRAPH_ORIGIN) && !link.chars().any(char::is_control);
    safe.then(|| link.to_string())
}

fn fetch_chats(
    secret: &mut Secret,
    limit: usize,
    with_members: bool,
) -> Result<Vec<Value>, Failure> {
    let expand = if with_members {
        "members,lastMessagePreview"
    } else {
        "lastMessagePreview"
    };
    let mut url = format!("{GRAPH}/me/chats?$expand={expand}&{ORDER_RECENT}&$top=50");
    let mut chats = Vec::new();
    for _ in 0..MAX_PAGES {
        let page = graph_raw(secret, Method::Get, &url, None)?;
        chats.extend(items(&page).iter().cloned());
        if chats.len() >= limit {
            break;
        }
        match next_link(&page) {
            Some(next) => url = next,
            None => break,
        }
    }
    Ok(chats)
}

// ---- Identity ----

fn identity(me: &Value) -> String {
    let name = text(me, &["displayName"]).trim();
    let address = [text(me, &["userPrincipalName"]), text(me, &["mail"])]
        .into_iter()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or("");
    match (name.is_empty(), address.is_empty()) {
        (false, false) => format!("{name} ({address})"),
        (false, true) => name.to_string(),
        (true, false) => address.to_string(),
        (true, true) => "Microsoft account".into(),
    }
}

fn store_user_id(secret: &mut Secret, id: &str) {
    if id.is_empty() {
        return;
    }
    if let Some(record) = secret.get_mut("microsoft").and_then(Value::as_object_mut) {
        record.insert("userId".into(), json!(id));
    }
}

/// The signed-in user's Graph id, cached in the secret after the first lookup.
fn me_id(secret: &mut Secret) -> Result<String, String> {
    let cached = secret
        .get("microsoft")
        .map(|record| text(record, &["userId"]))
        .unwrap_or("");
    if !cached.is_empty() {
        return Ok(cached.to_string());
    }
    let me = graph(secret, Method::Get, &format!("{GRAPH}/me?$select=id"), None)?;
    let id = text(&me, &["id"]).to_string();
    store_user_id(secret, &id);
    Ok(id)
}

// ---- Mapping ----

fn text<'a>(value: &'a Value, path: &[&str]) -> &'a str {
    path.iter()
        .try_fold(value, |current, key| current.get(key))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn items(page: &Value) -> &[Value] {
    page.get("value")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// Graph chat ids look like `19:…@thread.v2`, `19:…@unq.gbl.spaces` or `48:notes`.
pub(crate) fn valid_chat_id(id: &str) -> bool {
    (1..=256).contains(&id.len())
        && id.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'@' | b'.' | b'_' | b'-')
        })
}

/// Percent-encodes everything except RFC 3986 unreserved characters.
pub(crate) fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len() * 3);
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn chat_segment(thread_id: &str) -> Result<String, String> {
    if valid_chat_id(thread_id) {
        Ok(encode_segment(thread_id))
    } else {
        Err(INVALID_CHAT.into())
    }
}

pub(crate) fn iso_ms(value: Option<&Value>) -> Option<u64> {
    let parsed = time::OffsetDateTime::parse(
        value?.as_str()?,
        &time::format_description::well_known::Rfc3339,
    )
    .ok()?;
    u64::try_from(parsed.unix_timestamp_nanos() / 1_000_000)
        .ok()
        .filter(|ms| *ms > 0)
}

fn body_text(body: &Value) -> String {
    let content = text(body, &["content"]);
    if text(body, &["contentType"]).eq_ignore_ascii_case("html") {
        html::html_to_text(content)
    } else {
        html::plain_text(content)
    }
}

pub(crate) fn chat_to_thread(account_id: &str, me: &str, chat: &Value) -> Option<Thread> {
    let id = text(chat, &["id"]);
    if !valid_chat_id(id) {
        return None;
    }
    let preview = chat
        .get("lastMessagePreview")
        .filter(|value| value.is_object());
    let mut participants: Vec<String> = Vec::new();
    for member in chat
        .get("members")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = text(member, &["displayName"]).trim();
        let is_me = !me.is_empty() && text(member, &["userId"]) == me;
        if !is_me && !name.is_empty() && !participants.iter().any(|known| known == name) {
            participants.push(name.to_string());
        }
    }
    let sender = preview
        .filter(|preview| text(preview, &["from", "user", "id"]) != me || me.is_empty())
        .map(|preview| text(preview, &["from", "user", "displayName"]).trim())
        .filter(|name| !name.is_empty());
    if participants.is_empty() {
        participants.extend(sender.map(str::to_string));
    }
    participants.truncate(MAX_PARTICIPANTS);
    let topic = text(chat, &["topic"]).trim();
    let title = if !topic.is_empty() {
        topic.to_string()
    } else if !participants.is_empty() {
        let mut names = participants
            .iter()
            .take(MAX_TITLE_NAMES)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        if participants.len() > MAX_TITLE_NAMES {
            names.push_str(&format!(" +{}", participants.len() - MAX_TITLE_NAMES));
        }
        names
    } else if text(chat, &["chatType"]) == "meeting" {
        "Meeting chat".into()
    } else {
        "Chat".into()
    };
    let preview_text = preview
        .filter(|preview| preview.get("isDeleted").and_then(Value::as_bool) != Some(true))
        .and_then(|preview| preview.get("body"))
        .map(|body| html::single_line(&body_text(body), PREVIEW_CHARS))
        .unwrap_or_default();
    let updated_at = preview
        .and_then(|preview| iso_ms(preview.get("createdDateTime")))
        .or_else(|| iso_ms(chat.get("lastUpdatedDateTime")))
        .or_else(|| iso_ms(chat.get("createdDateTime")))
        .unwrap_or(0);
    let url = Some(text(chat, &["webUrl"]))
        .filter(|url| url.starts_with("https://"))
        .map(str::to_string);
    Some(Thread {
        id: id.to_string(),
        account_id: account_id.to_string(),
        provider: Provider::Teams,
        title,
        participants,
        preview: preview_text,
        updated_at,
        unread: false,
        url,
    })
}

pub(crate) fn graph_message(thread_id: &str, me: &str, item: &Value) -> Option<Message> {
    let kind = text(item, &["messageType"]);
    if !(kind.is_empty() || kind == "message") {
        return None;
    }
    if item
        .get("deletedDateTime")
        .is_some_and(|value| !value.is_null())
    {
        return None;
    }
    let id = text(item, &["id"]);
    if id.is_empty() {
        return None;
    }
    let user_id = text(item, &["from", "user", "id"]);
    let author = [
        text(item, &["from", "user", "displayName"]),
        text(item, &["from", "application", "displayName"]),
    ]
    .into_iter()
    .map(str::trim)
    .find(|name| !name.is_empty())
    .unwrap_or("Unknown")
    .to_string();
    let attachments = item
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|attachment| text(attachment, &["contentType"]) != "messageReference")
        .map(|attachment| Attachment {
            name: Some(text(attachment, &["name"]).trim())
                .filter(|name| !name.is_empty())
                .unwrap_or("Attachment")
                .to_string(),
            size: None,
        })
        .collect();
    Some(Message {
        id: id.to_string(),
        thread_id: thread_id.to_string(),
        author,
        author_address: None,
        body: item.get("body").map(body_text).unwrap_or_default(),
        at: iso_ms(item.get("createdDateTime")).unwrap_or(0),
        outbound: !me.is_empty() && user_id == me,
        attachments,
    })
}

#[cfg(test)]
#[path = "teams_tests.rs"]
mod tests;
