//! Email provider: IMAP (read-only, INBOX) and SMTP replies over rustls.
mod config;
mod imap;
mod mime;
mod net;
mod smtp;
mod threads;

use super::types::{now_ms, Account, Message, Provider, Secret, Thread};
use config::{Credential, EmailConfig};
use imap::{parse_internal_date, Fetched, Imap};
use serde_json::Value;
use smtp::Smtp;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use threads::{Mailbox, Summary, HEADER_FIELDS};

/// Messages scanned for thread_messages and reply; list_threads scans min(limit * 4, this).
const SCAN_MAX: u32 = 400;
const VERIFY_DEADLINE: Duration = Duration::from_secs(60);
const OPERATION_DEADLINE: Duration = Duration::from_secs(120);
const MAX_THREAD_MESSAGES: usize = 100;
const MAX_MESSAGE_BYTES: u64 = 2 * 1024 * 1024;
const PREVIEW_BYTES: usize = 8 * 1024;
const PREVIEW_CHARS: usize = 160;
const MAX_BODY_CHARS: usize = 200_000;

pub(crate) fn normalize_config(config: &Value) -> Result<Value, String> {
    Ok(EmailConfig::parse(config)?.to_value())
}

pub(crate) fn verify(config: &Value, secret: &mut Secret) -> Result<String, String> {
    let config = EmailConfig::parse(config)?;
    let credential = Credential::load(&config, secret)?;
    let deadline = Instant::now() + VERIFY_DEADLINE;
    let hint = config.sign_in_hint();
    let mut imap = Imap::connect(&config, deadline).map_err(incoming)?;
    imap.login(&credential, hint).map_err(incoming)?;
    imap.examine_inbox().map_err(incoming)?;
    imap.logout();
    let mut smtp = Smtp::connect(&config, deadline).map_err(outgoing)?;
    smtp.login(&credential, hint).map_err(outgoing)?;
    smtp.quit();
    Ok(config.address)
}

pub(crate) fn list_threads(
    account: &Account,
    secret: &mut Secret,
    limit: usize,
) -> Result<Vec<Thread>, String> {
    let window = (limit.saturating_mul(4) as u32).clamp(1, SCAN_MAX);
    let (config, mut imap) = signed_in(account, secret)?;
    let result = (|| {
        let scan = scan(&mut imap, window)?;
        let groups: Vec<_> = threads::group(&scan.summaries)
            .into_iter()
            .take(limit)
            .collect();
        let newest: Vec<usize> = groups
            .iter()
            .filter_map(|group| group.members.last().copied())
            .collect();
        let previews = previews(&mut imap, &scan, &newest);
        Ok(groups
            .iter()
            .map(|group| thread_view(account, &config, &scan.summaries, group, &previews))
            .collect())
    })();
    imap.logout();
    result.map_err(incoming)
}

pub(crate) fn thread_messages(
    account: &Account,
    secret: &mut Secret,
    thread_id: &str,
) -> Result<Vec<Message>, String> {
    let (config, mut imap) = signed_in(account, secret)?;
    let result = (|| {
        let scan = scan(&mut imap, SCAN_MAX)?;
        let mut members = threads::members_of(&scan.summaries, thread_id);
        if members.is_empty() {
            return Err(gone());
        }
        if members.len() > MAX_THREAD_MESSAGES {
            members.drain(..members.len() - MAX_THREAD_MESSAGES);
        }
        let uids: Vec<u32> = members
            .iter()
            .map(|index| scan.summaries[*index].uid)
            .collect();
        let fetched = imap.fetch(&format!(
            "UID FETCH {} (UID INTERNALDATE RFC822.SIZE BODY.PEEK[]<0.{MAX_MESSAGE_BYTES}>)",
            uid_set(&uids)
        ))?;
        let by_uid: HashMap<u32, &Fetched> = fetched
            .iter()
            .map(|message| (message.uid, message))
            .collect();
        let mut messages: Vec<(u32, Message)> = members
            .iter()
            .filter_map(|index| {
                let summary = &scan.summaries[*index];
                let message = by_uid.get(&summary.uid)?;
                Some((
                    summary.uid,
                    full_message(&config, thread_id, summary, message),
                ))
            })
            .collect();
        messages.sort_by_key(|(uid, message)| (message.at, *uid));
        Ok(messages.into_iter().map(|(_, message)| message).collect())
    })();
    imap.logout();
    result.map_err(incoming)
}

