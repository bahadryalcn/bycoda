//! Microsoft identity platform device-code OAuth for Teams (Graph) and Outlook (IMAP/SMTP).
//! Tokens stay native: the UI only sees the user code and poll status.
use super::types::{now_ms, DevicePoll, DeviceStart, Secret};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const LOGIN_BASE: &str = "https://login.microsoftonline.com";
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PENDING: usize = 16;
/// Refresh when the access token expires within this window.
const REFRESH_MARGIN_MS: u64 = 60_000;
/// How long finished tokens wait for the account to be saved.
const DONE_KEEP: Duration = Duration::from_secs(600);
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
const MISSING_CLIENT_ID: &str =
    "Microsoft sign-in needs an app registration. Add a client ID in advanced options.";
pub(crate) const RECONNECT: &str = "Microsoft sign-in expired. Reconnect this account.";
const EXPIRED_REQUEST: &str = "This sign-in request expired. Start again.";

const TEAMS_SCOPE: &str = "https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/User.Read offline_access";
const OUTLOOK_SCOPE: &str = "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access";

struct Pending {
    device_code: String,
    client_id: String,
    tenant: String,
    scope: String,
    purpose: String,
    expires: Instant,
    interval: u64,
    next_poll: Instant,
    tokens: Option<Value>,
}

static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Parsed token endpoint reply.
#[derive(Debug, PartialEq)]
pub(crate) enum TokenOutcome {
    Tokens(TokenSet),
    Pending,
    SlowDown,
    Expired,
    Denied,
    InvalidGrant,
    Failed(String),
}

#[derive(Debug, PartialEq)]
pub(crate) struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

pub(crate) fn is_guid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

/// Explicit client ID wins; otherwise the build-time registration.
pub(crate) fn resolve_client_id(
    explicit: Option<&str>,
    built_in: Option<&str>,
) -> Result<String, String> {
    if let Some(id) = explicit.map(str::trim).filter(|id| !id.is_empty()) {
        if !is_guid(id) {
            return Err("The Microsoft client ID must be a GUID such as 00000000-0000-0000-0000-000000000000.".into());
        }
        return Ok(id.to_ascii_lowercase());
    }
    match built_in.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) if is_guid(id) => Ok(id.to_ascii_lowercase()),
        _ => Err(MISSING_CLIENT_ID.into()),
    }
}

fn built_in_client_id() -> Option<&'static str> {
    option_env!("BYCODA_MICROSOFT_CLIENT_ID")
}

/// Accepts common, organizations, consumers, a tenant GUID or a domain such as contoso.com.
pub(crate) fn normalize_tenant(tenant: Option<&str>) -> Result<String, String> {
    let tenant = tenant.map(str::trim).unwrap_or("").to_ascii_lowercase();
    if tenant.is_empty() {
        return Ok("common".into());
    }
    if matches!(tenant.as_str(), "common" | "organizations" | "consumers") || is_guid(&tenant) {
        return Ok(tenant);
    }
    let domain_like = tenant.len() <= 253
        && tenant.contains('.')
        && tenant.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        });
    if domain_like {
        Ok(tenant)
    } else {
        Err("Enter the tenant as common, organizations, consumers, a tenant ID or a domain.".into())
    }
}

pub(crate) fn purpose_scope(purpose: &str) -> Result<&'static str, String> {
    match purpose {
        "teams" => Ok(TEAMS_SCOPE),
        "outlook" => Ok(OUTLOOK_SCOPE),
        _ => Err("Unknown Microsoft sign-in purpose.".into()),
    }
}

/// First line of an identity-platform error, without trace/correlation details or long
/// opaque runs (which could echo a token), truncated for display.
pub(crate) fn sanitize_description(text: &str) -> String {
    let first = text.lines().next().unwrap_or("");
    let first = first
        .split(" Trace ID:")
        .next()
        .unwrap_or("")
        .split(" Correlation ID:")
        .next()
        .unwrap_or("");
    let cleaned: Vec<&str> = first
        .split_whitespace()
        .filter(|word| word.chars().count() <= 64)
        .collect();
    let mut cleaned = cleaned.join(" ");
    if cleaned.chars().count() > 300 {
        cleaned = cleaned.chars().take(300).collect::<String>() + "…";
    }
    cleaned
}

