//! Browser sign-in: PKCE verifier and state, a `127.0.0.1` listener on a random port, the
//! code exchange and the hand-off to the session. One flow is active at a time; starting a
//! new one cancels the previous one and frees its port. The UI polls a handle.
use super::error::{AccountError, ErrorKind};
use super::tokens::{authorize_url, exchange_code, Endpoints, TokenError, TokenSet};
use crate::oauth_loopback::{
    bind, code_challenge, random_token, wait_for_callback, Callback, Lang, Waited, CALLBACK_PATH,
};
use crate::oauth_loopback_page::{respond_page, Kind};
use serde::Serialize;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// How long the browser has to finish sign-in.
pub(crate) const SIGN_IN_WINDOW: Duration = Duration::from_secs(300);

#[derive(Debug, PartialEq)]
pub(crate) enum Outcome {
    Done(TokenSet),
    Denied,
    Cancelled,
    TimedOut,
    Failed(AccountError),
}

fn tab_page(stream: &mut std::net::TcpStream, kind: Kind, reason: &str, lang: Lang) {
    respond_page(stream, kind, reason, lang);
}

/// User-facing error for an OAuth `error` the authorization server sent to the callback.
/// Inputs are already sanitized; the description is appended only for unknown codes.
pub(crate) fn callback_error(code: &str, description: &str) -> AccountError {
    let message = match code {
        "invalid_scope" | "unauthorized_client" | "invalid_client" | "invalid_request" => format!(
            "This build's sign-in configuration was rejected by the account server ({code})."
        ),
        "temporarily_unavailable" | "server_error" => {
            format!("The account server is unavailable right now ({code}). Try again later.")
        }
        _ if description.is_empty() => format!("Sign-in failed ({code})."),
        _ => format!("Sign-in failed ({code}): {description}"),
    };
    AccountError::new(ErrorKind::Failed, message)
}

/// Waits for the browser callback and exchanges its code. `exchange` gets the code only
/// after the `state` matched; a mismatch is answered with a 404 and ignored.
pub(crate) fn drive(
    listener: &TcpListener,
    state: &str,
    cancel: &AtomicBool,
    deadline: Instant,
    exchange: impl FnOnce(&str) -> Result<TokenSet, TokenError>,
) -> Outcome {
    let (callback, mut stream, lang) = match wait_for_callback(listener, state, cancel, deadline) {
        Waited::Callback(callback, stream, lang) => (callback, stream, lang),
        Waited::Cancelled => return Outcome::Cancelled,
        Waited::TimedOut => return Outcome::TimedOut,
        Waited::Failed => {
            return Outcome::Failed(AccountError::new(
                ErrorKind::Failed,
                "Could not start browser sign-in.",
            ))
        }
    };
    match callback {
        Callback::Ignore => {
            Outcome::Failed(AccountError::new(ErrorKind::Failed, "Unexpected request."))
        }
        Callback::Denied => {
            tab_page(&mut stream, Kind::Cancelled, "", lang);
            Outcome::Denied
        }
        Callback::Error(code, description) => {
            let error = callback_error(&code, &description);
            tab_page(&mut stream, Kind::Failure, &error.message, lang);
            Outcome::Failed(error)
        }
        Callback::Code(_) if cancel.load(Ordering::Relaxed) => Outcome::Cancelled,
        Callback::Code(code) => match exchange(&code) {
            // Cancelled while exchanging: the caller must not save these tokens.
            Ok(_) if cancel.load(Ordering::Relaxed) => Outcome::Cancelled,
            Ok(tokens) => {
                tab_page(&mut stream, Kind::Success, "", lang);
                Outcome::Done(tokens)
            }
            Err(error) => {
                let error = match error {
                    TokenError::Network => AccountError::offline(),
                    TokenError::InvalidGrant => AccountError::new(
                        ErrorKind::Failed,
                        "This sign-in request expired. Start again.",
                    ),
                    TokenError::Failed(message) => AccountError::new(ErrorKind::Failed, message),
                };
                tab_page(&mut stream, Kind::Failure, &error.message, lang);
                Outcome::Failed(error)
            }
        },
    }
}

// ---- Active flow registry ----

#[derive(Clone, Debug, PartialEq)]
enum Phase {
    Waiting,
    Done,
    Denied,
    Expired,
    Cancelled,
    Failed(AccountError),
}

