//! Teams message HTML to plain text and plain text to safe HTML.

/// Strips tags, decodes entities and keeps line structure from `<br>` and block ends.
pub(crate) fn html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    let mut skipping: Option<String> = None;
    while let Some(start) = rest.find('<') {
        if skipping.is_none() {
            push_text(&mut out, &rest[..start]);
        }
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else {
            if skipping.is_none() {
                push_text(&mut out, &rest[start..]);
            }
            rest = "";
            break;
        };
        let tag = &after[..end];
        rest = &after[end + 1..];
        let (closing, name) = tag_name(tag);
        if let Some(skip) = &skipping {
            if closing && &name == skip {
                skipping = None;
            }
            continue;
        }
        match (closing, name.as_str()) {
            (false, "script" | "style") => skipping = Some(name),
            (_, "br") => push_break(&mut out),
            (false, "li") => {
                if !out.is_empty() && !out.ends_with('\n') {
                    push_break(&mut out);
                }
                out.push_str("• ");
            }
            (true, "p" | "div" | "li" | "tr" | "blockquote" | "pre" | "ul" | "ol" | "table")
            | (true, "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => push_break(&mut out),
            (false, "emoji") => push_text(&mut out, &attribute(tag, "alt").unwrap_or_default()),
            (false, "img") => {
                let alt = attribute(tag, "alt").filter(|alt| !alt.trim().is_empty());
                push_text(&mut out, alt.as_deref().unwrap_or("[Image]"));
            }
            _ => {}
        }
    }
    if skipping.is_none() {
        push_text(&mut out, rest);
    }
    tidy_lines(&out)
}

/// Normalizes plain-text bodies (line endings, surrounding blank lines).
pub(crate) fn plain_text(text: &str) -> String {
    tidy_lines(&text.replace("\r\n", "\n").replace('\r', "\n"))
}

/// Escapes a reply so Teams shows it verbatim, keeping line breaks.
pub(crate) fn text_to_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.replace("\r\n", "\n").chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            '\n' => out.push_str("<br>"),
            '\r' => {}
            _ => out.push(ch),
        }
    }
    out
}

/// One line for list previews, truncated on a character boundary.
pub(crate) fn single_line(text: &str, limit: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= limit {
        return line;
    }
    line.chars()
        .take(limit)
        .collect::<String>()
        .trim_end()
        .to_string()
        + "…"
}

fn tag_name(tag: &str) -> (bool, String) {
    let tag = tag.trim_start();
    let (closing, tag) = match tag.strip_prefix('/') {
        Some(rest) => (true, rest.trim_start()),
        None => (false, tag),
    };
    let name = tag
        .split(|ch: char| ch.is_whitespace() || ch == '/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    (closing, name)
}

fn attribute(tag: &str, key: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(key) {
        let index = from + found;
        from = index + key.len();
        let boundary = index == 0 || lower.as_bytes()[index - 1].is_ascii_whitespace();
        let rest = lower[from..].trim_start();
        if !boundary || !rest.starts_with('=') {
            continue;
        }
        let value_start = tag.len() - rest.len() + 1;
        let value = tag[value_start..].trim_start();
        let quote = value.chars().next()?;
        let raw = if quote == '"' || quote == '\'' {
            let inner = &value[1..];
            &inner[..inner.find(quote).unwrap_or(inner.len())]
        } else {
            value.split_whitespace().next().unwrap_or("")
        };
        return Some(decode_entities(raw));
    }
    None
}

fn push_break(out: &mut String) {
    while out.ends_with(' ') {
        out.pop();
    }
    out.push('\n');
}

/// Appends source text with HTML whitespace collapsing.
fn push_text(out: &mut String, raw: &str) {
    for ch in decode_entities(raw).chars() {
        if ch.is_whitespace() {
            if !out.is_empty() && !out.ends_with(' ') && !out.ends_with('\n') {
                out.push(' ');
            }
        } else {
            out.push(ch);
        }
    }
}

pub(crate) fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let semi = after.find(';').filter(|semi| *semi <= 10);
        let decoded = semi.and_then(|semi| entity(&after[..semi]));
        match (semi, decoded) {
            (Some(semi), Some(ch)) => {
                out.push(ch);
                rest = &after[semi + 1..];
            }
            _ => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        _ => {
            let number = name.strip_prefix('#')?;
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse().ok()?,
            };
            char::from_u32(code).filter(|ch| *ch != '\0')
        }
    }
}

/// Trims each line, keeps at most one blank line in a row, drops outer blank lines.
fn tidy_lines(text: &str) -> String {
    let mut lines: Vec<&str> = Vec::new();
    for line in text.split('\n').map(str::trim) {
        if line.is_empty() && lines.last().is_none_or(|last| last.is_empty()) {
            continue;
        }
        lines.push(line);
    }
    while lines.last().is_some_and(|last| last.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}
