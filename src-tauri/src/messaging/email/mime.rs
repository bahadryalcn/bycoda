//! Plain-text extraction from parsed mail and RFC 5322 reply construction.
use super::threads::Mailbox;
use crate::messaging::types::Attachment;
use base64::Engine as _;
use mail_parser::{Message as Parsed, MimeHeaders, PartType};

/// Converts HTML to readable plain text: drops scripts, styles and comments, decodes
/// entities and keeps block structure as line breaks. Never returns markup.
pub(super) fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut rest = html;
    let mut pre = 0usize;
    let mut links: Vec<(usize, Option<String>)> = Vec::new();
    while !rest.is_empty() {
        let Some(open) = rest.find('<') else {
            push_text(&mut out, rest, pre > 0);
            break;
        };
        push_text(&mut out, &rest[..open], pre > 0);
        rest = &rest[open..];
        if let Some(after) = rest.strip_prefix("<!--") {
            rest = after.find("-->").map(|end| &after[end + 3..]).unwrap_or("");
            continue;
        }
        let Some(close) = tag_end(rest) else {
            // A stray `<` that never closes is text.
            push_text(&mut out, rest, pre > 0);
            break;
        };
        let tag = &rest[1..close];
        rest = &rest[close + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        match name.as_str() {
            "script" | "style" | "head" | "title" | "template" | "noscript" if !closing => {
                let end_tag = format!("</{name}");
                rest = find_ci(rest, &end_tag)
                    .map(|index| {
                        let after = &rest[index..];
                        after.find('>').map(|gt| &after[gt + 1..]).unwrap_or("")
                    })
                    .unwrap_or("");
            }
            "br" => out.push('\n'),
            "p" | "div" | "tr" | "table" | "ul" | "ol" | "h1" | "h2" | "h3" | "h4" | "h5"
            | "h6" | "blockquote" | "section" | "article" | "header" | "footer" | "dl" | "dt"
            | "dd" => {
                newline(&mut out);
            }
            "hr" => {
                newline(&mut out);
                out.push_str("---\n");
            }
            "li" if !closing => {
                newline(&mut out);
                out.push_str("- ");
            }
            "td" | "th" if !closing => {
                if !out.ends_with(['\n', ' ']) && !out.is_empty() {
                    out.push(' ');
                }
            }
            "pre" => {
                newline(&mut out);
                pre = if closing {
                    pre.saturating_sub(1)
                } else {
                    pre + 1
                };
            }
            "a" if !closing => links.push((
                out.len(),
                attribute(tag, "href").map(|href| decode_entities(&href)),
            )),
            "a" => {
                if let Some((start, href)) = links.pop() {
                    close_link(&mut out, start, href);
                }
            }
            "img" if !closing => {
                if let Some(alt) = attribute(tag, "alt").filter(|alt| !alt.trim().is_empty()) {
                    push_text(&mut out, &alt, false);
                }
            }
            _ => {}
        }
    }
    while let Some((start, href)) = links.pop() {
        close_link(&mut out, start, href);
    }
    tidy(&out)
}

/// Appends ` <url>` after link text when the text does not already show the URL.
fn close_link(out: &mut String, start: usize, href: Option<String>) {
    let Some(href) = href.map(|href| href.trim().to_string()) else {
        return;
    };
    if !(href.starts_with("http://") || href.starts_with("https://")) {
        return;
    }
    let text = out.get(start..).unwrap_or("");
    if text.trim().is_empty() {
        out.push_str(&href);
    } else if !text.contains(&href) {
        out.push_str(&format!(" <{href}>"));
    }
}

fn tag_end(input: &str) -> Option<usize> {
    let mut quote = None;
    for (index, c) in input.char_indices().skip(1) {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(index),
            _ => {}
        }
    }
    None
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    let lower = haystack.to_ascii_lowercase();
    lower.find(&needle.to_ascii_lowercase())
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find(name) {
        let start = search + found;
        search = start + name.len();
        let boundary = start == 0 || lower.as_bytes()[start - 1].is_ascii_whitespace();
        let after = lower[search..].trim_start();
        if !boundary || !after.starts_with('=') {
            continue;
        }
        let value_start = tag.len() - after.len() + 1;
        let value = tag[value_start..].trim_start();
        return Some(match value.chars().next() {
            Some(q @ ('"' | '\'')) => value[1..].split(q).next().unwrap_or("").to_string(),
            _ => value
                .split(|c: char| c.is_whitespace() || c == '>')
                .next()
                .unwrap_or("")
                .to_string(),
        });
    }
    None
}

