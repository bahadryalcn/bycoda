//! Header summaries and conversation grouping by References / In-Reply-To roots.
use mail_parser::{Address, HeaderValue, Message as Parsed, MessageParser};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Header fields fetched for every scanned message.
pub(super) const HEADER_FIELDS: &str =
    "MESSAGE-ID IN-REPLY-TO REFERENCES SUBJECT FROM REPLY-TO TO CC DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Mailbox {
    pub name: Option<String>,
    pub address: String,
}

impl Mailbox {
    pub(super) fn label(&self) -> String {
        self.name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| self.address.clone())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Summary {
    pub uid: u32,
    pub message_id: Option<String>,
    pub in_reply_to: Vec<String>,
    pub references: Vec<String>,
    pub subject: String,
    pub from: Option<Mailbox>,
    pub reply_to: Vec<Mailbox>,
    /// Milliseconds since the epoch (INTERNALDATE, else Date).
    pub at: u64,
    pub seen: bool,
    pub size: Option<u64>,
}

fn clean_id(raw: &str) -> Option<String> {
    let id = raw
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim();
    (!id.is_empty() && !id.chars().any(char::is_whitespace)).then(|| id.to_string())
}

fn ids(value: &HeaderValue) -> Vec<String> {
    match value {
        HeaderValue::Text(text) => text.split_whitespace().filter_map(clean_id).collect(),
        HeaderValue::TextList(list) => list.iter().filter_map(|id| clean_id(id)).collect(),
        _ => Vec::new(),
    }
}

pub(super) fn mailboxes(address: Option<&Address>) -> Vec<Mailbox> {
    let Some(address) = address else {
        return Vec::new();
    };
    address
        .iter()
        .filter_map(|addr| {
            let email = addr.address()?.trim();
            (!email.is_empty()).then(|| Mailbox {
                name: addr
                    .name()
                    .map(|name| name.trim().to_string())
                    .filter(|name| !name.is_empty()),
                address: email.to_string(),
            })
        })
        .collect()
}

/// Reads the threading and display fields of a parsed message (headers or full).
pub(super) fn summarize(parsed: &Parsed, uid: u32, internal_date_secs: Option<i64>) -> Summary {
    let date_secs = internal_date_secs.or_else(|| parsed.date().map(|date| date.to_timestamp()));
    Summary {
        uid,
        message_id: parsed.message_id().and_then(clean_id),
        in_reply_to: ids(parsed.in_reply_to()),
        references: ids(parsed.references()),
        subject: parsed
            .subject()
            .map(|subject| subject.trim().to_string())
            .unwrap_or_default(),
        from: mailboxes(parsed.from()).into_iter().next(),
        reply_to: mailboxes(parsed.reply_to()),
        at: date_secs
            .filter(|secs| *secs > 0)
            .map(|secs| secs as u64 * 1000)
            .unwrap_or(0),
        seen: true,
        size: None,
    }
}

pub(super) fn parse_headers(raw: &[u8]) -> Option<Parsed<'_>> {
    MessageParser::default().parse(raw)
}