pub(crate) fn reply(
    account: &Account,
    secret: &mut Secret,
    thread_id: &str,
    body: &str,
) -> Result<Message, String> {
    let config = EmailConfig::parse(&account.config)?;
    let credential = Credential::load(&config, secret)?;
    let deadline = Instant::now() + OPERATION_DEADLINE;
    let parent = {
        let mut imap = Imap::connect(&config, deadline).map_err(incoming)?;
        let result = (|| {
            imap.login(&credential, config.sign_in_hint())?;
            let scan = scan(&mut imap, SCAN_MAX)?;
            let members = threads::members_of(&scan.summaries, thread_id);
            let own = |summary: &&Summary| is_own(&config, summary.from.as_ref());
            let parent = members
                .iter()
                .rev()
                .map(|index| &scan.summaries[*index])
                .find(|summary| !own(summary))
                .or_else(|| members.last().map(|index| &scan.summaries[*index]))
                .cloned();
            parent.ok_or_else(gone)
        })();
        imap.logout();
        result.map_err(incoming)?
    };
    let recipients = reply_recipients(&parent)?;
    let from = Mailbox {
        name: Some(config.display_name.clone()).filter(|name| !name.is_empty()),
        address: config.address.clone(),
    };
    let domain = config.address.rsplit('@').next().unwrap_or("localhost");
    let message_id = format!("{}@{domain}", uuid::Uuid::new_v4().simple());
    let references = mime::reply_references(&parent.references, parent.message_id.as_deref());
    let now = now_ms();
    let date = mime::rfc5322_date((now / 1000) as i64);
    let data = mime::build_reply(&mime::Reply {
        from: &from,
        to: &recipients,
        subject: &mime::reply_subject(&parent.subject),
        in_reply_to: parent.message_id.as_deref(),
        references: &references,
        message_id: &message_id,
        date: &date,
        body,
    });
    let addresses: Vec<String> = recipients
        .iter()
        .map(|mailbox| mailbox.address.clone())
        .collect();
    let mut smtp = Smtp::connect(&config, deadline).map_err(outgoing)?;
    smtp.login(&credential, config.sign_in_hint())
        .map_err(outgoing)?;
    smtp.send(&config.address, &addresses, &data)
        .map_err(outgoing)?;
    smtp.quit();
    Ok(Message {
        id: threads::message_key(Some(&message_id), 0),
        thread_id: thread_id.to_string(),
        author: from.label(),
        author_address: Some(config.address.clone()),
        body: body.to_string(),
        at: now,
        outbound: true,
        attachments: Vec::new(),
    })
}

fn incoming(error: String) -> String {
    format!("Incoming mail (IMAP): {error}")
}

fn outgoing(error: String) -> String {
    format!("Outgoing mail (SMTP): {error}")
}

fn gone() -> String {
    "This conversation is no longer in the inbox. Refresh the list.".into()
}

fn signed_in(account: &Account, secret: &mut Secret) -> Result<(EmailConfig, Imap), String> {
    let config = EmailConfig::parse(&account.config)?;
    let credential = Credential::load(&config, secret)?;
    let mut imap = Imap::connect(&config, Instant::now() + OPERATION_DEADLINE).map_err(incoming)?;
    // The scan opens INBOX (EXAMINE) itself.
    match imap.login(&credential, config.sign_in_hint()) {
        Ok(()) => Ok((config, imap)),
        Err(error) => {
            imap.logout();
            Err(incoming(error))
        }
    }
}

struct Scan {
    summaries: Vec<Summary>,
    /// Raw fetched header block per summary, reused for previews.
    headers: Vec<Vec<u8>>,
}

/// Header scan of the newest `window` messages. EXAMINE + BODY.PEEK never set \Seen.
fn scan(imap: &mut Imap, window: u32) -> Result<Scan, String> {
    let exists = imap.examine_inbox()?;
    if exists == 0 {
        return Ok(Scan {
            summaries: Vec::new(),
            headers: Vec::new(),
        });
    }
    let start = exists.saturating_sub(window.saturating_sub(1)).max(1);
    let fetched = imap.fetch(&format!(
        "FETCH {start}:{exists} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS ({HEADER_FIELDS})])"
    ))?;
    let mut summaries = Vec::with_capacity(fetched.len());
    let mut headers = Vec::with_capacity(fetched.len());
    for message in fetched {
        let header = message.section("BODY[HEADER").unwrap_or_default().to_vec();
        let internal = message
            .internal_date
            .as_deref()
            .and_then(parse_internal_date);
        let mut summary = threads::parse_headers(&header)
            .map(|parsed| threads::summarize(&parsed, message.uid, internal))
            .unwrap_or_else(|| Summary {
                uid: message.uid,
                at: internal
                    .filter(|secs| *secs > 0)
                    .map(|secs| secs as u64 * 1000)
                    .unwrap_or(0),
                ..Summary::default()
            });
        summary.seen = message.seen();
        summary.size = message.size;
        summaries.push(summary);
        headers.push(header);
    }
    Ok(Scan { summaries, headers })
}

