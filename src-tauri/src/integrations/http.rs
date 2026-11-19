use base64::Engine as _;
use serde_json::Value;
use std::time::Duration;

/// Redirect policy is explicit: token integrations opt out; Jira/Linear retain ureq's default.
pub(crate) fn agent(timeout: Duration, redirects: Option<u32>) -> ureq::Agent {
    let builder = ureq::AgentBuilder::new().timeout(timeout);
    match redirects {
        Some(limit) => builder.redirects(limit).build(),
        None => builder.build(),
    }
}

pub(crate) fn basic_authorization(user: &str, secret: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{secret}"));
    format!("Basic {encoded}")
}

/// Trim string fields, preserving empty strings and rejecting non-string JSON values.
pub(crate) fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|text| text.trim().to_string())
}

/// True when ureq's transport failure came from a socket or connect timeout.
pub(crate) fn is_timeout(error: &ureq::Transport) -> bool {
    std::error::Error::source(error)
        .and_then(|source| source.downcast_ref::<std::io::Error>())
        .is_some_and(|io| io.kind() == std::io::ErrorKind::TimedOut)
}

/// Fixed phrase for why no response arrived. Never the URL, headers or raw error text,
/// which can carry proxy or account details.
pub(crate) fn transport_reason(error: &ureq::Transport) -> &'static str {
    if is_timeout(error) {
        return "the request timed out";
    }
    match error.kind() {
        ureq::ErrorKind::Dns => "DNS lookup failed",
        ureq::ErrorKind::ProxyConnect
        | ureq::ErrorKind::ProxyUnauthorized
        | ureq::ErrorKind::InvalidProxyUrl => "proxy error",
        // ureq reports TLS handshake and certificate failures as I/O or connection errors.
        ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::Io => "connection or TLS failed",
        _ => "unexpected transport error",
    }
}

/// User-facing text for a request that got no response. A timed-out POST may already have
/// been accepted by the service, so the text asks the user to check before sending again.
pub(crate) fn unreachable_text(service: &str, error: &ureq::Transport, posted: bool) -> String {
    if posted && is_timeout(error) {
        return format!(
            "{service} did not answer in time. The message may already have been sent; check the conversation before sending it again."
        );
    }
    format!(
        "Could not reach {service} ({}). Check your connection and try again.",
        transport_reason(error)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Fake transport failures built from io errors; no real network is involved.
    fn fake_transport(kind: std::io::ErrorKind, message: &str) -> ureq::Transport {
        match ureq::Error::from(std::io::Error::new(kind, message)) {
            ureq::Error::Transport(transport) => transport,
            ureq::Error::Status(..) => unreachable!("io errors are transport errors"),
        }
    }

    #[test]
    fn unreachable_text_names_the_category_without_raw_error_text() {
        let refused = fake_transport(std::io::ErrorKind::ConnectionRefused, "token=fake-secret");
        let text = unreachable_text("Slack", &refused, false);
        assert_eq!(
            text,
            "Could not reach Slack (connection or TLS failed). Check your connection and try again."
        );
        assert!(!text.contains("fake-secret"));
    }

    #[test]
    fn timed_out_post_warns_that_the_message_may_have_been_delivered() {
        let timeout = fake_transport(std::io::ErrorKind::TimedOut, "fake timeout");
        assert!(is_timeout(&timeout));
        assert_eq!(transport_reason(&timeout), "the request timed out");
        let text = unreachable_text("Discord", &timeout, true);
        assert!(text.starts_with("Discord did not answer in time."));
        assert!(text.contains("may already have been sent"));
        // A timed-out GET has nothing to duplicate, so it keeps the plain wording.
        let read = unreachable_text("Discord", &timeout, false);
        assert!(read.contains("(the request timed out)"));
    }

    #[test]
    fn basic_auth_keeps_caller_supplied_whitespace_and_unicode() {
        assert_eq!(basic_authorization("", "token"), "Basic OnRva2Vu");
        assert_eq!(basic_authorization("a", "b"), "Basic YTpi");
        let header = basic_authorization(" user ", " token ");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(header.trim_start_matches("Basic "))
            .unwrap();
        assert_eq!(decoded, b" user : token ");
        let header = basic_authorization("Çağrı", "密钥");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(header.trim_start_matches("Basic "))
            .unwrap();
        assert_eq!(decoded, "Çağrı:密钥".as_bytes());
    }

    #[test]
    fn field_trimming_keeps_empty_and_rejects_non_strings() {
        let value = json!({ "name": " x ", "empty": " ", "number": 3 });
        assert_eq!(string_field(&value, "name"), Some("x".into()));
        assert_eq!(string_field(&value, "empty"), Some("".into()));
        assert_eq!(string_field(&value, "number"), None);
        assert_eq!(string_field(&value, "missing"), None);
    }
}
