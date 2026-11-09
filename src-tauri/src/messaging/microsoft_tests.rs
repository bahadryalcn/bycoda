use super::*;
use serde_json::json;

const GUID: &str = "1b2c3d4e-0000-4abc-8def-0123456789ab";

#[test]
fn guid_check_requires_canonical_form() {
    assert!(is_guid(GUID));
    assert!(is_guid(&GUID.to_ascii_uppercase()));
    assert!(!is_guid("1b2c3d4e00004abc8def0123456789ab"));
    assert!(!is_guid("{1b2c3d4e-0000-4abc-8def-0123456789ab}"));
    assert!(!is_guid("1b2c3d4e-0000-4abc-8def-0123456789az"));
    assert!(!is_guid(""));
}

#[test]
fn client_id_prefers_explicit_then_built_in() {
    assert_eq!(
        resolve_client_id(Some(&format!(" {GUID} ")), None),
        Ok(GUID.into())
    );
    assert_eq!(
        resolve_client_id(Some(&GUID.to_ascii_uppercase()), Some("x")),
        Ok(GUID.into())
    );
    assert_eq!(resolve_client_id(Some("  "), Some(GUID)), Ok(GUID.into()));
    assert_eq!(resolve_client_id(None, Some(GUID)), Ok(GUID.into()));
    assert!(resolve_client_id(Some("not-a-guid"), Some(GUID))
        .unwrap_err()
        .contains("GUID"));
    assert_eq!(resolve_client_id(None, None), Err(MISSING_CLIENT_ID.into()));
    assert_eq!(
        resolve_client_id(None, Some("bogus")),
        Err(MISSING_CLIENT_ID.into())
    );
}

#[test]
fn tenant_accepts_known_values_guids_and_domains() {
    assert_eq!(normalize_tenant(None), Ok("common".into()));
    assert_eq!(normalize_tenant(Some(" ")), Ok("common".into()));
    assert_eq!(
        normalize_tenant(Some("Organizations")),
        Ok("organizations".into())
    );
    assert_eq!(normalize_tenant(Some("consumers")), Ok("consumers".into()));
    assert_eq!(normalize_tenant(Some(GUID)), Ok(GUID.into()));
    assert_eq!(
        normalize_tenant(Some("Contoso.onmicrosoft.com")),
        Ok("contoso.onmicrosoft.com".into())
    );
    for bad in [
        "contoso", "a/b.com", "../x.com", "x..com", "-x.com", "x.com?y", "a b.com",
    ] {
        assert!(normalize_tenant(Some(bad)).is_err(), "{bad}");
    }
}

#[test]
fn purposes_map_to_scopes() {
    let teams = purpose_scope("teams").unwrap();
    assert!(teams.contains("https://graph.microsoft.com/Chat.ReadWrite"));
    assert!(teams.contains("User.Read"));
    assert!(teams.ends_with("offline_access"));
    let outlook = purpose_scope("outlook").unwrap();
    assert!(outlook.contains("https://outlook.office.com/IMAP.AccessAsUser.All"));
    assert!(outlook.contains("https://outlook.office.com/SMTP.Send"));
    assert!(outlook.ends_with("offline_access"));
    assert!(purpose_scope("Teams").is_err());
    assert!(purpose_scope("").is_err());
}

#[test]
fn token_success_parses_tokens_and_string_numbers() {
    let body = json!({ "access_token": "at", "refresh_token": "rt", "expires_in": "3599" });
    assert_eq!(
        parse_token_response(true, &body),
        TokenOutcome::Tokens(TokenSet {
            access_token: "at".into(),
            refresh_token: Some("rt".into()),
            expires_in: 3599
        })
    );
    let body = json!({ "access_token": "at", "refresh_token": "" });
    assert_eq!(
        parse_token_response(true, &body),
        TokenOutcome::Tokens(TokenSet {
            access_token: "at".into(),
            refresh_token: None,
            expires_in: 3600
        })
    );
    assert!(matches!(
        parse_token_response(true, &json!({})),
        TokenOutcome::Failed(_)
    ));
}

#[test]
fn token_errors_map_to_poll_states() {
    let error = |code: &str| parse_token_response(false, &json!({ "error": code }));
    assert_eq!(error("authorization_pending"), TokenOutcome::Pending);
    assert_eq!(error("slow_down"), TokenOutcome::SlowDown);
    assert_eq!(error("expired_token"), TokenOutcome::Expired);
    assert_eq!(error("authorization_declined"), TokenOutcome::Denied);
    assert_eq!(error("access_denied"), TokenOutcome::Denied);
    assert_eq!(error("invalid_grant"), TokenOutcome::InvalidGrant);
    assert!(matches!(
        parse_token_response(false, &Value::Null),
        TokenOutcome::Failed(_)
    ));
}

#[test]
fn other_errors_are_sanitized_and_hinted() {
    let long_run = "x".repeat(80);
    let body = json!({
        "error": "invalid_client",
        "error_description": format!(
            "AADSTS7000218: The request body must contain client_assertion {long_run}. Trace ID: abc Correlation ID: def\r\nTimestamp: 2026"
        ),
    });
    let TokenOutcome::Failed(message) = parse_token_response(false, &body) else {
        panic!("expected failure");
    };
    assert!(message.starts_with("Microsoft sign-in failed: AADSTS7000218"));
    assert!(message.contains("Allow public client flows"));
    assert!(!message.contains(&long_run));
    assert!(!message.contains("Trace ID"));
    assert!(!message.contains("Timestamp"));
    let TokenOutcome::Failed(message) =
        parse_token_response(false, &json!({ "error": "invalid_scope" }))
    else {
        panic!("expected failure");
    };
    assert_eq!(message, "Microsoft sign-in failed: invalid_scope");
}

