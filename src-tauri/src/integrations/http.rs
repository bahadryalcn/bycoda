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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
