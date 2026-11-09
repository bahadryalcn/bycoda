use super::oauth::{self, BrowserPoll, BrowserStart};
use super::store::{valid_id, Store, STORE_LOCK};
use super::types::{
    now_ms, Account, AccountView, DevicePoll, DeviceStart, Message, Provider, SaveAccountInput,
    Secret, Thread,
};
use super::{discord, email, microsoft, slack, teams};
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const DEFAULT_THREAD_LIMIT: usize = 50;
const MAX_THREAD_LIMIT: usize = 200;
const MAX_REPLY_CHARS: usize = 20_000;
const REPLY_DEDUPE_WINDOW: Duration = Duration::from_secs(600);

/// Recent replies by requestId so a retried click never sends twice.
static RECENT_REPLIES: Mutex<Vec<(String, Instant, Message)>> = Mutex::new(Vec::new());

fn store(app: &AppHandle) -> Result<Store, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(Store::new(&root))
}

fn view(account: &Account, connected: bool) -> AccountView {
    AccountView {
        id: account.id.clone(),
        provider: account.provider,
        label: account.label.clone(),
        identity: account.identity.clone(),
        config: account.config.clone(),
        connected,
        created_at: account.created_at,
        updated_at: account.updated_at,
    }
}

fn normalize_config(provider: Provider, config: &Value) -> Result<Value, String> {
    match provider {
        Provider::Email => email::normalize_config(config),
        Provider::Slack => slack::normalize_config(config),
        Provider::Discord => discord::normalize_config(config),
        Provider::Teams => teams::normalize_config(config),
    }
}

