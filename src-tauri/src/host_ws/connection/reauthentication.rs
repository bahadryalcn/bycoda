//! Upgrade-time 401 handling: a refusal right after a successful session is
//! temporary for a short streak, so the lane retries before it blocks.
use super::socket_error;
use tokio_tungstenite::tungstenite::Error;

// A Host that is restarting, or that answers an internal failure with 401, can
// refuse one upgrade after this lane already authenticated. Only a short streak
// of such refusals is temporary; after that the credentials are treated as
// invalid and the lane blocks until a manual reconnect.
pub(super) const REAUTHENTICATION_RETRY_ATTEMPTS: u32 = 3;

// Upgrade-only: a 401 is kept apart from other authentication failures so the
// worker can decide whether it is temporary for this lane.
pub(super) fn upgrade_error(error: &Error) -> (&'static str, bool) {
    match error {
        Error::Http(response) if response.status().as_u16() == 401 => ("unauthorized", true),
        _ => socket_error(error),
    }
}

// Returns (category, permanent) for the Nth consecutive upgrade 401.
pub(super) fn unauthorized_disposition(
    authenticated_before: bool,
    streak: u32,
) -> (&'static str, bool) {
    let temporary = authenticated_before && streak <= REAUTHENTICATION_RETRY_ATTEMPTS;
    ("authentication", !temporary)
}
