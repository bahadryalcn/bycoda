//! Minimal SMTP submission client: EHLO, STARTTLS, AUTH (PLAIN, LOGIN, XOAUTH2) and DATA.
use super::config::{sasl_plain, xoauth2, Credential, EmailConfig, Security};
use super::imap::server_text;
use super::net::Conn;
use base64::Engine as _;
use std::time::Instant;

const MAX_LINE: usize = 64 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Reply {
    pub code: u16,
    pub lines: Vec<String>,
}

impl Reply {
    fn text(&self) -> String {
        server_text(&self.lines.join(" "))
    }

    fn positive(&self) -> bool {
        (200..400).contains(&self.code)
    }
}

/// Parses one reply line into (code, is_last, text).
pub(super) fn parse_reply_line(line: &str) -> Option<(u16, bool, String)> {
    let code: u16 = line.get(..3)?.parse().ok()?;
    let last = !line[3..].starts_with('-');
    let text = line.get(4..).unwrap_or("").to_string();
    Some((code, last, text))
}

/// Doubles a leading dot on every line and ends the data with `CRLF.CRLF`.
pub(super) fn dot_stuff(message: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(message.len() + 64);
    let mut line_start = true;
    for &byte in message {
        if line_start && byte == b'.' {
            out.push(b'.');
        }
        out.push(byte);
        line_start = byte == b'\n';
    }
    if !out.ends_with(b"\r\n") {
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b".\r\n");
    out
}

pub(super) struct Smtp {
    conn: Conn,
    host: String,
    extensions: Vec<String>,
}

impl Smtp {
    pub(super) fn connect(config: &EmailConfig, deadline: Instant) -> Result<Self, String> {
        let server = &config.smtp;
        let tls = server.security == Security::Tls;
        let conn = Conn::connect(&server.host, server.port, tls, deadline)?;
        let mut smtp = Smtp {
            conn,
            host: server.host.clone(),
            extensions: Vec::new(),
        };
        let greeting = smtp.read_reply()?;
        if greeting.code != 220 {
            return Err(format!(
                "{} refused the connection: {}",
                smtp.host,
                greeting.text()
            ));
        }
        smtp.ehlo()?;
        if server.security == Security::StartTls {
            if !smtp.has_extension("STARTTLS") {
                return Err(format!(
                    "{} does not offer STARTTLS on this port. Try TLS on port 465.",
                    smtp.host
                ));
            }
            let reply = smtp.command("STARTTLS")?;
            if reply.code != 220 {
                return Err(format!("{} refused STARTTLS: {}", smtp.host, reply.text()));
            }
            smtp.conn.start_tls()?;
            smtp.ehlo()?;
        }
        Ok(smtp)
    }

    fn read_reply(&mut self) -> Result<Reply, String> {
        let mut lines = Vec::new();
        loop {
            let raw = self.conn.read_line(MAX_LINE)?;
            let line = String::from_utf8_lossy(&raw).into_owned();
            let (code, last, text) = parse_reply_line(&line)
                .ok_or_else(|| format!("{} sent an invalid SMTP reply.", self.host))?;
            lines.push(text);
            if last {
                return Ok(Reply { code, lines });
            }
            if lines.len() > 200 {
                return Err(format!("{} sent an invalid SMTP reply.", self.host));
            }
        }
    }

    fn command(&mut self, line: &str) -> Result<Reply, String> {
        self.conn.write_all(format!("{line}\r\n").as_bytes())?;
        self.read_reply()
    }

    fn ehlo(&mut self) -> Result<(), String> {
        let reply = self.command("EHLO localhost")?;
        if reply.code != 250 {
            return Err(format!("{} rejected EHLO: {}", self.host, reply.text()));
        }
        self.extensions = reply
            .lines
            .iter()
            .skip(1)
            .map(|line| line.to_ascii_uppercase())
            .collect();
        Ok(())
    }

    fn has_extension(&self, name: &str) -> bool {
        self.extensions
            .iter()
            .any(|ext| ext.split_whitespace().next() == Some(name))
    }

    fn auth_mechanisms(&self) -> Vec<String> {
        self.extensions
            .iter()
            .filter_map(|ext| {
                ext.strip_prefix("AUTH")
                    .map(|rest| rest.trim_start_matches(['=', ' ']).to_string())
            })
            .flat_map(|list| {
                list.split_whitespace()
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    pub(super) fn login(&mut self, credential: &Credential, hint: &str) -> Result<(), String> {
        let mechanisms = self.auth_mechanisms();
        let supports = |name: &str| mechanisms.iter().any(|mechanism| mechanism == name);
        let reply = match credential {
            Credential::OAuth { user, token } => {
                if !supports("XOAUTH2") {
                    return Err(format!(
                        "{} does not support Microsoft sign-in (XOAUTH2).",
                        self.host
                    ));
                }
                let reply = self.command(&format!("AUTH XOAUTH2 {}", xoauth2(user, token)))?;
                if reply.code == 334 {
                    // The challenge carries the error; an empty line ends the exchange.
                    self.command("")?
                } else {
                    reply
                }
            }
            Credential::Password { user, password } => {
                if supports("PLAIN") {
                    self.command(&format!("AUTH PLAIN {}", sasl_plain(user, password)))?
                } else if supports("LOGIN") {
                    let encode =
                        |value: &str| base64::engine::general_purpose::STANDARD.encode(value);
                    let mut reply = self.command("AUTH LOGIN")?;
                    if reply.code == 334 {
                        reply = self.command(&encode(user))?;
                    }
                    if reply.code == 334 {
                        reply = self.command(&encode(password))?;
                    }
                    reply
                } else {
                    return Err(format!(
                        "{} does not offer a supported password sign-in.",
                        self.host
                    ));
                }
            }
        };
        if reply.code != 235 {
            return Err(format!(
                "The outgoing mail server rejected the sign-in ({}).{hint}",
                reply.text()
            ));
        }
        Ok(())
    }

    pub(super) fn send(
        &mut self,
        from: &str,
        recipients: &[String],
        message: &[u8],
    ) -> Result<(), String> {
        let reply = self.command(&format!("MAIL FROM:<{from}>"))?;
        if !reply.positive() {
            return Err(format!(
                "The mail server refused the sender: {}",
                reply.text()
            ));
        }
        for recipient in recipients {
            let reply = self.command(&format!("RCPT TO:<{recipient}>"))?;
            if !reply.positive() {
                let _ = self.command("RSET");
                return Err(format!(
                    "The mail server refused {recipient}: {}",
                    reply.text()
                ));
            }
        }
        let reply = self.command("DATA")?;
        if reply.code != 354 {
            return Err(format!(
                "The mail server refused the message: {}",
                reply.text()
            ));
        }
        self.conn.write_all(&dot_stuff(message))?;
        let reply = self.read_reply()?;
        if reply.code != 250 {
            return Err(format!(
                "The mail server did not accept the message: {}",
                reply.text()
            ));
        }
        Ok(())
    }

    pub(super) fn quit(mut self) {
        let _ = self.command("QUIT");
    }
}

#[cfg(test)]
#[path = "smtp_tests.rs"]
mod tests;
