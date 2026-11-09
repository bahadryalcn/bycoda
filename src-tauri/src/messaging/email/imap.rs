//! Minimal read-only IMAP4rev1 client: sign-in, EXAMINE and FETCH with literal parsing.
use super::config::{sasl_plain, xoauth2, Credential, EmailConfig, Security};
use super::net::Conn;
use std::time::Instant;

const MAX_LINE: usize = 1024 * 1024;
const MAX_LITERAL: usize = 8 * 1024 * 1024;
/// Cap on all untagged data for one command, so a hostile server cannot exhaust memory.
const MAX_RESPONSE: usize = 96 * 1024 * 1024;

/// One parsed IMAP data item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Item {
    Atom(String),
    Bytes(Vec<u8>),
    List(Vec<Item>),
    Nil,
}

impl Item {
    fn atom(&self) -> Option<&str> {
        match self {
            Item::Atom(atom) => Some(atom),
            _ => None,
        }
    }
}

/// Parses a complete response (literals inline after their `{n}` marker) into items.
pub(super) fn parse_items(input: &[u8]) -> Result<Vec<Item>, String> {
    let mut pos = 0;
    let items = parse_list(input, &mut pos, false)?;
    Ok(items)
}

fn parse_list(input: &[u8], pos: &mut usize, nested: bool) -> Result<Vec<Item>, String> {
    let mut items = Vec::new();
    loop {
        while *pos < input.len() && matches!(input[*pos], b' ' | b'\r' | b'\n') {
            *pos += 1;
        }
        let Some(&byte) = input.get(*pos) else {
            return if nested {
                Err("Unterminated IMAP list.".into())
            } else {
                Ok(items)
            };
        };
        match byte {
            b'(' => {
                *pos += 1;
                items.push(Item::List(parse_list(input, pos, true)?));
            }
            b')' => {
                *pos += 1;
                if nested {
                    return Ok(items);
                }
            }
            b'"' => items.push(Item::Bytes(parse_quoted(input, pos)?)),
            b'{' => items.push(Item::Bytes(parse_literal(input, pos)?)),
            _ => {
                let atom = parse_atom(input, pos);
                if atom.eq_ignore_ascii_case("NIL") {
                    items.push(Item::Nil);
                } else {
                    items.push(Item::Atom(atom));
                }
            }
        }
    }
}

fn parse_quoted(input: &[u8], pos: &mut usize) -> Result<Vec<u8>, String> {
    *pos += 1;
    let mut out = Vec::new();
    while let Some(&byte) = input.get(*pos) {
        *pos += 1;
        match byte {
            b'"' => return Ok(out),
            b'\\' => {
                if let Some(&escaped) = input.get(*pos) {
                    out.push(escaped);
                    *pos += 1;
                }
            }
            _ => out.push(byte),
        }
    }
    Err("Unterminated IMAP string.".into())
}

fn parse_literal(input: &[u8], pos: &mut usize) -> Result<Vec<u8>, String> {
    let close = input[*pos..]
        .iter()
        .position(|byte| *byte == b'}')
        .ok_or("Malformed IMAP literal.")?;
    let digits = std::str::from_utf8(&input[*pos + 1..*pos + close])
        .map_err(|_| "Malformed IMAP literal.")?
        .trim_end_matches('+');
    let len: usize = digits.parse().map_err(|_| "Malformed IMAP literal.")?;
    let mut start = *pos + close + 1;
    if input.get(start) == Some(&b'\r') {
        start += 1;
    }
    if input.get(start) == Some(&b'\n') {
        start += 1;
    }
    let end = start
        .checked_add(len)
        .filter(|end| *end <= input.len())
        .ok_or("Truncated IMAP literal.")?;
    *pos = end;
    Ok(input[start..end].to_vec())
}

/// Atoms may carry a bracketed section with spaces, e.g. `BODY[HEADER.FIELDS (SUBJECT)]<0>`.
fn parse_atom(input: &[u8], pos: &mut usize) -> String {
    let start = *pos;
    let mut depth = 0usize;
    while let Some(&byte) = input.get(*pos) {
        match byte {
            b'[' => depth += 1,
            b']' => depth = depth.saturating_sub(1),
            b' ' | b'(' | b')' | b'\r' | b'\n' if depth == 0 => break,
            b'\r' | b'\n' => break,
            _ => {}
        }
        *pos += 1;
    }
    String::from_utf8_lossy(&input[start..*pos]).into_owned()
}