/// Adds the next step for registration problems the owner can fix in Entra.
fn friendly_error(code: &str, description: &str) -> String {
    let detail = sanitize_description(description);
    let hint = if description.contains("AADSTS7000218") {
        " Enable \"Allow public client flows\" in the app registration."
    } else if description.contains("AADSTS700016") || code == "unauthorized_client" {
        " Check the client ID and that the app registration allows this account type."
    } else if description.contains("AADSTS65001") || description.contains("AADSTS90094") {
        " An administrator may need to grant consent for this app."
    } else {
        ""
    };
    let base = if detail.is_empty() {
        code.to_string()
    } else {
        detail
    };
    format!("Microsoft sign-in failed: {base}{hint}")
}

pub(crate) fn parse_token_response(ok: bool, body: &Value) -> TokenOutcome {
    if ok {
        let access = body
            .get("access_token")
            .and_then(Value::as_str)
            .unwrap_or("");
        if access.is_empty() {
            return TokenOutcome::Failed("Microsoft sign-in returned no access token.".into());
        }
        return TokenOutcome::Tokens(TokenSet {
            access_token: access.to_string(),
            refresh_token: body
                .get("refresh_token")
                .and_then(Value::as_str)
                .filter(|token| !token.is_empty())
                .map(str::to_string),
            expires_in: number_field(body, "expires_in")
                .unwrap_or(3600)
                .clamp(60, 86_400),
        });
    }
    let code = body.get("error").and_then(Value::as_str).unwrap_or("");
    let description = body
        .get("error_description")
        .and_then(Value::as_str)
        .unwrap_or("");
    match code {
        "authorization_pending" => TokenOutcome::Pending,
        "slow_down" => TokenOutcome::SlowDown,
        "expired_token" | "code_expired" => TokenOutcome::Expired,
        "authorization_declined" | "access_denied" => TokenOutcome::Denied,
        "invalid_grant" | "interaction_required" => TokenOutcome::InvalidGrant,
        "" => TokenOutcome::Failed("Microsoft sign-in returned an unexpected response.".into()),
        _ => TokenOutcome::Failed(friendly_error(code, description)),
    }
}

