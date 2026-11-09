//! Tauri commands of the account. The UI never sees a refresh token; it gets a short-lived
//! access token per call and talks to the API itself.
use super::config::{self, Config, Environment};
use super::device::{self, DeviceInfo};
use super::error::{AccountError, ErrorKind};
use super::flow::{self, SignInPoll, SignInStart};
use super::keychain::OsStore;
use super::session::{now_ms, AccessToken, Session};
use super::tokens::{HttpBackend, TokenError};
use serde::Serialize;
use std::sync::{Arc, LazyLock};

struct Runtime {
    config: Config,
    backend: Arc<HttpBackend>,
    session: Arc<Session>,
}

/// Built once; a changed environment variable needs an app restart.
static RUNTIME: LazyLock<Result<Runtime, AccountError>> = LazyLock::new(|| {
    let config = config::resolve()?;
    let backend = Arc::new(HttpBackend::new(config.clone()));
    let session = Arc::new(Session::new(
        Box::new(OsStore),
        Box::new(backend.clone()),
        config.keychain_account(),
    ));
    Ok(Runtime {
        config,
        backend,
        session,
    })
});

fn runtime() -> Result<&'static Runtime, AccountError> {
    RUNTIME.as_ref().map_err(Clone::clone)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AccountError> + Send + 'static,
) -> Result<T, AccountError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| AccountError::new(ErrorKind::Failed, "Account work was interrupted."))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    /// False when this build has no OAuth client; the UI hides sign-in.
    configured: bool,
    signed_in: bool,
    /// A rotated session token could not be written to the system credential store; it is
    /// held in memory until the app closes.
    keychain_error: bool,
    api_base_url: Option<String>,
    environment: Option<Environment>,
}

#[tauri::command]
pub async fn account_status() -> Result<AccountStatus, AccountError> {
    blocking(|| {
        let Ok(runtime) = runtime() else {
            return Ok(AccountStatus {
                configured: false,
                signed_in: false,
                keychain_error: false,
                api_base_url: None,
                environment: None,
            });
        };
        Ok(AccountStatus {
            configured: runtime.config.client_id.is_some(),
            signed_in: runtime.session.is_signed_in()?,
            keychain_error: runtime.session.keychain_failed(),
            api_base_url: Some(runtime.config.api_base_url.clone()),
            environment: Some(runtime.config.environment),
        })
    })
    .await
}

#[tauri::command]
pub async fn account_sign_in_start() -> Result<SignInStart, AccountError> {
    blocking(|| {
        let runtime = runtime()?;
        let client_id = runtime.config.require_client_id()?.to_string();
        let endpoints = runtime.backend.endpoints().map_err(|error| match error {
            TokenError::Network => AccountError::offline(),
            TokenError::InvalidGrant => AccountError::not_configured(),
            TokenError::Failed(message) => AccountError::new(ErrorKind::Unavailable, message),
        })?;
        let session = runtime.session.clone();
        flow::start(client_id, endpoints, move |tokens| {
            session.save_sign_in(tokens, now_ms())
        })
    })
    .await
}

#[tauri::command]
pub fn account_sign_in_poll(handle: String) -> SignInPoll {
    flow::poll(&handle)
}

#[tauri::command]
pub fn account_sign_in_cancel(handle: String) {
    flow::cancel(&handle);
}

#[tauri::command]
pub async fn account_access_token() -> Result<AccessToken, AccountError> {
    blocking(|| runtime()?.session.access_token(now_ms())).await
}

#[tauri::command]
pub async fn account_sign_out() -> Result<(), AccountError> {
    blocking(|| {
        flow::cancel_active();
        runtime()?.session.sign_out()
    })
    .await
}

#[tauri::command]
pub fn account_device_info() -> DeviceInfo {
    device::current()
}