fn verify(provider: Provider, config: &Value, secret: &mut Secret) -> Result<String, String> {
    match provider {
        Provider::Email => email::verify(config, secret),
        Provider::Slack => slack::verify(config, secret),
        Provider::Discord => discord::verify(config, secret),
        Provider::Teams => teams::verify(config, secret),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// Loads one account and its secret, runs provider work, and persists a changed secret
/// (for example a refreshed OAuth token) only when the account still exists.
fn with_account<T>(
    app: &AppHandle,
    account_id: &str,
    work: impl FnOnce(&Account, &mut Secret) -> Result<T, String>,
) -> Result<T, String> {
    valid_id(account_id)?;
    let store = store(app)?;
    let account = {
        let _guard = STORE_LOCK.lock().map_err(|_| "Messaging store is busy.")?;
        store
            .accounts()?
            .into_iter()
            .find(|account| account.id == account_id)
            .ok_or("This account is no longer connected.")?
    };
    let original = store
        .secret(account_id)?
        .ok_or("Credentials are missing. Reconnect this account.")?;
    let mut secret = original.clone();
    let result = work(&account, &mut secret);
    if secret != original {
        let _guard = STORE_LOCK.lock().map_err(|_| "Messaging store is busy.")?;
        if store
            .accounts()?
            .iter()
            .any(|stored| stored.id == account_id)
        {
            store.write_secret(account_id, &secret)?;
        }
    }
    result
}

#[tauri::command]
pub async fn messaging_list_accounts(app: AppHandle) -> Result<Vec<AccountView>, String> {
    blocking(move || {
        let store = store(&app)?;
        let _guard = STORE_LOCK.lock().map_err(|_| "Messaging store is busy.")?;
        store
            .accounts()?
            .iter()
            .map(|account| Ok(view(account, store.secret(&account.id)?.is_some())))
            .collect()
    })
    .await
}

#[tauri::command]
pub async fn messaging_save_account(
    app: AppHandle,
    input: SaveAccountInput,
) -> Result<AccountView, String> {
    blocking(move || {
        let store = store(&app)?;
        let config = normalize_config(input.provider, &input.config)?;
        let existing = match &input.id {
            Some(id) => {
                valid_id(id)?;
                let _guard = STORE_LOCK.lock().map_err(|_| "Messaging store is busy.")?;
                let account = store
                    .accounts()?
                    .into_iter()
                    .find(|account| &account.id == id)
                    .ok_or("This account is no longer connected.")?;
                if account.provider != input.provider {
                    return Err("The account provider cannot change.".into());
                }
                Some(account)
            }
            None => None,
        };
        // Start from the stored secret on edit; supplied fields replace it, empty fields keep it.
        let mut secret = match &existing {
            Some(account) => store.secret(&account.id)?.unwrap_or_default(),
            None => Secret::new(),
        };
        let sign_in = match &input.auth_handle {
            Some(handle) if oauth::owns(handle) => {
                let (purpose, tokens) = oauth::tokens(handle)?;
                Some((purpose.secret_key(), tokens))
            }
            Some(handle) => Some(("microsoft", microsoft::device_tokens(handle)?)),
            None => None,
        };
        merge_credentials(&mut secret, input.secret.as_ref(), sign_in);
        // Validate before saving; a failure leaves the previous account and secret untouched.
        let identity = verify(input.provider, &config, &mut secret)?;
        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| identity.clone());
        let now = now_ms();
        let account = Account {
            id: existing
                .as_ref()
                .map(|account| account.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            provider: input.provider,
            label,
            identity,
            config,
            created_at: existing
                .as_ref()
                .map(|account| account.created_at)
                .unwrap_or(now),
            updated_at: now,
        };
        let _guard = STORE_LOCK.lock().map_err(|_| "Messaging store is busy.")?;
        let mut accounts = store.accounts()?;
        if existing.is_some() && !accounts.iter().any(|stored| stored.id == account.id) {
            return Err("This account was removed while saving.".into());
        }
        store.write_secret(&account.id, &secret)?;
        accounts.retain(|stored| stored.id != account.id);
        accounts.push(account.clone());
        store.write_accounts(&accounts)?;
        if let Some(handle) = &input.auth_handle {
            oauth::forget(handle);
            microsoft::forget_device_flow(handle);
        }
        Ok(view(&account, true))
    })
    .await
}

/// Applies supplied secret fields (empty ones keep the stored value) and a finished sign-in.
/// A new Slack bot token replaces a browser sign-in and vice versa, so the latest choice wins.
fn merge_credentials(secret: &mut Secret, fields: Option<&Secret>, sign_in: Option<(&str, Value)>) {
    for (key, value) in fields.into_iter().flatten() {
        if value.as_str().is_some_and(|text| text.trim().is_empty()) {
            continue;
        }
        if key == "botToken" {
            secret.remove("slack");
        }
        secret.insert(key.clone(), value.clone());
    }
    if let Some((key, tokens)) = sign_in {
        if key == "slack" {
            secret.remove("botToken");
        }
        secret.insert(key.into(), tokens);
    }
}

#[tauri::command]
pub async fn messaging_remove_account(app: AppHandle, account_id: String) -> Result<(), String> {
    blocking(move || {
        valid_id(&account_id)?;
        let store = store(&app)?;
        let _guard = STORE_LOCK.lock().map_err(|_| "Messaging store is busy.")?;
        let mut accounts = store.accounts()?;
        accounts.retain(|account| account.id != account_id);
        store.write_accounts(&accounts)?;
        store.delete_secret(&account_id)
    })
    .await
}

#[tauri::command]
pub async fn messaging_list_threads(
    app: AppHandle,
    account_id: String,
    limit: Option<usize>,
) -> Result<Vec<Thread>, String> {
    let limit = limit
        .unwrap_or(DEFAULT_THREAD_LIMIT)
        .clamp(1, MAX_THREAD_LIMIT);
    blocking(move || {
        with_account(&app, &account_id, |account, secret| {
            match account.provider {
                Provider::Email => email::list_threads(account, secret, limit),
                Provider::Slack => slack::list_threads(account, secret, limit),
                Provider::Discord => discord::list_threads(account, secret, limit),
                Provider::Teams => teams::list_threads(account, secret, limit),
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn messaging_thread_messages(
    app: AppHandle,
    account_id: String,
    thread_id: String,
) -> Result<Vec<Message>, String> {
    blocking(move || {
        with_account(&app, &account_id, |account, secret| {
            match account.provider {
                Provider::Email => email::thread_messages(account, secret, &thread_id),
                Provider::Slack => slack::thread_messages(account, secret, &thread_id),
                Provider::Discord => discord::thread_messages(account, secret, &thread_id),
                Provider::Teams => teams::thread_messages(account, secret, &thread_id),
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn messaging_reply(
    app: AppHandle,
    account_id: String,
    thread_id: String,
    body: String,
    request_id: String,
) -> Result<Message, String> {
    blocking(move || {
        let body = body.trim().to_string();
        if body.is_empty() {
            return Err("Write a reply before sending.".into());
        }
        if body.chars().count() > MAX_REPLY_CHARS {
            return Err("This reply is too long.".into());
        }
        let key = format!("{account_id}\u{0}{thread_id}\u{0}{request_id}");
        if let Some(sent) = recent_reply(&key) {
            return Ok(sent);
        }
        let sent = with_account(&app, &account_id, |account, secret| {
            match account.provider {
                Provider::Email => email::reply(account, secret, &thread_id, &body),
                Provider::Slack => slack::reply(account, secret, &thread_id, &body),
                Provider::Discord => discord::reply(account, secret, &thread_id, &body),
                Provider::Teams => teams::reply(account, secret, &thread_id, &body),
            }
        })?;
        remember_reply(key, sent.clone());
        Ok(sent)
    })
    .await
}

fn recent_reply(key: &str) -> Option<Message> {
    let mut recent = RECENT_REPLIES.lock().ok()?;
    recent.retain(|(_, at, _)| at.elapsed() < REPLY_DEDUPE_WINDOW);
    recent
        .iter()
        .find(|(stored, _, _)| stored == key)
        .map(|(_, _, message)| message.clone())
}

fn remember_reply(key: String, message: Message) {
    if let Ok(mut recent) = RECENT_REPLIES.lock() {
        recent.retain(|(_, at, _)| at.elapsed() < REPLY_DEDUPE_WINDOW);
        recent.push((key, Instant::now(), message));
    }
}

#[tauri::command]
pub async fn messaging_microsoft_device_start(
    client_id: Option<String>,
    tenant: Option<String>,
    purpose: String,
) -> Result<DeviceStart, String> {
    blocking(move || microsoft::device_start(client_id.as_deref(), tenant.as_deref(), &purpose))
        .await
}

#[tauri::command]
pub async fn messaging_microsoft_device_poll(handle: String) -> Result<DevicePoll, String> {
    blocking(move || microsoft::device_poll(&handle)).await
}

#[tauri::command]
pub async fn messaging_browser_sign_in_start(
    purpose: String,
    client_id: Option<String>,
    client_secret: Option<String>,
    login_hint: Option<String>,
) -> Result<BrowserStart, String> {
    blocking(move || {
        oauth::start(
            oauth::Purpose::parse(&purpose)?,
            client_id.as_deref(),
            client_secret.as_deref(),
            login_hint.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn messaging_browser_sign_in_poll(handle: String) -> Result<BrowserPoll, String> {
    blocking(move || oauth::poll(&handle)).await
}

#[tauri::command]
pub async fn messaging_browser_sign_in_cancel(handle: String) -> Result<(), String> {
    oauth::cancel(&handle);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn secret(value: Value) -> Secret {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn empty_fields_keep_stored_values() {
        let mut stored = secret(json!({ "password": "old" }));
        merge_credentials(&mut stored, Some(&secret(json!({ "password": " " }))), None);
        assert_eq!(stored["password"], "old");
    }

    #[test]
    fn latest_slack_credential_wins() {
        let mut stored = secret(json!({ "slack": { "accessToken": "xoxp" } }));
        merge_credentials(
            &mut stored,
            Some(&secret(json!({ "botToken": "xoxb-1" }))),
            None,
        );
        assert!(!stored.contains_key("slack"));
        merge_credentials(
            &mut stored,
            None,
            Some(("slack", json!({ "accessToken": "xoxp-2" }))),
        );
        assert!(!stored.contains_key("botToken"));
        assert_eq!(stored["slack"]["accessToken"], "xoxp-2");
    }
}
