//! The Host protocol version this desktop speaks and the one mismatch text every
//! Rust caller shows. Mirrors `HOST_PROTOCOL_VERSION` and `protocolMismatchMessage`
//! in `src/features/connections/model/protocol.ts`; the tests below fail on drift.
use serde_json::Value;

/// Bump together with the TypeScript constant, and only for a change an existing
/// client cannot survive (see `docs/reference/remote-session-protocol.md`).
pub(crate) const HOST_PROTOCOL_VERSION: u64 = 1;

pub(crate) const NEWER_HOST_MESSAGE: &str =
    "This Host speaks a newer protocol. Update this app to connect.";
pub(crate) const OLDER_HOST_MESSAGE: &str =
    "This Host speaks an older protocol. Update the bycoda Host to connect.";

/// Guided text when a descriptor's `protocolVersion` differs from this build, `None`
/// when it matches. A missing or non-integer version reads as an older Host, as on
/// the TypeScript side.
pub(crate) fn protocol_mismatch(descriptor: &Value) -> Option<&'static str> {
    match descriptor.get("protocolVersion").and_then(Value::as_u64) {
        Some(HOST_PROTOCOL_VERSION) => None,
        Some(host) if host > HOST_PROTOCOL_VERSION => Some(NEWER_HOST_MESSAGE),
        _ => Some(OLDER_HOST_MESSAGE),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TS_PROTOCOL: &str = include_str!("../../../src/features/connections/model/protocol.ts");

    #[test]
    fn protocol_version_matches_the_shared_typescript_constant() {
        let declared = TS_PROTOCOL
            .lines()
            .find_map(|line| line.strip_prefix("export const HOST_PROTOCOL_VERSION = "))
            .and_then(|rest| rest.trim_end_matches(';').trim().parse::<u64>().ok())
            .expect("HOST_PROTOCOL_VERSION is declared as an integer literal");
        assert_eq!(declared, HOST_PROTOCOL_VERSION);
    }

    #[test]
    fn mismatch_texts_are_the_shared_typescript_messages() {
        assert!(TS_PROTOCOL.contains(NEWER_HOST_MESSAGE));
        assert!(TS_PROTOCOL.contains(OLDER_HOST_MESSAGE));
    }

    #[test]
    fn classifies_descriptor_versions_like_the_shared_classifier() {
        assert_eq!(
            protocol_mismatch(&json!({ "protocolVersion": HOST_PROTOCOL_VERSION })),
            None
        );
        assert_eq!(
            protocol_mismatch(&json!({ "protocolVersion": HOST_PROTOCOL_VERSION + 1 })),
            Some(NEWER_HOST_MESSAGE)
        );
        assert_eq!(
            protocol_mismatch(&json!({ "protocolVersion": 0 })),
            Some(OLDER_HOST_MESSAGE)
        );
        assert_eq!(protocol_mismatch(&json!({})), Some(OLDER_HOST_MESSAGE));
        assert_eq!(
            protocol_mismatch(&json!({ "protocolVersion": "1" })),
            Some(OLDER_HOST_MESSAGE)
        );
    }
}