/// Microsoft sends some numbers as strings.
fn number_field(body: &Value, key: &str) -> Option<u64> {
    match body.get(key)? {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn form_body(fields: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields)
        .finish()
}

/// Posts a form and returns (success, JSON body). Error statuses still carry OAuth JSON.
fn post_form(url: &str, fields: &[(&str, &str)]) -> Result<(bool, Value), String> {
    let response = crate::integrations::http::agent(HTTP_TIMEOUT, Some(0))
        .post(url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Accept", "application/json")
        .send_string(&form_body(fields));
    let (ok, response) = match response {
        Ok(response) => (true, response),
        Err(ureq::Error::Status(_, response)) => (false, response),
        Err(ureq::Error::Transport(error)) => {
            return Err(format!(
                "Could not reach Microsoft sign-in ({}).",
                error.kind()
            ));
        }
    };
    let text = response.into_string().unwrap_or_default();
    Ok((ok, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

fn tenant_url(tenant: &str, endpoint: &str) -> String {
    format!("{LOGIN_BASE}/{tenant}/oauth2/v2.0/{endpoint}")
}

/// Drops expired requests and, when full, the request closest to expiry.
fn prune(map: &mut HashMap<String, Pending>, now: Instant) {
    map.retain(|_, pending| pending.expires > now);
    while map.len() >= MAX_PENDING {
        let Some(oldest) = map
            .iter()
            .min_by_key(|(_, pending)| pending.expires)
            .map(|(handle, _)| handle.clone())
        else {
            break;
        };
        map.remove(&oldest);
    }
}

fn pending_map() -> Result<std::sync::MutexGuard<'static, HashMap<String, Pending>>, String> {
    PENDING
        .lock()
        .map_err(|_| "Microsoft sign-in is busy.".to_string())
}

pub(crate) fn device_start(
    client_id: Option<&str>,
    tenant: Option<&str>,
    purpose: &str,
) -> Result<DeviceStart, String> {
    let client_id = resolve_client_id(client_id, built_in_client_id())?;
    let tenant = normalize_tenant(tenant)?;
    let scope = purpose_scope(purpose)?;
    let (ok, body) = post_form(
        &tenant_url(&tenant, "devicecode"),
        &[("client_id", &client_id), ("scope", scope)],
    )?;
    if !ok {
        let code = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("request_failed");
        let description = body
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Err(friendly_error(code, description));
    }
    let text = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let device_code = text("device_code");
    let user_code = text("user_code");
    if device_code.is_empty() || user_code.is_empty() {
        return Err("Microsoft sign-in returned an unexpected response.".into());
    }
    let verification_uri = Some(text("verification_uri"))
        .filter(|uri| uri.starts_with("https://"))
        .unwrap_or_else(|| "https://microsoft.com/devicelogin".into());
    let expires_in = number_field(&body, "expires_in")
        .unwrap_or(900)
        .clamp(60, 3600);
    let interval = number_field(&body, "interval").unwrap_or(5).clamp(1, 60);
    let message = Some(text("message"))
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| format!("Open {verification_uri} and enter the code {user_code}."));
    let handle = uuid::Uuid::new_v4().to_string();
    let now = Instant::now();
    let mut map = pending_map()?;
    prune(&mut map, now);
    map.insert(
        handle.clone(),
        Pending {
            device_code,
            client_id,
            tenant,
            scope: scope.to_string(),
            purpose: purpose.to_string(),
            expires: now + Duration::from_secs(expires_in),
            interval,
            next_poll: now,
            tokens: None,
        },
    );
    Ok(DeviceStart {
        handle,
        user_code,
        verification_uri,
        expires_in,
        interval,
        message,
    })
}

fn poll_status(status: &str, error: Option<&str>) -> DevicePoll {
    DevicePoll {
        status: status.into(),
        error: error.map(str::to_string),
    }
}

/// Stored token shape shared by Teams and Outlook.
pub(crate) fn token_record(
    tokens: &TokenSet,
    client_id: &str,
    tenant: &str,
    scope: &str,
    purpose: &str,
    now: u64,
) -> Value {
    json!({
        "accessToken": tokens.access_token,
        "refreshToken": tokens.refresh_token.clone().unwrap_or_default(),
        "expiresAt": now + tokens.expires_in * 1000,
        "clientId": client_id,
        "tenant": tenant,
        "scope": scope,
        "purpose": purpose,
    })
}

/// One poll; the UI repeats it at `interval`. Early polls answer "pending" locally so a
/// `slow_down` reply is honored even though the UI keeps its own timer.
pub(crate) fn device_poll(handle: &str) -> Result<DevicePoll, String> {
    let now = Instant::now();
    let (client_id, tenant, device_code) = {
        let mut map = pending_map()?;
        prune(&mut map, now);
        let Some(pending) = map.get(handle) else {
            return Ok(poll_status("expired", Some(EXPIRED_REQUEST)));
        };
        if pending.tokens.is_some() {
            return Ok(poll_status("done", None));
        }
        if now < pending.next_poll {
            return Ok(poll_status("pending", None));
        }
        (
            pending.client_id.clone(),
            pending.tenant.clone(),
            pending.device_code.clone(),
        )
    };
    let (ok, body) = post_form(
        &tenant_url(&tenant, "token"),
        &[
            ("grant_type", DEVICE_GRANT),
            ("client_id", &client_id),
            ("device_code", &device_code),
        ],
    )?;
    let outcome = parse_token_response(ok, &body);
    let now = Instant::now();
    let mut map = pending_map()?;
    let Some(pending) = map.get_mut(handle) else {
        return Ok(poll_status("expired", Some(EXPIRED_REQUEST)));
    };
    match outcome {
        TokenOutcome::Tokens(tokens) => {
            pending.tokens = Some(token_record(
                &tokens,
                &pending.client_id,
                &pending.tenant,
                &pending.scope,
                &pending.purpose,
                now_ms(),
            ));
            pending.expires = now + DONE_KEEP;
            Ok(poll_status("done", None))
        }
        TokenOutcome::Pending => {
            pending.next_poll = now + Duration::from_secs(pending.interval);
            Ok(poll_status("pending", None))
        }
        TokenOutcome::SlowDown => {
            pending.interval = (pending.interval + 5).min(60);
            pending.next_poll = now + Duration::from_secs(pending.interval);
            Ok(poll_status("pending", None))
        }
        TokenOutcome::Expired => {
            map.remove(handle);
            Ok(poll_status("expired", Some(EXPIRED_REQUEST)))
        }
        TokenOutcome::Denied => {
            map.remove(handle);
            Ok(poll_status(
                "denied",
                Some("Microsoft sign-in was declined."),
            ))
        }
        TokenOutcome::InvalidGrant => {
            map.remove(handle);
            Ok(poll_status("expired", Some(EXPIRED_REQUEST)))
        }
        TokenOutcome::Failed(message) => {
            map.remove(handle);
            Err(message)
        }
    }
}

/// Returns finished device-flow tokens without consuming them, so a failed save can retry.
pub(crate) fn device_tokens(handle: &str) -> Result<Value, String> {
    let mut map = pending_map()?;
    prune(&mut map, Instant::now());
    match map.get(handle) {
        None => Err(EXPIRED_REQUEST.into()),
        Some(Pending { tokens: None, .. }) => Err("Finish Microsoft sign-in first.".into()),
        Some(Pending {
            tokens: Some(tokens),
            ..
        }) => Ok(tokens.clone()),
    }
}

/// Forgets a device flow once its tokens are stored with an account.
pub(crate) fn forget_device_flow(handle: &str) {
    if let Ok(mut map) = pending_map() {
        map.remove(handle);
    }
}

pub(crate) fn needs_refresh(expires_at: u64, now: u64) -> bool {
    expires_at <= now.saturating_add(REFRESH_MARGIN_MS)
}

fn record_mut(secret: &mut Secret) -> Result<&mut Map<String, Value>, String> {
    secret
        .get_mut("microsoft")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Microsoft sign-in is missing. Reconnect this account.".to_string())
}

fn record_str<'a>(record: &'a Map<String, Value>, key: &str) -> &'a str {
    record.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Writes refreshed tokens into the stored record, keeping the old refresh token when
/// Microsoft does not rotate it.
pub(crate) fn apply_refresh(record: &mut Map<String, Value>, tokens: &TokenSet, now: u64) {
    record.insert("accessToken".into(), json!(tokens.access_token));
    if let Some(refresh) = &tokens.refresh_token {
        record.insert("refreshToken".into(), json!(refresh));
    }
    record.insert("expiresAt".into(), json!(now + tokens.expires_in * 1000));
}

/// Returns a valid access token from `secret["microsoft"]`, refreshing and updating it
/// in place when it expires within a minute.
pub(crate) fn access_token(secret: &mut Secret) -> Result<String, String> {
    let record = record_mut(secret)?;
    let access = record_str(record, "accessToken");
    let expires_at = record.get("expiresAt").and_then(Value::as_u64).unwrap_or(0);
    if !access.is_empty() && !needs_refresh(expires_at, now_ms()) {
        return Ok(access.to_string());
    }
    refresh_access_token(secret)
}

/// Refreshes unconditionally (for example after a 401) and stores the new tokens.
pub(crate) fn refresh_access_token(secret: &mut Secret) -> Result<String, String> {
    let record = record_mut(secret)?;
    let refresh = record_str(record, "refreshToken").to_string();
    if refresh.is_empty() {
        return Err(RECONNECT.into());
    }
    let client_id = resolve_client_id(Some(record_str(record, "clientId")), None)
        .map_err(|_| RECONNECT.to_string())?;
    let tenant = normalize_tenant(Some(record_str(record, "tenant")))?;
    let scope = match record_str(record, "scope") {
        "" => purpose_scope(record_str(record, "purpose"))?.to_string(),
        scope => scope.to_string(),
    };
    let (ok, body) = post_form(
        &tenant_url(&tenant, "token"),
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &client_id),
            ("refresh_token", &refresh),
            ("scope", &scope),
        ],
    )?;
    match parse_token_response(ok, &body) {
        TokenOutcome::Tokens(tokens) => {
            apply_refresh(record_mut(secret)?, &tokens, now_ms());
            Ok(tokens.access_token)
        }
        TokenOutcome::InvalidGrant | TokenOutcome::Expired | TokenOutcome::Denied => {
            Err(RECONNECT.into())
        }
        TokenOutcome::Failed(message) => Err(message),
        TokenOutcome::Pending | TokenOutcome::SlowDown => {
            Err("Microsoft sign-in returned an unexpected response.".into())
        }
    }
}

#[cfg(test)]
#[path = "microsoft_tests.rs"]
mod tests;
