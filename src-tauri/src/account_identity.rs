use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::dirs_home;

const CLAUDE_PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";

#[derive(Serialize, Default, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountIdentity {
    pub email: Option<String>,
    pub name: Option<String>,
    pub plan: Option<String>,
    pub organization: Option<String>,
}

/// Read the signed-in identity of an account profile. Claude is asked who the
/// stored token belongs to (the token only goes to Anthropic); the identity
/// the CLI cached on disk is the offline fallback. Returns `None` when the
/// profile is not signed in.
#[tauri::command]
pub async fn provider_account_identity(
    app: AppHandle,
    provider: String,
    account_id: Option<String>,
) -> Result<Option<ProviderAccountIdentity>, String> {
    let dir = crate::harness::provider_account_dir(&app, &provider, account_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || match provider.as_str() {
        "claude" => Ok(claude_identity(dir)),
        "codex" => Ok(codex_identity(dir)),
        _ => Err("Account identity is not supported for this provider".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}

fn home() -> Option<PathBuf> {
    dirs_home().map(PathBuf::from)
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

fn claude_identity(dir: Option<PathBuf>) -> Option<ProviderAccountIdentity> {
    let creds = crate::rate_limits::read_claude_credentials(dir.as_deref());
    if let Some(creds) = &creds {
        if let Some(live) = live_claude_identity(&dir, creds) {
            return Some(live);
        }
    }
    let path = match dir {
        Some(dir) => dir.join(".claude.json"),
        None => home()?.join(".claude.json"),
    };
    let cached = read_json(&path).and_then(|config| parse_claude_identity(&config));
    reconcile_cached_identity(cached, creds.and_then(|creds| creds.subscription_type))
}

/// Ask Anthropic who owns the token. `.claude.json` keeps the identity of an
/// earlier sign-in when the credentials are replaced without rewriting it, so
/// the cache alone can name the wrong account.
fn live_claude_identity(
    dir: &Option<PathBuf>,
    creds: &crate::rate_limits::ClaudeCredentials,
) -> Option<ProviderAccountIdentity> {
    // One entry per profile; a new token (re-login or refresh) replaces it.
    static KNOWN: std::sync::Mutex<Vec<(Option<PathBuf>, String, ProviderAccountIdentity)>> =
        std::sync::Mutex::new(Vec::new());
    let lock = || KNOWN.lock().unwrap_or_else(|error| error.into_inner());

    if let Some((_, _, identity)) = lock()
        .iter()
        .find(|(known_dir, token, _)| known_dir == dir && *token == creds.access_token)
    {
        return Some(identity.clone());
    }
    if crate::rate_limits::claude_token_expired(creds) {
        return None;
    }
    let body = crate::rate_limits::claude_oauth_get(CLAUDE_PROFILE_URL, &creds.access_token)
        .ok()?
        .into_string()
        .ok()?;
    let identity = parse_claude_profile(&serde_json::from_str(&body).ok()?)?;
    let mut known = lock();
    known.retain(|(known_dir, _, _)| known_dir != dir);
    known.push((dir.clone(), creds.access_token.clone(), identity.clone()));
    Some(identity)
}

/// Parse the `/api/oauth/profile` response.
fn parse_claude_profile(profile: &Value) -> Option<ProviderAccountIdentity> {
    let account = profile.get("account")?;
    let organization = profile.get("organization");
    Some(ProviderAccountIdentity {
        email: text(account, "email"),
        name: text(account, "display_name").or_else(|| text(account, "full_name")),
        plan: organization
            .and_then(|org| text(org, "organization_type"))
            .map(|kind| capitalize(kind.strip_prefix("claude_").unwrap_or(&kind))),
        organization: organization.and_then(|org| text(org, "name")),
    })
}

/// A cached identity whose plan disagrees with the token's plan belongs to a
/// different sign-in; keep only what the token itself states.
fn reconcile_cached_identity(
    cached: Option<ProviderAccountIdentity>,
    token_plan: Option<String>,
) -> Option<ProviderAccountIdentity> {
    let token_plan = token_plan.map(|plan| capitalize(&plan));
    match (&cached, &token_plan) {
        (Some(identity), Some(plan))
            if identity
                .plan
                .as_ref()
                .is_some_and(|cached_plan| !cached_plan.eq_ignore_ascii_case(plan)) =>
        {
            Some(ProviderAccountIdentity {
                plan: token_plan,
                ..Default::default()
            })
        }
        _ => cached,
    }
}

/// Parse the `oauthAccount` block Claude Code writes to `.claude.json`.
fn parse_claude_identity(config: &Value) -> Option<ProviderAccountIdentity> {
    let account = config.get("oauthAccount")?;
    // organizationType is e.g. "claude_max", "claude_pro", "claude_team".
    let plan = text(account, "organizationType")
        .map(|kind| capitalize(kind.strip_prefix("claude_").unwrap_or(&kind)));
    Some(ProviderAccountIdentity {
        email: text(account, "emailAddress"),
        name: text(account, "displayName").or_else(|| text(account, "fullName")),
        plan,
        organization: text(account, "organizationName"),
    })
}

fn codex_identity(dir: Option<PathBuf>) -> Option<ProviderAccountIdentity> {
    let dir = match dir {
        Some(dir) => dir,
        None => std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|home| home.join(".codex")))?,
    };
    parse_codex_identity(&read_json(&dir.join("auth.json"))?)
}

/// Parse the claims of the `id_token` in Codex's `auth.json`.
fn parse_codex_identity(auth: &Value) -> Option<ProviderAccountIdentity> {
    let id_token = auth.get("tokens")?.get("id_token")?.as_str()?;
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    let openai = claims.get("https://api.openai.com/auth");
    let organization = openai
        .and_then(|auth| auth.get("organizations"))
        .and_then(Value::as_array)
        .and_then(|orgs| {
            orgs.iter()
                .find(|org| org.get("is_default").and_then(Value::as_bool) == Some(true))
        })
        .and_then(|org| text(org, "title"));
    Some(ProviderAccountIdentity {
        email: text(&claims, "email").or_else(|| {
            claims
                .get("https://api.openai.com/profile")
                .and_then(|profile| text(profile, "email"))
        }),
        name: text(&claims, "name"),
        plan: openai
            .and_then(|auth| text(auth, "chatgpt_plan_type"))
            .map(|plan| capitalize(&plan)),
        organization,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn identity(
        email: Option<&str>,
        name: Option<&str>,
        plan: Option<&str>,
        organization: Option<&str>,
    ) -> Option<ProviderAccountIdentity> {
        Some(ProviderAccountIdentity {
            email: email.map(String::from),
            name: name.map(String::from),
            plan: plan.map(String::from),
            organization: organization.map(String::from),
        })
    }

    fn codex_auth(claims: Value) -> Value {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).unwrap());
        json!({ "tokens": { "id_token": format!("header.{payload}.signature") } })
    }

    #[test]
    fn claude_reads_oauth_account() {
        let config = json!({
            "oauthAccount": {
                "emailAddress": "ada@example.com",
                "displayName": "Ada",
                "fullName": "Ada Lovelace",
                "organizationType": "claude_team",
                "organizationName": "Acme"
            }
        });
        assert_eq!(
            parse_claude_identity(&config),
            identity(
                Some("ada@example.com"),
                Some("Ada"),
                Some("Team"),
                Some("Acme")
            )
        );
    }

    #[test]
    fn claude_falls_back_to_full_name_and_keeps_missing_email_optional() {
        let config = json!({
            "oauthAccount": { "fullName": "Ada Lovelace", "organizationType": "claude_max" }
        });
        assert_eq!(
            parse_claude_identity(&config),
            identity(None, Some("Ada Lovelace"), Some("Max"), None)
        );
    }

    #[test]
    fn claude_without_oauth_account_is_signed_out() {
        assert_eq!(parse_claude_identity(&json!({ "numStartups": 3 })), None);
    }

    #[test]
    fn claude_reads_live_profile() {
        let profile = json!({
            "account": { "email": "ada@example.com", "display_name": "Ada" },
            "organization": { "name": "Acme", "organization_type": "claude_max" }
        });
        assert_eq!(
            parse_claude_profile(&profile),
            identity(
                Some("ada@example.com"),
                Some("Ada"),
                Some("Max"),
                Some("Acme")
            )
        );
        assert_eq!(parse_claude_profile(&json!({ "error": "nope" })), None);
    }

    #[test]
    fn cached_identity_of_another_plan_is_not_trusted() {
        let cached = || {
            identity(
                Some("ada@acme.com"),
                Some("Ada"),
                Some("Team"),
                Some("Acme"),
            )
        };
        assert_eq!(
            reconcile_cached_identity(cached(), Some("max".into())),
            identity(None, None, Some("Max"), None)
        );
        assert_eq!(
            reconcile_cached_identity(cached(), Some("team".into())),
            cached()
        );
        assert_eq!(reconcile_cached_identity(cached(), None), cached());
        assert_eq!(reconcile_cached_identity(None, Some("max".into())), None);
    }

    #[test]
    fn codex_reads_id_token_claims() {
        let auth = codex_auth(json!({
            "email": "ada@example.com",
            "name": "Ada",
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "plus",
                "organizations": [
                    { "title": "Other", "is_default": false },
                    { "title": "Personal", "is_default": true }
                ]
            }
        }));
        assert_eq!(
            parse_codex_identity(&auth),
            identity(
                Some("ada@example.com"),
                Some("Ada"),
                Some("Plus"),
                Some("Personal")
            )
        );
    }

    #[test]
    fn codex_falls_back_to_namespaced_profile_email() {
        let auth = codex_auth(json!({
            "https://api.openai.com/profile": { "email": "ada@example.com" }
        }));
        assert_eq!(
            parse_codex_identity(&auth),
            identity(Some("ada@example.com"), None, None, None)
        );
    }

    #[test]
    fn codex_rejects_malformed_tokens() {
        let token = |id_token: &str| json!({ "tokens": { "id_token": id_token } });
        assert_eq!(parse_codex_identity(&token("no-dots")), None);
        assert_eq!(parse_codex_identity(&token("header.!!!.signature")), None);
        let not_json = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("not json");
        assert_eq!(
            parse_codex_identity(&token(&format!("h.{not_json}.s"))),
            None
        );
        assert_eq!(
            parse_codex_identity(&json!({ "OPENAI_API_KEY": "sk-x" })),
            None
        );
    }
}
