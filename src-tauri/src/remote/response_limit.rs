//! The Host HTTP `/rpc` response bound this desktop enforces and the text it shows when a
//! result does not fit. Mirrors `src/shared/model/host-contracts/response-limit.ts`; the
//! tests below fail on drift.

/// Largest response body read from the Host, envelope included. A Host that honours the
/// same bound answers `HOST_RESULT_TOO_LARGE` instead of sending more.
pub(crate) const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;

/// `code` of the typed Host answer for a result that does not fit one response.
pub(crate) const RESULT_TOO_LARGE_CODE: &str = "HOST_RESULT_TOO_LARGE";

/// A result that was produced but never delivered. The wording keeps "outcome is unknown" and
/// avoids the "Host rejected request:" prefix, so the command classifier holds the message for
/// a receipt check instead of reporting a refusal that never happened.
pub(crate) fn result_too_large_unknown(method: &str) -> String {
    format!("The host ran the request but its result was too large to send [RPC_RESULT_TOO_LARGE] ({method}). Its outcome is unknown. Check the command receipt before repeating it.")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_LIMIT: &str =
        include_str!("../../../src/shared/model/host-contracts/response-limit.ts");

    fn declared(name: &str) -> &'static str {
        TS_LIMIT
            .lines()
            .find_map(|line| line.strip_prefix(&format!("export const {name} = ")))
            .map(|rest| rest.trim_end_matches(';').trim())
            .unwrap_or_else(|| panic!("{name} is declared in response-limit.ts"))
    }

    #[test]
    fn response_limit_matches_the_shared_typescript_constant() {
        let product: u64 = declared("HOST_HTTP_MAX_RESPONSE_BYTES")
            .split('*')
            .map(|factor| factor.trim().parse::<u64>().expect("integer factor"))
            .product();
        assert_eq!(product, MAX_RESPONSE_BYTES);
    }

    #[test]
    fn result_too_large_code_matches_the_shared_typescript_constant() {
        assert_eq!(
            declared("HOST_RESULT_TOO_LARGE_CODE").trim_matches('"'),
            RESULT_TOO_LARGE_CODE
        );
    }

    #[test]
    fn undelivered_result_reads_as_unknown_outcome_not_a_refusal() {
        let text = result_too_large_unknown("sessions.send");
        assert!(text.contains("outcome is unknown"));
        assert!(!text.contains("Host rejected request:"));
    }
}