/// Short previews for the given summaries from the first bytes of their text. Best effort.
fn previews(imap: &mut Imap, scan: &Scan, indexes: &[usize]) -> HashMap<u32, String> {
    if indexes.is_empty() {
        return HashMap::new();
    }
    let uids: Vec<u32> = indexes
        .iter()
        .map(|index| scan.summaries[*index].uid)
        .collect();
    let Ok(fetched) = imap.fetch(&format!(
        "UID FETCH {} (UID BODY.PEEK[TEXT]<0.{PREVIEW_BYTES}>)",
        uid_set(&uids)
    )) else {
        return HashMap::new();
    };
    let header_by_uid: HashMap<u32, &[u8]> = indexes
        .iter()
        .map(|index| (scan.summaries[*index].uid, scan.headers[*index].as_slice()))
        .collect();
    fetched
        .iter()
        .filter_map(|message| {
            let mut raw = header_by_uid.get(&message.uid)?.to_vec();
            raw.extend_from_slice(message.section("BODY[TEXT]")?);
            let parsed = threads::parse_headers(&raw)?;
            let preview = threads::preview_text(&mime::body_text(&parsed), PREVIEW_CHARS);
            (!preview.is_empty()).then_some((message.uid, preview))
        })
        .collect()
}

fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn is_own(config: &EmailConfig, from: Option<&Mailbox>) -> bool {
    from.is_some_and(|mailbox| mailbox.address.eq_ignore_ascii_case(&config.address))
}

fn thread_view(
    account: &Account,
    config: &EmailConfig,
    summaries: &[Summary],
    group: &threads::Group,
    previews: &HashMap<u32, String>,
) -> Thread {
    let members: Vec<&Summary> = group
        .members
        .iter()
        .map(|index| &summaries[*index])
        .collect();
    let newest = group.newest(summaries);
    let title = members
        .iter()
        .map(|summary| summary.subject.as_str())
        .find(|subject| !subject.is_empty())
        .unwrap_or("(no subject)")
        .to_string();
    let mut participants: Vec<String> = Vec::new();
    for summary in &members {
        if let Some(from) = &summary.from {
            let label = from.label();
            if !is_own(config, Some(from))
                && !participants.contains(&label)
                && participants.len() < 10
            {
                participants.push(label);
            }
        }
    }
    if participants.is_empty() {
        let own = Mailbox {
            name: Some(config.display_name.clone()).filter(|name| !name.is_empty()),
            address: config.address.clone(),
        };
        participants.push(own.label());
    }
    Thread {
        id: group.id.clone(),
        account_id: account.id.clone(),
        provider: Provider::Email,
        title,
        participants,
        preview: previews
            .get(&newest.uid)
            .cloned()
            .unwrap_or_else(|| newest.subject.clone()),
        updated_at: newest.at,
        unread: members.iter().any(|summary| !summary.seen),
        url: None,
    }
}

fn full_message(
    config: &EmailConfig,
    thread_id: &str,
    summary: &Summary,
    fetched: &Fetched,
) -> Message {
    let raw = fetched.section("BODY[]").unwrap_or_default();
    let parsed = threads::parse_headers(raw);
    let complete = fetched
        .size
        .or(summary.size)
        .is_some_and(|size| size <= MAX_MESSAGE_BYTES);
    let mut body = parsed.as_ref().map(mime::body_text).unwrap_or_default();
    if body.chars().count() > MAX_BODY_CHARS {
        body = body.chars().take(MAX_BODY_CHARS).collect::<String>() + "\n…";
    }
    if !complete {
        body.push_str("\n\n[This message is large; only the beginning is shown.]");
    }
    let attachments = parsed
        .as_ref()
        .map(|parsed| mime::attachments(parsed, complete))
        .unwrap_or_default();
    Message {
        id: threads::message_key(summary.message_id.as_deref(), summary.uid),
        thread_id: thread_id.to_string(),
        author: summary
            .from
            .as_ref()
            .map(Mailbox::label)
            .unwrap_or_else(|| "Unknown sender".into()),
        author_address: summary.from.as_ref().map(|from| from.address.clone()),
        body,
        at: summary.at,
        outbound: is_own(config, summary.from.as_ref()),
        attachments,
    }
}

/// Reply-To, else From, de-duplicated and checked so no address can inject SMTP commands.
fn reply_recipients(parent: &Summary) -> Result<Vec<Mailbox>, String> {
    let candidates = if parent.reply_to.is_empty() {
        parent.from.iter().cloned().collect::<Vec<_>>()
    } else {
        parent.reply_to.clone()
    };
    let mut recipients: Vec<Mailbox> = Vec::new();
    for mailbox in candidates {
        if !config::valid_address(&mailbox.address) {
            continue;
        }
        if !recipients
            .iter()
            .any(|existing| existing.address.eq_ignore_ascii_case(&mailbox.address))
        {
            recipients.push(mailbox);
        }
    }
    if recipients.is_empty() {
        return Err("This conversation has no address to reply to.".into());
    }
    Ok(recipients)
}

#[cfg(test)]
#[path = "email_tests.rs"]
mod tests;
