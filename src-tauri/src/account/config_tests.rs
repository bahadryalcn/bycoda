use super::config::*;
use super::error::{AccountError, ErrorKind};
use std::collections::HashMap;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    move |name| map.get(name).cloned()
}

fn both() -> Compiled {
    Compiled {
        environment: None,
        production: EnvValues {
            api_url: Some("https://api.prod.test"),
            issuer: Some("https://clerk.prod.test"),
            client_id: Some("prod-client"),
        },
        staging: EnvValues {
            api_url: Some("https://api.stage.test"),
            issuer: Some("https://clerk.stage.test"),
            client_id: Some("stage-client"),
        },
    }
}

fn kind(result: Result<Config, AccountError>) -> ErrorKind {
    result.unwrap_err().kind
}

#[test]
fn nothing_compiled_in_means_not_configured() {
    for debug in [true, false] {
        assert_eq!(
            kind(resolve_from(env(&[]), Compiled::default(), debug)),
            ErrorKind::NotConfigured
        );
    }
}

#[test]
fn compiled_production_values_are_used() {
    let config = resolve_from(env(&[]), both(), false).unwrap();
    assert_eq!(config.api_base_url, "https://api.prod.test");
    assert_eq!(config.issuer, "https://clerk.prod.test");
    assert_eq!(config.environment, Environment::Production);
    assert_eq!(config.require_client_id().ok(), Some("prod-client"));
}

#[test]
fn a_missing_value_of_the_selected_environment_is_not_configured() {
    let mut compiled = both();
    compiled.production.client_id = None;
    assert_eq!(
        kind(resolve_from(env(&[]), compiled, false)),
        ErrorKind::NotConfigured
    );
    let mut compiled = both();
    compiled.staging = EnvValues::default();
    let selected = env(&[("BYCODA_ACCOUNT_ENV", "staging")]);
    assert_eq!(
        kind(resolve_from(selected, compiled, false)),
        ErrorKind::NotConfigured
    );
}

#[test]
fn runtime_selector_picks_staging_values_in_release() {
    let config = resolve_from(env(&[("BYCODA_ACCOUNT_ENV", "staging")]), both(), false).unwrap();
    assert_eq!(config.environment, Environment::Staging);
    assert_eq!(config.api_base_url, "https://api.stage.test");
    assert_eq!(config.issuer, "https://clerk.stage.test");
    assert_eq!(config.client_id.as_deref(), Some("stage-client"));
}

#[test]
fn compiled_selector_is_the_default() {
    let compiled = Compiled {
        environment: Some("staging"),
        ..both()
    };
    let config = resolve_from(env(&[]), compiled, false).unwrap();
    assert_eq!(config.environment, Environment::Staging);
}

#[test]
fn debug_runtime_overrides_win_over_compiled() {
    let config = resolve_from(
        env(&[
            ("BYCODA_ACCOUNT_ENV", "staging"),
            ("BYCODA_STAGING_ACCOUNT_API_URL", "https://override.test/"),
            ("BYCODA_STAGING_CLERK_CLIENT_ID", " runtime-id "),
        ]),
        both(),
        true,
    )
    .unwrap();
    assert_eq!(config.api_base_url, "https://override.test");
    assert_eq!(config.client_id.as_deref(), Some("runtime-id"));
}

#[test]
fn debug_runtime_values_work_without_compiled_ones() {
    let config = resolve_from(
        env(&[
            ("BYCODA_ACCOUNT_API_URL", "http://127.0.0.1:8787"),
            ("BYCODA_CLERK_ISSUER", "https://clerk.local.test"),
            ("BYCODA_CLERK_CLIENT_ID", "local-id"),
        ]),
        Compiled::default(),
        true,
    )
    .unwrap();
    assert_eq!(config.api_base_url, "http://127.0.0.1:8787");
}

#[test]
fn insecure_or_malformed_origins_are_not_configured() {
    for bad in [
        "http://api.example.com",
        "ftp://x",
        "not a url",
        "https://x/?q=1",
    ] {
        let result = resolve_from(env(&[("BYCODA_ACCOUNT_API_URL", bad)]), both(), true);
        assert_eq!(kind(result), ErrorKind::NotConfigured, "{bad}");
    }
    assert!(valid_origin("http://127.0.0.1:8787").is_some());
}

#[test]
fn keychain_account_is_scoped_to_the_issuer() {
    let production = resolve_from(env(&[]), both(), false).unwrap();
    let staging = resolve_from(env(&[("BYCODA_ACCOUNT_ENV", "staging")]), both(), false).unwrap();
    assert_ne!(production.keychain_account(), staging.keychain_account());
}

#[test]
fn release_builds_ignore_runtime_endpoint_overrides() {
    let config = resolve_from(
        env(&[
            ("BYCODA_CLERK_ISSUER", "https://evil.example"),
            ("BYCODA_ACCOUNT_API_URL", "https://evil.example"),
            ("BYCODA_CLERK_CLIENT_ID", "evil-id"),
        ]),
        both(),
        false,
    )
    .unwrap();
    assert_eq!(config.api_base_url, "https://api.prod.test");
    assert_eq!(config.issuer, "https://clerk.prod.test");
    assert_eq!(config.client_id.as_deref(), Some("prod-client"));
    let staging = resolve_from(
        env(&[
            ("BYCODA_ACCOUNT_ENV", "staging"),
            ("BYCODA_STAGING_ACCOUNT_API_URL", "https://evil.example"),
        ]),
        both(),
        false,
    )
    .unwrap();
    assert_eq!(staging.api_base_url, "https://api.stage.test");
}
