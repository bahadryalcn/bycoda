use super::*;
use crate::oauth_loopback::parse_callback;
use std::io::Write;
use std::net::TcpStream;

#[test]
fn challenge_matches_rfc7636_example() {
    assert_eq!(
        code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[test]
fn google_authorize_url_has_pkce_offline_and_hint() {
    let url = authorize_url(
        Purpose::Google,
        "id.apps.googleusercontent.com",
        "http://127.0.0.1:5000/callback",
        "st",
        "ch",
        Some("ada@gmail.com"),
    );
    let parsed = url::Url::parse(&url).unwrap();
    let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    assert_eq!(parsed.host_str(), Some("accounts.google.com"));
    assert_eq!(query["code_challenge_method"], "S256");
    assert_eq!(query["access_type"], "offline");
    assert_eq!(query["scope"], GOOGLE_SCOPE);
    assert_eq!(query["login_hint"], "ada@gmail.com");
    assert_eq!(query["redirect_uri"], "http://127.0.0.1:5000/callback");
}

#[test]
fn slack_authorize_url_requests_only_user_scopes() {
    let url = authorize_url(
        Purpose::Slack,
        "123.456",
        &redirect_uri(Purpose::Slack, SLACK_REDIRECT_PORT),
        "st",
        "ch",
        None,
    );
    let query: HashMap<String, String> = url::Url::parse(&url)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect();
    assert_eq!(query["scope"], "");
    assert_eq!(query["user_scope"], SLACK_USER_SCOPE);
    assert_eq!(query["redirect_uri"], "https://bycoda.codes/oauth/slack/");
}

#[test]
fn callback_accepts_only_matching_state_and_path() {
    assert_eq!(
        parse_callback("GET /callback?code=abc&state=s1 HTTP/1.1", "s1"),
        Callback::Code("abc".into())
    );
    assert_eq!(
        parse_callback("GET /callback?code=abc&state=other HTTP/1.1", "s1"),
        Callback::Ignore
    );
    assert_eq!(
        parse_callback("GET /favicon.ico HTTP/1.1", "s1"),
        Callback::Ignore
    );
    assert_eq!(
        parse_callback("POST /callback?code=abc&state=s1 HTTP/1.1", "s1"),
        Callback::Ignore
    );
    assert_eq!(
        parse_callback("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1"),
        Callback::Denied
    );
    assert_eq!(
        parse_callback("GET /callback?error=<script>&state=s1 HTTP/1.1", "s1"),
        Callback::Error("script".into(), String::new())
    );
}

#[test]
fn google_tokens_parse_and_invalid_grant_reconnects() {
    let tokens = parse_tokens(
        Purpose::Google,
        &json!({ "access_token": "a", "refresh_token": "r", "expires_in": 3599 }),
    )
    .unwrap();
    assert_eq!(tokens.refresh_token.as_deref(), Some("r"));
    assert_eq!(tokens.expires_in, Some(3599));
    assert_eq!(
        parse_tokens(Purpose::Google, &json!({ "error": "invalid_grant" })),
        Err(TokenError::Reconnect)
    );
}

#[test]
fn slack_exchange_reads_authed_user_and_refresh_reads_top_level() {
    let exchange = parse_tokens(
        Purpose::Slack,
        &json!({
            "ok": true,
            "authed_user": { "id": "U1", "access_token": "xoxp-1", "refresh_token": "xoxe-1", "expires_in": 43200 },
            "team": { "name": "Acme" }
        }),
    )
    .unwrap();
    assert_eq!(exchange.access_token, "xoxp-1");
    assert_eq!(exchange.user_id.as_deref(), Some("U1"));
    assert_eq!(exchange.team.as_deref(), Some("Acme"));
    let refresh = parse_tokens(
        Purpose::Slack,
        &json!({ "ok": true, "access_token": "xoxe.xoxp-2", "refresh_token": "xoxe-2", "expires_in": 43200 }),
    )
    .unwrap();
    assert_eq!(refresh.access_token, "xoxe.xoxp-2");
    let no_rotation = parse_tokens(
        Purpose::Slack,
        &json!({ "ok": true, "authed_user": { "id": "U1", "access_token": "xoxp-1" } }),
    )
    .unwrap();
    assert_eq!(no_rotation.expires_in, None);
    assert_eq!(
        parse_tokens(
            Purpose::Slack,
            &json!({ "ok": false, "error": "invalid_refresh_token" })
        ),
        Err(TokenError::Reconnect)
    );
}

#[test]
fn non_expiring_tokens_never_refresh() {
    assert!(!needs_refresh(0, 1_000));
    assert!(needs_refresh(1_000, 1_000));
    assert!(!needs_refresh(1_000_000, 1_000));
}

#[test]
fn refresh_keeps_old_refresh_token_when_not_rotated() {
    let mut record = json!({ "accessToken": "a", "refreshToken": "keep", "expiresAt": 1 })
        .as_object()
        .unwrap()
        .clone();
    let tokens = Tokens {
        access_token: "b".into(),
        refresh_token: None,
        expires_in: Some(60),
        user_id: None,
        team: None,
    };
    apply_refresh(&mut record, &tokens, 1_000);
    assert_eq!(record["accessToken"], "b");
    assert_eq!(record["refreshToken"], "keep");
    assert_eq!(record["expiresAt"], 61_000);
}

#[test]
fn explicit_client_wins_and_is_validated() {
    let client = resolve_client(Purpose::Slack, Some(" 123.456 "), None).unwrap();
    assert_eq!(client.id, "123.456");
    assert!(resolve_client(Purpose::Slack, Some("abc def"), None).is_err());
    let google = resolve_client(
        Purpose::Google,
        Some("1-abc.apps.googleusercontent.com"),
        Some("s"),
    )
    .unwrap();
    assert_eq!(google.secret.as_deref(), Some("s"));
}

#[test]
fn loopback_flow_reports_denied_and_frees_handle_on_cancel() {
    let start = start(
        Purpose::Google,
        Some("1-abc.apps.googleusercontent.com"),
        None,
        None,
    )
    .unwrap();
    let parsed = url::Url::parse(&start.authorize_url).unwrap();
    let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    let redirect = url::Url::parse(&query["redirect_uri"]).unwrap();
    let port = redirect.port().unwrap();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(
        stream,
        "GET /callback?error=access_denied&state={} HTTP/1.1\r\nHost: x\r\n\r\n",
        query["state"]
    )
    .unwrap();
    let mut reply = String::new();
    std::io::Read::read_to_string(&mut stream, &mut reply).unwrap();
    assert!(reply.starts_with("HTTP/1.1 200"));
    assert_eq!(poll(&start.handle).unwrap().status, "denied");
    assert!(owns(&start.handle));
    cancel(&start.handle);
    assert_eq!(poll(&start.handle).unwrap().status, "expired");
}
