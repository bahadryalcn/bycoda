//! The self-contained page the browser tab shows after a loopback sign-in: inline CSS and
//! SVG only, no scripts and no external requests. Text is English or Turkish by the
//! request's `Accept-Language`; dynamic text is escaped.
use std::io::Write;
use std::net::TcpStream;

/// Page language chosen from the callback request.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Lang {
    En,
    Tr,
}

impl Lang {
    /// Turkish when the browser's most preferred language is Turkish; otherwise English.
    pub(crate) fn from_request(head: &str) -> Self {
        let value = head
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.trim()
                    .eq_ignore_ascii_case("accept-language")
                    .then(|| value.trim().to_ascii_lowercase())
            })
            .unwrap_or_default();
        let first = value.split(',').next().unwrap_or("").trim();
        if first == "tr" || first.starts_with("tr-") || first.starts_with("tr;") {
            Lang::Tr
        } else {
            Lang::En
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Kind {
    Success,
    Failure,
    Cancelled,
}

const LOGO: &str = include_str!("../../public/brand/bycoda/logo-horizontal-black.svg");

fn logo() -> String {
    LOGO.replace(" xmlns=\"http://www.w3.org/2000/svg\"", "")
        .replace(" width=\"390\" height=\"80\"", " class=\"logo\"")
        .replace("#000000", "currentColor")
}

pub(crate) fn escape(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

const STYLE: &str = "\
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--ink:#0f1115;--muted:#5c6370;--line:#e2e4e9;--ok:#15803d;--bad:#b91c1c;--warn:#92400e}\
@media(prefers-color-scheme:dark){:root{--bg:#08090b;--card:#121317;--ink:#f3f4f6;--muted:#a3acb8;--line:#23262d;--ok:#4ade80;--bad:#f87171;--warn:#fbbf24}}\
*{box-sizing:border-box}\
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font:15px/1.5 'Mona Sans',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}\
main{width:100%;max-width:420px;padding:36px 32px 32px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.06)}\
.logo{display:block;height:22px;width:auto;margin:0 auto 28px;color:var(--ink)}\
.icon{width:48px;height:48px;margin:0 auto 16px;display:block}\
h1{margin:0 0 8px;font-size:20px;font-weight:650;letter-spacing:-.01em}\
p{margin:0;color:var(--muted)}\
.reason{margin:0 0 8px;color:var(--ink);overflow-wrap:anywhere}\
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}";

fn icon(kind: Kind) -> &'static str {
    match kind {
        Kind::Success => {
            "<svg class=\"icon ok\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"24\" cy=\"24\" r=\"20\"/><path d=\"M15 25l6 6 12-13\"/></svg>"
        }
        Kind::Failure => {
            "<svg class=\"icon bad\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M24 5L2.5 42h43z\"/><path d=\"M24 19v10M24 35v.5\"/></svg>"
        }
        Kind::Cancelled => {
            "<svg class=\"icon warn\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"24\" cy=\"24\" r=\"20\"/><path d=\"M17 24h14\"/></svg>"
        }
    }
}

fn texts(kind: Kind, lang: Lang) -> (&'static str, &'static str) {
    match (kind, lang) {
        (Kind::Success, Lang::En) => (
            "You're signed in",
            "You can close this tab and go back to bycoda.",
        ),
        (Kind::Success, Lang::Tr) => (
            "Oturum açıldı",
            "Bu sekmeyi kapatıp bycoda'ya dönebilirsin.",
        ),
        (Kind::Failure, Lang::En) => ("Sign-in didn't complete", "Go back to bycoda to try again."),
        (Kind::Failure, Lang::Tr) => (
            "Oturum açma tamamlanamadı",
            "Tekrar denemek için bycoda'ya dön.",
        ),
        (Kind::Cancelled, Lang::En) => (
            "Sign-in cancelled",
            "Nothing was changed. Go back to bycoda whenever you want to try again.",
        ),
        (Kind::Cancelled, Lang::Tr) => (
            "Oturum açma iptal edildi",
            "Hiçbir şey değişmedi. Tekrar denemek istediğinde bycoda'ya dön.",
        ),
    }
}

/// Full HTML document. `reason` is shown only on failure and is escaped here.
pub(crate) fn render(kind: Kind, reason: &str, lang: Lang) -> String {
    let (title, hint) = texts(kind, lang);
    let reason = if kind == Kind::Failure && !reason.trim().is_empty() {
        format!("<p class=\"reason\">{}</p>", escape(reason.trim()))
    } else {
        String::new()
    };
    format!(
        "<!doctype html><html lang=\"{}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>bycoda</title><style>{STYLE}</style></head><body><main>{}{}<h1>{}</h1>{reason}<p>{}</p></main></body></html>",
        if lang == Lang::Tr { "tr" } else { "en" },
        logo(),
        icon(kind),
        escape(title),
        escape(hint),
    )
}

pub(crate) fn respond_page(stream: &mut TcpStream, kind: Kind, reason: &str, lang: Lang) {
    let page = render(kind, reason, lang);
    let reply = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(reply.as_bytes()); // -- the browser tab may already be closed.
    crate::oauth_loopback::finish(stream);
}

#[cfg(test)]
#[path = "oauth_loopback_page_tests.rs"]
mod tests;