/// Returns the literal length when a response line ends with `{n}` or `{n+}`.
pub(super) fn literal_len(line: &[u8]) -> Option<usize> {
    let line = line.strip_suffix(b"}")?;
    let open = line.iter().rposition(|byte| *byte == b'{')?;
    let digits = std::str::from_utf8(&line[open + 1..])
        .ok()?
        .trim_end_matches('+');
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Message data from one `* n FETCH (...)` response.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Fetched {
    pub uid: u32,
    pub flags: Vec<String>,
    pub internal_date: Option<String>,
    pub size: Option<u64>,
    /// Body sections by upper-cased name, e.g. `BODY[TEXT]<0>`.
    pub sections: Vec<(String, Vec<u8>)>,
}

impl Fetched {
    pub(super) fn seen(&self) -> bool {
        self.flags
            .iter()
            .any(|flag| flag.eq_ignore_ascii_case("\\Seen"))
    }

    /// The first section whose name starts with `prefix` (`BODY[HEADER`, `BODY[TEXT]`, `BODY[]`).
    pub(super) fn section(&self, prefix: &str) -> Option<&[u8]> {
        self.sections
            .iter()
            .find(|(name, _)| name.starts_with(prefix))
            .map(|(_, bytes)| bytes.as_slice())
    }
}

pub(super) fn parse_fetch(items: &[Item]) -> Option<Fetched> {
    let fetch = items.get(2)?.atom()?;
    if items.first()?.atom()? != "*" || !fetch.eq_ignore_ascii_case("FETCH") {
        return None;
    }
    let Some(Item::List(attributes)) = items.get(3) else {
        return None;
    };
    let mut fetched = Fetched::default();
    for pair in attributes.chunks(2) {
        let (Some(key), Some(value)) = (pair[0].atom(), pair.get(1)) else {
            continue;
        };
        let key = key.to_ascii_uppercase();
        match (key.as_str(), value) {
            ("UID", Item::Atom(uid)) => fetched.uid = uid.parse().unwrap_or(0),
            ("FLAGS", Item::List(flags)) => {
                fetched.flags = flags
                    .iter()
                    .filter_map(Item::atom)
                    .map(str::to_string)
                    .collect();
            }
            ("INTERNALDATE", Item::Bytes(date)) => {
                fetched.internal_date = Some(String::from_utf8_lossy(date).into_owned());
            }
            ("RFC822.SIZE", Item::Atom(size)) => fetched.size = size.parse().ok(),
            (key, Item::Bytes(body)) if key.starts_with("BODY[") => {
                fetched.sections.push((key.to_string(), body.clone()));
            }
            _ => {}
        }
    }
    (fetched.uid != 0).then_some(fetched)
}

/// Seconds since the epoch for an INTERNALDATE such as `17-Jul-1996 02:44:25 -0700`.
pub(super) fn parse_internal_date(value: &str) -> Option<i64> {
    let mut parts = value.split_whitespace();
    let date = parts.next()?;
    let time = parts.next()?;
    let zone = parts.next()?;
    let mut date_parts = date.split('-');
    let day: i64 = date_parts.next()?.parse().ok()?;
    let month = date_parts.next()?.to_ascii_lowercase();
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ]
    .iter()
    .position(|name| *name == month)? as i64
        + 1;
    let mut clock = time.split(':').map(|part| part.parse::<i64>().ok());
    let (hour, minute, second) = (clock.next()??, clock.next()??, clock.next()??);
    if zone.len() != 5 {
        return None;
    }
    let sign = match &zone[..1] {
        "+" => 1,
        "-" => -1,
        _ => return None,
    };
    let offset =
        sign * (zone[1..3].parse::<i64>().ok()? * 3600 + zone[3..5].parse::<i64>().ok()? * 60);
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Removes control characters and caps the length of server text shown to the user.
pub(super) fn server_text(raw: &str) -> String {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    let mut out: String = trimmed.chars().take(200).collect();
    if trimmed.chars().count() > 200 {
        out.push('…');
    }
    out
}

pub(super) struct Imap {
    conn: Conn,
    tag: u32,
    capabilities: Vec<String>,
    host: String,
}

struct Tagged {
    ok: bool,
    text: String,
}

impl Imap {
    pub(super) fn connect(config: &EmailConfig, deadline: Instant) -> Result<Self, String> {
        let server = &config.imap;
        let tls = server.security == Security::Tls;
        let conn = Conn::connect(&server.host, server.port, tls, deadline)?;
        let mut imap = Imap {
            conn,
            tag: 0,
            capabilities: Vec::new(),
            host: server.host.clone(),
        };
        let greeting = String::from_utf8_lossy(&imap.conn.read_line(MAX_LINE)?).into_owned();
        if !greeting.starts_with("* OK") && !greeting.starts_with("* PREAUTH") {
            return Err(format!(
                "{} is not an IMAP server or refused the connection.",
                imap.host
            ));
        }
        imap.refresh_capabilities()?;
        if server.security == Security::StartTls {
            if !imap.has_capability("STARTTLS") {
                return Err(format!(
                    "{} does not offer STARTTLS on this port. Try TLS on port 993.",
                    imap.host
                ));
            }
            let reply = imap.command("STARTTLS", &mut |_| Ok(()))?;
            if !reply.ok {
                return Err(format!(
                    "{} refused STARTTLS: {}",
                    imap.host,
                    server_text(&reply.text)
                ));
            }
            imap.conn.start_tls()?;
            imap.refresh_capabilities()?;
        }
        Ok(imap)
    }

    /// Wraps an already greeted connection (loopback tests only; production always uses TLS).
    #[cfg(test)]
    pub(super) fn from_conn(conn: Conn, capabilities: &[&str]) -> Self {
        Imap {
            conn,
            tag: 0,
            capabilities: capabilities.iter().map(|cap| cap.to_string()).collect(),
            host: "127.0.0.1".into(),
        }
    }

    fn has_capability(&self, name: &str) -> bool {
        self.capabilities
            .iter()
            .any(|cap| cap.eq_ignore_ascii_case(name))
    }

    fn refresh_capabilities(&mut self) -> Result<(), String> {
        let mut capabilities = Vec::new();
        let reply = self.command("CAPABILITY", &mut |items| {
            if items
                .get(1)
                .and_then(Item::atom)
                .is_some_and(|atom| atom.eq_ignore_ascii_case("CAPABILITY"))
            {
                capabilities.extend(items[2..].iter().filter_map(Item::atom).map(str::to_string));
            }
            Ok(())
        })?;
        if !reply.ok {
            return Err(format!(
                "{} rejected CAPABILITY: {}",
                self.host,
                server_text(&reply.text)
            ));
        }
        self.capabilities = capabilities;
        Ok(())
    }

    pub(super) fn login(&mut self, credential: &Credential, hint: &str) -> Result<(), String> {
        let reply = match credential {
            Credential::OAuth { user, token } => {
                if !self.has_capability("AUTH=XOAUTH2") {
                    return Err(format!(
                        "{} does not support Microsoft sign-in (XOAUTH2).",
                        self.host
                    ));
                }
                self.authenticate("XOAUTH2", &xoauth2(user, token))?
            }
            Credential::Password { user, password } => {
                if self.has_capability("AUTH=PLAIN") {
                    self.authenticate("PLAIN", &sasl_plain(user, password))?
                } else if self.has_capability("LOGINDISABLED") {
                    return Err(format!(
                        "{} does not allow password sign-in on this connection.",
                        self.host
                    ));
                } else {
                    let (Some(user), Some(password)) = (quote(user), quote(password)) else {
                        return Err(format!(
                            "{} cannot accept this user name or password. Use only plain ASCII characters.",
                            self.host
                        ));
                    };
                    self.command_secret(&format!("LOGIN {user} {password}"))?
                }
            }
        };
        if !reply.ok {
            return Err(format!(
                "The mail server rejected the sign-in ({}).{hint}",
                server_text(&reply.text)
            ));
        }
        // Capabilities may change after authentication.
        self.refresh_capabilities()
    }

    /// AUTHENTICATE with an initial response. A failure challenge is answered with an empty line.
    fn authenticate(&mut self, mechanism: &str, response: &str) -> Result<Tagged, String> {
        self.tag += 1;
        let tag = format!("A{}", self.tag);
        let sasl_ir = self.has_capability("SASL-IR");
        let line = if sasl_ir {
            format!("{tag} AUTHENTICATE {mechanism} {response}\r\n")
        } else {
            format!("{tag} AUTHENTICATE {mechanism}\r\n")
        };
        self.conn.write_all(line.as_bytes())?;
        let mut sent = sasl_ir;
        loop {
            let line = self.conn.read_line(MAX_LINE)?;
            if line.starts_with(b"+") {
                if sent {
                    self.conn.write_all(b"\r\n")?;
                } else {
                    self.conn.write_all(format!("{response}\r\n").as_bytes())?;
                    sent = true;
                }
                continue;
            }
            if let Some(tagged) = parse_tagged(&line, &tag) {
                return Ok(tagged);
            }
        }
    }

    /// A command whose text holds a secret; never echoed into errors.
    fn command_secret(&mut self, command: &str) -> Result<Tagged, String> {
        self.command(command, &mut |_| Ok(()))
    }

    /// Sends one command and feeds every untagged response to `on_untagged`.
    fn command(
        &mut self,
        command: &str,
        on_untagged: &mut dyn FnMut(&[Item]) -> Result<(), String>,
    ) -> Result<Tagged, String> {
        self.tag += 1;
        let tag = format!("A{}", self.tag);
        self.conn
            .write_all(format!("{tag} {command}\r\n").as_bytes())?;
        let mut total = 0usize;
        loop {
            let mut line = self.conn.read_line(MAX_LINE)?;
            if let Some(tagged) = parse_tagged(&line, &tag) {
                return Ok(tagged);
            }
            if line.starts_with(b"+") {
                return Err(format!("{} asked for unexpected input.", self.host));
            }
            let mut response = Vec::new();
            loop {
                let literal = literal_len(&line);
                response.extend_from_slice(&line);
                response.extend_from_slice(b"\r\n");
                let Some(len) = literal else { break };
                if len > MAX_LITERAL {
                    return Err(format!("{} sent a message that is too large.", self.host));
                }
                response.extend_from_slice(&self.conn.read_exact(len)?);
                line = self.conn.read_line(MAX_LINE)?;
            }
            total += response.len();
            if total > MAX_RESPONSE {
                return Err(format!(
                    "{} sent more data than this view can load.",
                    self.host
                ));
            }
            if response.starts_with(b"* BYE") {
                return Err(format!("{} closed the session.", self.host));
            }
            match parse_items(&response) {
                Ok(items) => on_untagged(&items)?,
                // Free-form status text may hold stray quotes; only message data must parse.
                Err(error) if is_fetch(&response) => return Err(format!("{}: {error}", self.host)),
                Err(_) => {}
            }
        }
    }

    /// Opens INBOX read-only and returns its message count.
    pub(super) fn examine_inbox(&mut self) -> Result<u32, String> {
        let mut exists = 0;
        let reply = self.command("EXAMINE INBOX", &mut |items| {
            if items
                .get(2)
                .and_then(Item::atom)
                .is_some_and(|atom| atom.eq_ignore_ascii_case("EXISTS"))
            {
                exists = items
                    .get(1)
                    .and_then(Item::atom)
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0);
            }
            Ok(())
        })?;
        if !reply.ok {
            return Err(format!(
                "Could not open the inbox: {}",
                server_text(&reply.text)
            ));
        }
        Ok(exists)
    }

    /// Runs FETCH (or UID FETCH) and collects message data. Never changes flags.
    pub(super) fn fetch(&mut self, command: &str) -> Result<Vec<Fetched>, String> {
        let mut fetched = Vec::new();
        let reply = self.command(command, &mut |items| {
            if let Some(message) = parse_fetch(items) {
                fetched.push(message);
            }
            Ok(())
        })?;
        if !reply.ok {
            return Err(format!(
                "Could not read messages: {}",
                server_text(&reply.text)
            ));
        }
        Ok(fetched)
    }

    pub(super) fn logout(mut self) {
        let _ = self.command("LOGOUT", &mut |_| Ok(()));
    }
}

fn is_fetch(response: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&response[..response.len().min(40)]).to_ascii_uppercase();
    head.contains(" FETCH ")
}

fn parse_tagged(line: &[u8], tag: &str) -> Option<Tagged> {
    let rest = line.strip_prefix(tag.as_bytes())?.strip_prefix(b" ")?;
    let text = String::from_utf8_lossy(rest).into_owned();
    let (status, message) = text.split_once(' ').unwrap_or((&text, ""));
    Some(Tagged {
        ok: status.eq_ignore_ascii_case("OK"),
        text: message.to_string(),
    })
}

/// Quotes an IMAP string; `None` when it needs a literal (8-bit or line breaks).
pub(super) fn quote(value: &str) -> Option<String> {
    if !value.bytes().all(|byte| (0x20..0x7f).contains(&byte)) {
        return None;
    }
    Some(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

#[cfg(test)]
#[path = "imap_tests.rs"]
mod tests;