/// Lower-cased subject without reply/forward prefixes and list tags, for fallback grouping.
pub(super) fn normalize_subject(subject: &str) -> String {
    let mut rest = subject.trim();
    loop {
        let before = rest;
        if rest.starts_with('[') {
            if let Some(end) = rest.find(']') {
                rest = rest[end + 1..].trim_start();
            }
        }
        if let Some(colon) = rest.find(':') {
            let prefix = rest[..colon].trim().to_ascii_lowercase();
            let base = prefix.split('[').next().unwrap_or("").trim();
            if colon <= 8
                && matches!(
                    base,
                    "re" | "fw" | "fwd" | "aw" | "wg" | "sv" | "vs" | "tr" | "ynt" | "ilt"
                )
            {
                rest = rest[colon + 1..].trim_start();
            }
        }
        if rest == before {
            break;
        }
    }
    rest.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Root key from the message's own headers: first reference, else In-Reply-To, else itself.
fn own_root(summary: &Summary) -> String {
    if let Some(id) = summary
        .references
        .first()
        .or(summary.in_reply_to.first())
        .or(summary.message_id.as_ref())
    {
        return format!("id:{id}");
    }
    format!("subject:{}", normalize_subject(&summary.subject))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn thread_id(key: &str) -> String {
    format!("e:{}", &hex(&Sha256::digest(key.as_bytes()))[..32])
}

/// Stable opaque message id: hashed Message-ID, else the UID.
pub(super) fn message_key(message_id: Option<&str>, uid: u32) -> String {
    match message_id {
        Some(id) => format!("m:{}", &hex(&Sha256::digest(id.as_bytes()))[..24]),
        None => format!("u:{uid}"),
    }
}

/// For each summary, the chain of root keys from its own root to the resolved one. A reply
/// that only names its parent (In-Reply-To) follows that parent's root when it is in the scan.
pub(super) fn root_chains(summaries: &[Summary]) -> Vec<Vec<String>> {
    let roots: HashMap<String, String> = summaries
        .iter()
        .filter_map(|summary| {
            Some((
                format!("id:{}", summary.message_id.as_ref()?),
                own_root(summary),
            ))
        })
        .collect();
    summaries
        .iter()
        .map(|summary| {
            let mut chain = vec![own_root(summary)];
            while chain.len() < 32 {
                let Some(next) = roots.get(chain.last().expect("chain is never empty")) else {
                    break;
                };
                if chain.contains(next) {
                    break;
                }
                chain.push(next.clone());
            }
            chain
        })
        .collect()
}

/// A conversation: the resolved thread id and member indexes, oldest first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Group {
    pub id: String,
    pub members: Vec<usize>,
}

impl Group {
    pub(super) fn newest<'a>(&self, summaries: &'a [Summary]) -> &'a Summary {
        &summaries[*self.members.last().expect("groups are never empty")]
    }
}

fn order(summaries: &[Summary], a: usize, b: usize) -> std::cmp::Ordering {
    (summaries[a].at, summaries[a].uid).cmp(&(summaries[b].at, summaries[b].uid))
}

/// Groups summaries into conversations, newest conversation first.
pub(super) fn group(summaries: &[Summary]) -> Vec<Group> {
    let chains = root_chains(summaries);
    let mut by_key: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, chain) in chains.iter().enumerate() {
        by_key
            .entry(chain.last().expect("chain is never empty").clone())
            .or_default()
            .push(index);
    }
    let mut groups: Vec<Group> = by_key
        .into_iter()
        .map(|(key, mut members)| {
            members.sort_by(|a, b| order(summaries, *a, *b));
            Group {
                id: thread_id(&key),
                members,
            }
        })
        .collect();
    groups.sort_by(|a, b| {
        let (a_last, b_last) = (
            *a.members.last().unwrap_or(&0),
            *b.members.last().unwrap_or(&0),
        );
        order(summaries, b_last, a_last).then_with(|| a.id.cmp(&b.id))
    });
    groups
}

/// Member indexes of `thread_id`, matching any key on a message's chain so the id stays
/// valid when a different scan window resolves a root further.
pub(super) fn members_of(summaries: &[Summary], thread_id_value: &str) -> Vec<usize> {
    let chains = root_chains(summaries);
    let mut members: Vec<usize> = chains
        .iter()
        .enumerate()
        .filter(|(_, chain)| chain.iter().any(|key| thread_id(key) == thread_id_value))
        .map(|(index, _)| index)
        .collect();
    members.sort_by(|a, b| order(summaries, *a, *b));
    members
}

/// Whitespace-collapsed, length-capped preview text.
pub(super) fn preview_text(body: &str, max_chars: usize) -> String {
    let meaningful = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('>'))
        .take_while(|line| !(line.starts_with("On ") && line.ends_with("wrote:")))
        .collect::<Vec<_>>()
        .join(" ");
    let collapsed = meaningful.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = collapsed.chars().take(max_chars).collect();
    if collapsed.chars().count() > max_chars {
        out.push('…');
    }
    out
}

#[cfg(test)]
#[path = "threads_tests.rs"]
mod tests;
