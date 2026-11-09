//! Token custody. The refresh token is in the OS credential store; the short-lived access
//! token is held in memory only. One refresh runs at a time, and the outcome decides
//! whether the stored session survives: a rejected token is forgotten, an unreachable
//! service keeps it.
use super::error::{AccountError, ErrorKind};
use super::keychain::SecretStore;
use super::tokens::{TokenBackend, TokenError, TokenSet};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// An access token this close to expiry is refreshed first.
const REFRESH_MARGIN_MS: u64 = 60_000;

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessToken {
    pub access_token: String,
    /// Unix milliseconds.
    pub expires_at: u64,
}

pub(crate) struct Session {
    store: Box<dyn SecretStore>,
    backend: Box<dyn TokenBackend>,
    account: String,
    cached: Mutex<Option<AccessToken>>,
    /// Serializes refresh, sign-in and sign-out, so a refresh in flight can never write a
    /// rotated token back after sign-out.
    refreshing: Mutex<()>,
    /// A rotated refresh token the credential store refused. Clerk invalidates the old one,
    /// so it is kept for this run and written again on the next refresh.
    unsaved: Mutex<Option<String>>,
}

impl Session {
    pub(crate) fn new(
        store: Box<dyn SecretStore>,
        backend: Box<dyn TokenBackend>,
        account: String,
    ) -> Self {
        Self {
            store,
            backend,
            account,
            cached: Mutex::new(None),
            refreshing: Mutex::new(()),
            unsaved: Mutex::new(None),
        }
    }

    fn cache(&self, token: Option<AccessToken>) {
        if let Ok(mut cached) = self.cached.lock() {
            *cached = token;
        }
    }

    fn fresh_cached(&self, now: u64) -> Option<AccessToken> {
        let cached = self.cached.lock().ok()?;
        cached
            .clone()
            .filter(|token| token.expires_at > now.saturating_add(REFRESH_MARGIN_MS))
    }

    fn set_unsaved(&self, token: Option<String>) {
        if let Ok(mut unsaved) = self.unsaved.lock() {
            *unsaved = token;
        }
    }

    fn unsaved_token(&self) -> Option<String> {
        self.unsaved.lock().ok().and_then(|unsaved| unsaved.clone())
    }

    /// True while a rotated refresh token could not be written to the credential store.
    pub(crate) fn keychain_failed(&self) -> bool {
        self.unsaved_token().is_some()
    }

    pub(crate) fn is_signed_in(&self) -> Result<bool, AccountError> {
        if self.keychain_failed() {
            return Ok(true);
        }
        Ok(self.store.get(&self.account)?.is_some())
    }

    /// Stores the tokens of a finished browser sign-in.
    pub(crate) fn save_sign_in(&self, tokens: TokenSet, now: u64) -> Result<(), AccountError> {
        let Some(refresh) = tokens.refresh_token.as_deref() else {
            return Err(AccountError::new(
                ErrorKind::Failed,
                "Sign-in did not return a session. Try again.",
            ));
        };
        let _serial = self
            .refreshing
            .lock()
            .map_err(|_| AccountError::offline())?;
        self.store.set(&self.account, refresh)?;
        self.set_unsaved(None);
        self.cache(Some(AccessToken {
            access_token: tokens.access_token,
            expires_at: now + tokens.expires_in * 1000,
        }));
        Ok(())
    }

    /// A valid access token, refreshing when it expires within a minute.
    pub(crate) fn access_token(&self, now: u64) -> Result<AccessToken, AccountError> {
        if let Some(token) = self.fresh_cached(now) {
            return Ok(token);
        }
        let _one_refresh = self
            .refreshing
            .lock()
            .map_err(|_| AccountError::offline())?;
        // Another caller may have refreshed while this one waited.
        if let Some(token) = self.fresh_cached(now) {
            return Ok(token);
        }
        // Sign-out takes the same lock, so the session read here is still the live one.
        let refresh = match self.unsaved_token() {
            Some(refresh) => refresh,
            None => match self.store.get(&self.account)? {
                Some(refresh) => refresh,
                None => {
                    self.cache(None);
                    return Err(AccountError::signed_out());
                }
            },
        };
        match self.backend.refresh(&refresh) {
            Ok(tokens) => {
                let rotated = tokens.refresh_token.as_deref().unwrap_or(&refresh);
                if rotated != refresh || self.keychain_failed() {
                    match self.store.set(&self.account, rotated) {
                        Ok(()) => self.set_unsaved(None),
                        Err(_) => self.set_unsaved(Some(rotated.to_string())),
                    }
                }
                let token = AccessToken {
                    access_token: tokens.access_token,
                    expires_at: now + tokens.expires_in * 1000,
                };
                self.cache(Some(token.clone()));
                Ok(token)
            }
            Err(TokenError::InvalidGrant) => {
                self.cache(None);
                self.set_unsaved(None);
                self.store.delete(&self.account)?;
                Err(AccountError::session_expired())
            }
            Err(TokenError::Network) => Err(AccountError::offline()),
            Err(TokenError::Failed(message)) => {
                Err(AccountError::new(ErrorKind::Unavailable, message))
            }
        }
    }

    /// Revokes (best effort) and forgets the session. Local data is not touched.
    pub(crate) fn sign_out(&self) -> Result<(), AccountError> {
        let _serial = self
            .refreshing
            .lock()
            .map_err(|_| AccountError::offline())?;
        self.cache(None);
        let unsaved = self.unsaved_token();
        self.set_unsaved(None);
        let stored = self.store.get(&self.account);
        if let Some(refresh) = &unsaved {
            self.backend.revoke(refresh);
        }
        if let Ok(Some(refresh)) = &stored {
            if unsaved.as_ref() != Some(refresh) {
                self.backend.revoke(refresh);
            }
        }
        self.store.delete(&self.account)?;
        stored.map(|_| ())
    }
}
