use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ErrorKind {
    /// No OAuth client or issuer is configured for this build.
    NotConfigured,
    /// No refresh token is stored.
    SignedOut,
    /// The refresh token was rejected; it has been forgotten.
    SessionExpired,
    /// The sign-in service could not be reached; stored tokens are kept.
    Offline,
    /// The sign-in service answered with an error; stored tokens are kept.
    Unavailable,
    /// The OS credential store failed.
    Keychain,
    Failed,
}

/// Error sent to the UI. The message never contains token material.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct AccountError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AccountError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub(crate) fn not_configured() -> Self {
        Self::new(
            ErrorKind::NotConfigured,
            "Account sign-in is not set up in this build.",
        )
    }

    pub(crate) fn signed_out() -> Self {
        Self::new(
            ErrorKind::SignedOut,
            "You are signed out of your bycoda account.",
        )
    }

    pub(crate) fn session_expired() -> Self {
        Self::new(
            ErrorKind::SessionExpired,
            "Your bycoda session ended. Sign in again to use your account.",
        )
    }

    pub(crate) fn offline() -> Self {
        Self::new(
            ErrorKind::Offline,
            "Could not reach bycoda sign-in. Check your connection.",
        )
    }

    pub(crate) fn keychain() -> Self {
        Self::new(
            ErrorKind::Keychain,
            "The system credential store is not available.",
        )
    }
}