#[test]
fn sanitize_truncates_long_descriptions() {
    let text = "word ".repeat(200);
    let cleaned = sanitize_description(&text);
    assert_eq!(cleaned.chars().count(), 301);
    assert!(cleaned.ends_with('…'));
}

#[test]
fn refresh_decision_uses_one_minute_margin() {
    let now = 1_000_000;
    assert!(needs_refresh(0, now));
    assert!(needs_refresh(now + 60_000, now));
    assert!(!needs_refresh(now + 60_001, now));
    assert!(needs_refresh(u64::MAX, u64::MAX));
}

#[test]
fn apply_refresh_keeps_unrotated_refresh_token() {
    let mut record =
        json!({ "accessToken": "old", "refreshToken": "r1", "expiresAt": 1, "clientId": GUID })
            .as_object()
            .unwrap()
            .clone();
    let tokens = TokenSet {
        access_token: "new".into(),
        refresh_token: None,
        expires_in: 100,
    };
    apply_refresh(&mut record, &tokens, 5_000);
    assert_eq!(record["accessToken"], "new");
    assert_eq!(record["refreshToken"], "r1");
    assert_eq!(record["expiresAt"], 105_000);
    assert_eq!(record["clientId"], GUID);
    let tokens = TokenSet {
        access_token: "n2".into(),
        refresh_token: Some("r2".into()),
        expires_in: 60,
    };
    apply_refresh(&mut record, &tokens, 0);
    assert_eq!(record["refreshToken"], "r2");
}

#[test]
fn fresh_token_is_returned_without_network() {
    let mut secret = Secret::new();
    secret.insert(
        "microsoft".into(),
        json!({ "accessToken": "at", "refreshToken": "rt", "expiresAt": now_ms() + 600_000, "clientId": GUID }),
    );
    let before = secret.clone();
    assert_eq!(access_token(&mut secret), Ok("at".into()));
    assert_eq!(secret, before);
}

#[test]
fn missing_record_or_refresh_token_asks_to_reconnect() {
    let mut secret = Secret::new();
    assert!(access_token(&mut secret).unwrap_err().contains("Reconnect"));
    secret.insert(
        "microsoft".into(),
        json!({ "accessToken": "at", "refreshToken": "", "expiresAt": 0, "clientId": GUID }),
    );
    assert_eq!(access_token(&mut secret), Err(RECONNECT.into()));
}

#[test]
fn token_record_has_expected_shape() {
    let tokens = TokenSet {
        access_token: "a".into(),
        refresh_token: Some("r".into()),
        expires_in: 10,
    };
    let record = token_record(&tokens, GUID, "common", TEAMS_SCOPE, "teams", 1_000);
    assert_eq!(
        record,
        json!({
            "accessToken": "a", "refreshToken": "r", "expiresAt": 11_000, "clientId": GUID,
            "tenant": "common", "scope": TEAMS_SCOPE, "purpose": "teams"
        })
    );
}

#[test]
fn form_body_percent_encodes_values() {
    assert_eq!(
        form_body(&[("scope", "a/b c"), ("x", "&=")]),
        "scope=a%2Fb+c&x=%26%3D"
    );
}

fn pending(expires: Instant, tokens: Option<Value>) -> Pending {
    Pending {
        device_code: "dc".into(),
        client_id: GUID.into(),
        tenant: "common".into(),
        scope: TEAMS_SCOPE.into(),
        purpose: "teams".into(),
        expires,
        interval: 5,
        next_poll: Instant::now() + Duration::from_secs(60),
        tokens,
    }
}

#[test]
fn prune_drops_expired_and_caps_size() {
    let now = Instant::now();
    let mut map = HashMap::new();
    map.insert(
        "old".to_string(),
        pending(now - Duration::from_secs(1), None),
    );
    for index in 0..MAX_PENDING {
        map.insert(
            format!("h{index}"),
            pending(now + Duration::from_secs(10 + index as u64), None),
        );
    }
    prune(&mut map, now);
    assert_eq!(map.len(), MAX_PENDING - 1);
    assert!(!map.contains_key("old"));
    assert!(!map.contains_key("h0"));
}

#[test]
fn device_handles_report_state_and_hand_over_tokens_once() {
    let soon = Instant::now() + Duration::from_secs(60);
    {
        let mut map = PENDING.lock().unwrap();
        map.insert("test-waiting".into(), pending(soon, None));
        map.insert(
            "test-done".into(),
            pending(soon, Some(json!({ "accessToken": "a" }))),
        );
    }
    // Early poll answers locally without a network call.
    assert_eq!(device_poll("test-waiting").unwrap().status, "pending");
    assert_eq!(device_poll("test-done").unwrap().status, "done");
    assert_eq!(device_poll("test-unknown").unwrap().status, "expired");
    assert!(device_tokens("test-waiting")
        .unwrap_err()
        .contains("Finish"));
    // Reading does not consume, so a failed account save can retry with the same sign-in.
    assert_eq!(
        device_tokens("test-done"),
        Ok(json!({ "accessToken": "a" }))
    );
    assert_eq!(
        device_tokens("test-done"),
        Ok(json!({ "accessToken": "a" }))
    );
    forget_device_flow("test-done");
    assert_eq!(device_tokens("test-done"), Err(EXPIRED_REQUEST.into()));
    PENDING.lock().unwrap().remove("test-waiting");
}

#[test]
fn device_start_rejects_bad_input_before_network() {
    assert!(device_start(Some("nope"), None, "teams")
        .unwrap_err()
        .contains("GUID"));
    assert!(device_start(Some(GUID), Some("bad tenant"), "teams").is_err());
    assert!(device_start(Some(GUID), None, "chat")
        .unwrap_err()
        .contains("purpose"));
}
