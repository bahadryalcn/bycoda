use super::tokens::*;
use serde_json::json;

fn endpoints() -> Endpoints {
    Endpoints {
        authorization: "https://clerk.example/oauth/authorize".into(),
        token: "https://clerk.example/oauth/token".into(),
        revocation: None,
    }
}

#[test]
fn authorize_url_is_a_pkce_s256_public_client_request() {
    let url = authorize_url(
        &endpoints(),
        "client1",
        "http://127.0.0.1:5000/callback",
        "st",
        "ch",
    )
    .unwrap();
    let parsed = url::Url::parse(&url).unwrap();
    let query: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    assert_eq!(parsed.host_str(), Some("clerk.example"));
    assert_eq!(query["response_type"], "code");
    assert_eq!(query["code_challenge_method"], "S256");
    assert_eq!(query["code_challenge"], "ch");
    assert_eq!(query["state"], "st");
    assert_eq!(query["redirect_uri"], "http://127.0.0.1:5000/callback");
    assert_eq!(query["scope"], "profile email offline_access");
    assert!(!query.contains_key("client_secret"));
}

#[test]
fn token_reply_is_parsed_and_clamped() {
    let tokens = parse_token_response(
        200,
        &json!({ "access_token": " a ", "refresh_token": "r", "expires_in": 5 }),
    )
    .unwrap();
    assert_eq!(tokens.access_token, "a");
    assert_eq!(tokens.refresh_token.as_deref(), Some("r"));
    assert_eq!(tokens.expires_in, 60);
    let no_rotation = parse_token_response(200, &json!({ "access_token": "a" })).unwrap();
    assert_eq!(no_rotation.refresh_token, None);
    assert_eq!(no_rotation.expires_in, 3600);
}

#[test]
fn rejected_grants_end_the_session() {
    for body in [
        json!({ "error": "invalid_grant" }),
        json!({ "error": "invalid_token" }),
        json!({ "error": "unauthorized_client" }),
    ] {
        assert_eq!(
            parse_token_response(400, &body),
            Err(TokenError::InvalidGrant)
        );
    }
    assert_eq!(
        parse_token_response(401, &json!(null)),
        Err(TokenError::InvalidGrant)
    );
}

#[test]
fn service_trouble_keeps_the_session() {
    assert!(matches!(
        parse_token_response(503, &json!(null)),
        Err(TokenError::Failed(_))
    ));
    assert!(matches!(
        parse_token_response(400, &json!({ "error": "server_error" })),
        Err(TokenError::Failed(_))
    ));
    assert!(matches!(
        parse_token_response(200, &json!({})),
        Err(TokenError::Failed(_))
    ));
}

#[test]
fn error_text_is_sanitized() {
    let Err(TokenError::Failed(message)) =
        parse_token_response(400, &json!({ "error": "x<script>alert(1)" }))
    else {
        panic!("expected failure");
    };
    assert!(!message.contains('<'));
}

#[test]
fn discovery_requires_secure_endpoints() {
    let found = parse_discovery(&json!({
        "authorization_endpoint": "https://clerk.example/oauth/authorize",
        "token_endpoint": "https://clerk.example/oauth/token",
        "revocation_endpoint": "https://clerk.example/oauth/token/revoke",
    }))
    .unwrap();
    assert!(found.revocation.is_some());
    assert!(parse_discovery(&json!({
        "authorization_endpoint": "http://clerk.example/oauth/authorize",
        "token_endpoint": "https://clerk.example/oauth/token",
    }))
    .is_none());
    assert!(parse_discovery(&json!({})).is_none());
}