fn newline(out: &mut String) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}

fn push_text(out: &mut String, raw: &str, preformatted: bool) {
    let decoded = decode_entities(raw);
    if preformatted {
        out.push_str(&decoded);
        return;
    }
    for c in decoded.chars() {
        if c.is_whitespace() && c != '\u{a0}' {
            if !out.is_empty() && !out.ends_with([' ', '\n']) {
                out.push(' ');
            }
        } else {
            out.push(if c == '\u{a0}' { ' ' } else { c });
        }
    }
}

/// Trims each line and collapses runs of blank lines to one.
fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = 0;
    for line in text.lines() {
        let line = line.trim_end_matches([' ', '\t']);
        if line.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

pub(super) fn decode_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let end = rest[1..]
            .find(|c: char| c == ';' || c == '&' || c.is_whitespace())
            .map(|i| i + 1);
        let decoded = end
            .filter(|end| rest.as_bytes().get(*end) == Some(&b';') && *end <= 12)
            .and_then(|end| entity(&rest[1..end]).map(|c| (c, end)));
        match decoded {
            Some((c, end)) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity(name: &str) -> Option<char> {
    if let Some(number) = name.strip_prefix('#') {
        let code = match number.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => number.parse().ok()?,
        };
        return char::from_u32(code).filter(|c| *c != '\0');
    }
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "hellip" => '…',
        "mdash" => '—',
        "ndash" => '–',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "laquo" => '«',
        "raquo" => '»',
        "bull" => '•',
        "middot" => '·',
        "euro" => '€',
        "pound" => '£',
        "yen" => '¥',
        "cent" => '¢',
        "deg" => '°',
        "times" => '×',
        "zwnj" => '\u{200c}',
        "zwj" => '\u{200d}',
        "shy" => '\u{ad}',
        _ => return None,
    })
}

/// The readable body: text/plain parts, else HTML converted to text.
pub(super) fn body_text(parsed: &Parsed) -> String {
    let mut texts = Vec::new();
    for part in parsed.text_bodies() {
        match &part.body {
            PartType::Text(text) => texts.push(text.replace("\r\n", "\n")),
            PartType::Html(html) => texts.push(html_to_text(html)),
            _ => {}
        }
    }
    if texts.iter().all(|text| text.trim().is_empty()) {
        texts = parsed
            .html_bodies()
            .filter_map(|part| match &part.body {
                PartType::Html(html) => Some(html_to_text(html)),
                _ => None,
            })
            .collect();
    }
    texts.join("\n\n").trim_end().to_string()
}

/// Attachment names and decoded sizes; sizes only when the message was fetched whole.
pub(super) fn attachments(parsed: &Parsed, complete: bool) -> Vec<Attachment> {
    parsed
        .attachments()
        .filter(|part| {
            !matches!(part.body, PartType::Message(_)) || part.attachment_name().is_some()
        })
        .map(|part| Attachment {
            name: part
                .attachment_name()
                .map(str::to_string)
                .unwrap_or_else(|| "attachment".to_string()),
            size: complete.then(|| part.len() as u64),
        })
        .collect()
}

/// Replaces control-character runs with one space so header values cannot inject new lines.
fn header_safe(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        if !c.is_control() {
            out.push(c);
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim().to_string()
}

/// RFC 2047 encoded words (UTF-8, base64), each at most 75 characters.
fn encode_words(value: &str) -> String {
    let mut words = Vec::new();
    let mut chunk = String::new();
    for c in value.chars() {
        if chunk.len() + c.len_utf8() > 45 {
            words.push(std::mem::take(&mut chunk));
        }
        chunk.push(c);
    }
    if !chunk.is_empty() {
        words.push(chunk);
    }
    words
        .iter()
        .map(|word| {
            format!(
                "=?UTF-8?B?{}?=",
                base64::engine::general_purpose::STANDARD.encode(word)
            )
        })
        .collect::<Vec<_>>()
        .join("\r\n ")
}

/// Unstructured header text (Subject): ASCII as is, otherwise encoded words.
pub(super) fn encode_text(value: &str) -> String {
    let value = header_safe(value);
    if value.is_ascii() && value.len() <= 900 {
        value
    } else {
        encode_words(&value)
    }
}

/// `Name <address>` with the display name quoted or encoded as needed.
pub(super) fn format_mailbox(mailbox: &Mailbox) -> String {
    let address = header_safe(&mailbox.address);
    let Some(name) = mailbox
        .name
        .as_deref()
        .map(header_safe)
        .filter(|name| !name.is_empty())
    else {
        return format!("<{address}>");
    };
    if !name.is_ascii() {
        return format!("{} <{address}>", encode_words(&name));
    }
    let atom = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || "!#$%&'*+-/=?^_`{|}~".contains(c));
    if atom {
        format!("{name} <{address}>")
    } else {
        format!(
            "\"{}\" <{address}>",
            name.replace('\\', "\\\\").replace('"', "\\\"")
        )
    }
}