struct Active {
    handle: String,
    phase: Phase,
    cancel: Arc<AtomicBool>,
}

static ACTIVE: LazyLock<Mutex<Option<Active>>> = LazyLock::new(|| Mutex::new(None));

fn set_phase(handle: &str, phase: Phase) {
    if let Ok(mut active) = ACTIVE.lock() {
        if let Some(flow) = active.as_mut().filter(|flow| flow.handle == handle) {
            if flow.phase == Phase::Waiting {
                flow.phase = phase;
            }
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignInStart {
    pub handle: String,
    pub authorize_url: String,
    pub expires_in: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignInPoll {
    /// pending | done | denied | expired | cancelled | failed
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AccountError>,
}

/// Starts a flow. `save` stores the tokens (keychain) once the code is exchanged; it
/// runs on the listener thread so the result is ready when the poll reports `done`.
pub(crate) fn start(
    client_id: String,
    endpoints: Endpoints,
    save: impl FnOnce(TokenSet) -> Result<(), AccountError> + Send + 'static,
) -> Result<SignInStart, AccountError> {
    cancel_active();
    let listener = bind(0).map_err(|message| AccountError::new(ErrorKind::Failed, message))?;
    let port = listener
        .local_addr()
        .map_err(|_| AccountError::new(ErrorKind::Failed, "Could not start browser sign-in."))?
        .port();
    let redirect = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let state = random_token();
    let verifier = random_token();
    let url = authorize_url(
        &endpoints,
        &client_id,
        &redirect,
        &state,
        &code_challenge(&verifier),
    )
    .map_err(|message| AccountError::new(ErrorKind::Failed, message))?;
    let handle = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut active) = ACTIVE.lock() {
        *active = Some(Active {
            handle: handle.clone(),
            phase: Phase::Waiting,
            cancel: cancel.clone(),
        });
    }
    let deadline = Instant::now() + SIGN_IN_WINDOW;
    let thread_handle = handle.clone();
    std::thread::Builder::new()
        .name("account-sign-in".into())
        .spawn(move || {
            let outcome = drive(&listener, &state, &cancel, deadline, |code| {
                exchange_code(&endpoints, &client_id, code, &verifier, &redirect)
            });
            let phase = match outcome {
                Outcome::Done(_) if cancel.load(Ordering::Relaxed) => Phase::Cancelled,
                Outcome::Done(tokens) => match save(tokens) {
                    Ok(()) => Phase::Done,
                    Err(error) => Phase::Failed(error),
                },
                Outcome::Denied => Phase::Denied,
                Outcome::Cancelled => Phase::Cancelled,
                Outcome::TimedOut => Phase::Expired,
                Outcome::Failed(error) => Phase::Failed(error),
            };
            set_phase(&thread_handle, phase);
        })
        .map_err(|_| AccountError::new(ErrorKind::Failed, "Could not start browser sign-in."))?;
    Ok(SignInStart {
        handle,
        authorize_url: url,
        expires_in: SIGN_IN_WINDOW.as_secs(),
    })
}

pub(crate) fn poll(handle: &str) -> SignInPoll {
    let phase = ACTIVE
        .lock()
        .ok()
        .and_then(|active| {
            active
                .as_ref()
                .filter(|flow| flow.handle == handle)
                .map(|flow| flow.phase.clone())
        })
        .unwrap_or(Phase::Expired);
    let (status, error) = match phase {
        Phase::Waiting => ("pending", None),
        Phase::Done => ("done", None),
        Phase::Denied => ("denied", None),
        Phase::Expired => ("expired", None),
        Phase::Cancelled => ("cancelled", None),
        Phase::Failed(error) => ("failed", Some(error)),
    };
    SignInPoll { status, error }
}

/// Stops any running sign-in.
pub(crate) fn cancel_active() {
    if let Ok(mut active) = ACTIVE.lock() {
        if let Some(flow) = active.take() {
            flow.cancel.store(true, Ordering::Relaxed);
        }
    }
}

/// Stops the flow and releases its port; later polls report `expired`.
pub(crate) fn cancel(handle: &str) {
    if let Ok(mut active) = ACTIVE.lock() {
        if active.as_ref().is_some_and(|flow| flow.handle == handle) {
            if let Some(flow) = active.take() {
                flow.cancel.store(true, Ordering::Relaxed);
            }
        }
    }
}