/// `Re: subject` without stacking prefixes.
pub(super) fn reply_subject(subject: &str) -> String {
    let subject = subject.trim();
    let lower = subject.to_ascii_lowercase();
    if lower.starts_with("re:") || lower.starts_with("re[") || lower.starts_with("re :") {
        return subject.to_string();
    }
    if subject.is_empty() {
        "Re:".to_string()
    } else {
        format!("Re: {subject}")
    }
}

/// References for a reply: the parent's chain plus the parent, capped to keep the first id.
pub(super) fn reply_references(
    parent_references: &[String],
    parent_id: Option<&str>,
) -> Vec<String> {
    let mut references: Vec<String> = parent_references.to_vec();
    if let Some(id) = parent_id {
        if !references.iter().any(|existing| existing == id) {
            references.push(id.to_string());
        }
    }
    if references.len() > 20 {
        let first = references[0].clone();
        let tail = references.split_off(references.len() - 19);
        references = std::iter::once(first).chain(tail).collect();
    }
    references
}

/// RFC 5322 date for a Unix time in UTC.
pub(super) fn rfc5322_date(unix_secs: i64) -> String {
    let date = time::OffsetDateTime::from_unix_timestamp(unix_secs)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    const DAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{}, {:02} {} {} {:02}:{:02}:{:02} +0000",
        DAYS[date.weekday().number_days_from_monday() as usize],
        date.day(),
        MONTHS[date.month() as usize - 1],
        date.year(),
        date.hour(),
        date.minute(),
        date.second()
    )
}

pub(super) struct Reply<'a> {
    pub from: &'a Mailbox,
    pub to: &'a [Mailbox],
    pub subject: &'a str,
    pub in_reply_to: Option<&'a str>,
    pub references: &'a [String],
    pub message_id: &'a str,
    pub date: &'a str,
    pub body: &'a str,
}

/// Builds the reply as CRLF text; the body is 7bit when plain ASCII, else base64 UTF-8.
pub(super) fn build_reply(reply: &Reply) -> Vec<u8> {
    let mut out = String::new();
    let mut header = |name: &str, value: &str| {
        out.push_str(name);
        out.push_str(": ");
        out.push_str(value);
        out.push_str("\r\n");
    };
    header("Date", reply.date);
    header("From", &format_mailbox(reply.from));
    header(
        "To",
        &reply
            .to
            .iter()
            .map(format_mailbox)
            .collect::<Vec<_>>()
            .join(",\r\n "),
    );
    header("Subject", &encode_text(reply.subject));
    header(
        "Message-ID",
        &format!("<{}>", header_safe(reply.message_id)),
    );
    if let Some(parent) = reply.in_reply_to {
        header("In-Reply-To", &format!("<{}>", header_safe(parent)));
    }
    if !reply.references.is_empty() {
        let refs: Vec<String> = reply
            .references
            .iter()
            .map(|id| format!("<{}>", header_safe(id)))
            .collect();
        header("References", &refs.join("\r\n "));
    }
    header("MIME-Version", "1.0");
    header("Content-Type", "text/plain; charset=utf-8");
    let body = reply.body.replace("\r\n", "\n").replace('\r', "\n");
    let seven_bit = body.is_ascii() && body.lines().all(|line| line.len() <= 990);
    if seven_bit {
        header("Content-Transfer-Encoding", "7bit");
        out.push_str("\r\n");
        out.push_str(&body.replace('\n', "\r\n"));
    } else {
        header("Content-Transfer-Encoding", "base64");
        out.push_str("\r\n");
        let encoded = base64::engine::general_purpose::STANDARD.encode(body.replace('\n', "\r\n"));
        for line in encoded.as_bytes().chunks(76) {
            out.push_str(std::str::from_utf8(line).unwrap_or_default());
            out.push_str("\r\n");
        }
    }
    if !out.ends_with("\r\n") {
        out.push_str("\r\n");
    }
    out.into_bytes()
}

#[cfg(test)]
#[path = "mime_tests.rs"]
mod tests;
