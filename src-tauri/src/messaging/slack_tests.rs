use super::*;
use serde_json::json;

/// Offline Slack: each canned response answers the first request whose URL contains its pattern.
#[derive(Default)]
struct Fake {
    responses: Vec<(String, Response)>,
    calls: Vec<(String, Option<String>)>,
    waits: Vec<Duration>,
}

impl Fake {
    fn ok(mut self, pattern: &str, body: Value) -> Self {
        self.responses.push((pattern.into(), response(200, body)));
        self
    }

    fn raw(mut self, pattern: &str, response: Response) -> Self {
        self.responses.push((pattern.into(), response));
        self
    }

    fn count(&self, pattern: &str) -> usize {
        self.calls
            .iter()
            .filter(|(url, _)| url.contains(pattern))
            .count()
    }
}

fn response(status: u16, body: Value) -> Response {
    Response {
        status,
        retry_after: None,
        scopes: None,
        body: body.to_string(),
    }
}

fn rate_limited(seconds: f64) -> Response {
    Response {
        status: 429,
        retry_after: Some(seconds),
        scopes: None,
        body: String::new(),
    }
}

impl Http for Fake {
    fn send(&mut self, url: &str, json_body: Option<&str>) -> Result<Response, String> {
        self.calls
            .push((url.to_string(), json_body.map(str::to_string)));
        let index = self
            .responses
            .iter()
            .position(|(pattern, _)| url.contains(pattern.as_str()))
            .ok_or_else(|| format!("unexpected request {url}"))?;
        Ok(self.responses.remove(index).1)
    }

    fn wait(&mut self, delay: Duration) {
        self.waits.push(delay);
    }
}

fn no_names(_: &str) -> Option<String> {
    None
}

#[test]
fn config_is_always_empty_object() {
    assert_eq!(normalize_config(&json!(null)).unwrap(), json!({}));
    assert_eq!(normalize_config(&json!({ "x": 1 })).unwrap(), json!({}));
    assert!(normalize_config(&json!("x")).is_err());
    assert!(normalize_config(&json!([1])).is_err());
}

#[test]
fn token_requires_bot_prefix_and_never_echoes_input() {
    let mut secret = Secret::new();
    assert!(bot_token(&secret).is_err());
    secret.insert("botToken".into(), json!("xoxp-user-token-1234"));
    let error = bot_token(&secret).unwrap_err();
    assert!(!error.contains("xoxp-user"));
    secret.insert("botToken".into(), json!("xoxb-1-2\r\nX: y"));
    assert!(bot_token(&secret).is_err());
    secret.insert("botToken".into(), json!("  xoxb-123-456-abc  "));
    assert_eq!(bot_token(&secret).unwrap(), "xoxb-123-456-abc");
}

#[test]
fn conversation_ids_are_validated() {
    assert!(valid_conversation_id("C0123456789").is_ok());
    assert!(valid_conversation_id("D0123ABCDE").is_ok());
    assert!(valid_conversation_id("G01234567").is_ok());
    for bad in [
        "",
        "c0123456789",
        "C01&x=1abc",
        "U0123456789",
        "C0123/../x",
        "C01",
    ] {
        assert!(valid_conversation_id(bad).is_err(), "{bad}");
    }
}

#[test]
fn ts_converts_to_milliseconds() {
    assert_eq!(ts_to_ms("1700000000.123456"), Some(1_700_000_000_123));
    assert_eq!(ts_to_ms("1700000000.5"), Some(1_700_000_000_500));
    assert_eq!(ts_to_ms("1700000000"), Some(1_700_000_000_000));
    assert_eq!(ts_to_ms("abc"), None);
    assert_eq!(ts_to_ms("1.2x"), None);
}

#[test]
fn mrkdwn_becomes_plain_text() {
    let names = |id: &str| (id == "U111").then(|| "ana".to_string());
    let text =
        "Hi <@U111> and <@U222>, see <https://x.dev/a?b=1&amp;c=2|the doc> or <https://y.dev> \
                in <#C333|general> <!here> <!subteam^S1|@devs> <mailto:a@b.co|a@b.co> \
                <!date^1700000000^{date}|Nov 14> 1 &lt; 2 &amp;&amp; 3 &gt; 2 &amp;lt;";
    assert_eq!(
        mrkdwn_to_plain(text, &names),
        "Hi @ana and @U222, see the doc or https://y.dev in #general @here @devs a@b.co \
         Nov 14 1 < 2 && 3 > 2 &lt;"
    );
    assert_eq!(mrkdwn_to_plain("<@U111|bora>", &no_names), "@bora");
    assert_eq!(mrkdwn_to_plain("open < end", &no_names), "open < end");
    assert_eq!(
        mentioned_users("<@U1A2B3> <@U1A2B3|x> <@bad id>"),
        vec!["U1A2B3"]
    );
}

#[test]
fn errors_are_readable_and_name_scopes() {
    let missing = error_text("missing_scope", Some("channels:history"));
    assert!(missing.contains("channels:history"));
    assert!(missing.contains("chat:write"));
    assert!(error_text("invalid_auth", None).contains("rejected the bot token"));
    assert!(error_text("not_in_channel", None).contains("/invite"));
    assert_eq!(
        error_text("weird<script>", None),
        "Slack request failed: weirdscript."
    );

    let limited = Response {
        retry_after: Some(2.2),
        ..response(200, json!({ "ok": false, "error": "ratelimited" }))
    };
    assert_eq!(parse_response(&limited), Err(ApiError::RateLimited(3)));
    assert_eq!(
        parse_response(&rate_limited(0.0)),
        Err(ApiError::RateLimited(1))
    );
    let html = Response {
        status: 503,
        retry_after: None,
        scopes: None,
        body: "<html>".into(),
    };
    assert!(matches!(parse_response(&html), Err(ApiError::Failed(text)) if text.contains("503")));
}

#[test]
fn verify_reports_identity_and_missing_scopes() {
    let mut fake = Fake::default().ok(
        "auth.test",
        json!({ "ok": true, "team": "Acme", "user": "bycoda", "user_id": "U9", "bot_id": "B9" }),
    );
    assert_eq!(verify_with(&mut fake).unwrap(), "Acme (bycoda)");

    let mut partial = Fake::default().raw(
        "auth.test",
        Response {
            scopes: Some("channels:read,chat:write".into()),
            ..response(200, json!({ "ok": true, "team": "Acme", "user": "bycoda" }))
        },
    );
    let error = verify_with(&mut partial).unwrap_err();
    assert!(error.contains("channels:history") && error.contains("users:read"));
    assert!(!error.contains("chat:write,"));
    assert!(missing_scopes(&REQUIRED_SCOPES.join(",")).is_empty());

    let mut revoked = Fake::default().ok(
        "auth.test",
        json!({ "ok": false, "error": "token_revoked" }),
    );
    assert!(verify_with(&mut revoked).unwrap_err().contains("rejected"));
}

#[test]
fn rate_limit_waits_once_when_short_and_fails_when_long() {
    let mut fake = Fake::default()
        .raw("auth.test", rate_limited(2.0))
        .ok("auth.test", json!({ "ok": true, "team": "T", "user": "u" }));
    assert_eq!(verify_with(&mut fake).unwrap(), "T (u)");
    assert_eq!(fake.waits, vec![Duration::from_secs(2)]);

    let mut long = Fake::default().raw("auth.test", rate_limited(30.0));
    assert!(verify_with(&mut long).unwrap_err().contains("30 seconds"));
    assert!(long.waits.is_empty());

    let mut twice = Fake::default()
        .raw("auth.test", rate_limited(1.0))
        .raw("auth.test", rate_limited(1.0));
    assert!(verify_with(&mut twice)
        .unwrap_err()
        .contains("rate limiting"));
    assert_eq!(twice.calls.len(), 2);
}

fn conversations_page() -> Value {
    json!({
        "ok": true,
        "channels": [
            { "id": "C0000000001", "name": "general", "is_channel": true, "updated": 1_000 },
            { "id": "D0000000002", "is_im": true, "user": "U111", "updated": 3_000 },
            { "id": "G0000000003", "name": "mpdm-ana--bora--cem-1", "is_mpim": true, "updated": 2_000 },
            { "id": "bad id", "name": "skip" }
        ],
        "response_metadata": { "next_cursor": "" }
    })
}

#[test]
fn list_threads_titles_previews_and_sorts() {
    let mut fake = Fake::default()
        .ok("users.conversations", conversations_page())
        .ok(
            "channel=D0000000002",
            json!({ "ok": true, "messages": [{ "ts": "1700000000.000100", "user": "U111", "text": "hey <@U111>" }] }),
        )
        .ok("users.info", json!({ "ok": true, "user": { "name": "ana.k", "profile": { "display_name": "Ana" } } }))
        .ok(
            "channel=G0000000003",
            json!({ "ok": true, "messages": [{ "ts": "1700000500.000000", "text": "group" }] }),
        )
        .ok(
            "channel=C0000000001",
            json!({ "ok": true, "messages": [{ "ts": "1600000000.000000", "text": "a &amp; b" }] }),
        );
    let threads = list_threads_with(&mut fake, "acct", 10).unwrap();
    let titles: Vec<&str> = threads.iter().map(|thread| thread.title.as_str()).collect();
    assert_eq!(titles, vec!["ana, bora, cem", "Ana", "#general"]);
    assert_eq!(threads[1].preview, "hey @Ana");
    assert_eq!(threads[1].updated_at, 1_700_000_000_000);
    assert_eq!(threads[2].preview, "a & b");
    assert!(threads
        .iter()
        .all(|thread| thread.provider == Provider::Slack && thread.url.is_none()));
    assert!(fake.calls[0]
        .0
        .contains("types=public_channel%2Cprivate_channel%2Cim%2Cmpim"));
    assert!(fake.calls[0].0.contains("exclude_archived=true"));
}

#[test]
fn list_threads_stops_history_when_rate_limited() {
    let mut fake = Fake::default()
        .ok("users.conversations", conversations_page())
        .ok("channel=D0000000002", json!({ "ok": true, "messages": [] }))
        .ok(
            "users.info",
            json!({ "ok": true, "user": { "name": "ana" } }),
        )
        .raw("channel=G0000000003", rate_limited(1.0));
    let threads = list_threads_with(&mut fake, "acct", 10).unwrap();
    assert_eq!(threads.len(), 3);
    assert_eq!(fake.count("conversations.history"), 2);
    assert!(fake.waits.is_empty());
    // Without a latest message, the conversation's own activity time is used.
    assert_eq!(
        threads
            .iter()
            .find(|t| t.id == "C0000000001")
            .unwrap()
            .updated_at,
        1_000
    );
}

#[test]
fn list_threads_respects_limit_and_cursor_cap() {
    let mut fake = Fake::default();
    for page in 0..MAX_PAGES + 2 {
        fake = fake.ok(
            "users.conversations",
            json!({
                "ok": true,
                "channels": [{ "id": format!("C00000000{page:02}"), "name": format!("c{page}"), "updated": page }],
                "response_metadata": { "next_cursor": format!("cursor{page}") }
            }),
        );
    }
    for _ in 0..2 {
        fake = fake.ok(
            "conversations.history",
            json!({ "ok": true, "messages": [] }),
        );
    }
    let threads = list_threads_with(&mut fake, "acct", 2).unwrap();
    assert_eq!(fake.count("users.conversations"), MAX_PAGES);
    assert!(fake.calls[1].0.contains("cursor=cursor0"));
    assert_eq!(threads.len(), 2);
    assert_eq!(threads[0].title, "#c4");
}

#[test]
fn list_threads_surfaces_history_scope_error() {
    let mut fake = Fake::default()
        .ok(
            "users.conversations",
            json!({ "ok": true, "channels": [{ "id": "C0000000001", "name": "general" }] }),
        )
        .ok(
            "conversations.history",
            json!({ "ok": false, "error": "missing_scope", "needed": "channels:history" }),
        );
    let error = list_threads_with(&mut fake, "acct", 10).unwrap_err();
    assert!(error.contains("channels:history"));
}

#[test]
fn thread_messages_are_oldest_first_with_authors_files_and_outbound() {
    let mut fake = Fake::default()
        .ok("auth.test", json!({ "ok": true, "user_id": "UBOT", "bot_id": "B1" }))
        .ok(
            "conversations.history",
            json!({ "ok": true, "messages": [
                { "ts": "1700000300.000000", "user": "UBOT", "bot_id": "B1", "text": "sent" },
                { "ts": "1700000200.000000", "bot_id": "B2", "username": "CI", "text": "", "attachments": [{ "fallback": "Build passed" }] },
                { "ts": "1700000100.000000", "user": "U111", "text": "hi <@U222>", "reply_count": 2,
                  "files": [{ "name": "a.png", "size": 10 }, { "mode": "hidden_by_limit" }] },
                { "text": "no ts" }
            ]}),
        )
        .ok("user=UBOT", json!({ "ok": true, "user": { "name": "bycoda" } }))
        .ok("user=U111", json!({ "ok": true, "user": { "real_name": "Ana K" } }))
        .ok("user=U222", json!({ "ok": false, "error": "user_not_found" }));
    let messages = thread_messages_with(&mut fake, "C0000000001").unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0].author, "Ana K");
    assert_eq!(messages[0].body, "hi @U222\n(2 replies in thread)");
    assert_eq!(
        messages[0].attachments,
        vec![
            Attachment {
                name: "a.png".into(),
                size: Some(10)
            },
            Attachment {
                name: "File".into(),
                size: None
            }
        ]
    );
    assert!(!messages[0].outbound);
    assert_eq!(
        (messages[1].author.as_str(), messages[1].body.as_str()),
        ("CI", "Build passed")
    );
    assert!(!messages[1].outbound);
    assert!(messages[2].outbound);
    assert_eq!(messages[2].author, "bycoda");
    assert_eq!(messages[2].thread_id, "C0000000001");
    assert!(fake.calls[1].0.contains("limit=50"));
}

#[test]
fn user_lookups_stop_after_rate_limit() {
    let mut fake = Fake::default()
        .ok("auth.test", json!({ "ok": true, "user_id": "UBOT" }))
        .ok(
            "conversations.history",
            json!({ "ok": true, "messages": [
                { "ts": "2.0", "user": "U0000002", "text": "b" },
                { "ts": "1.0", "user": "U0000001", "text": "a" }
            ]}),
        )
        .raw("users.info", rate_limited(1.0));
    let messages = thread_messages_with(&mut fake, "C0000000001").unwrap();
    assert_eq!(fake.count("users.info"), 1);
    assert_eq!(messages[0].author, "U0000001");
}

#[test]
fn reply_posts_json_and_returns_message() {
    let mut fake = Fake::default()
        .ok(
            "chat.postMessage",
            json!({ "ok": true, "channel": "C0000000001", "ts": "1700000000.000200",
                    "message": { "user": "UBOT", "bot_id": "B1", "text": "hello &amp; bye" } }),
        )
        .ok(
            "users.info",
            json!({ "ok": true, "user": { "name": "bycoda" } }),
        );
    let message = reply_with(&mut fake, "C0000000001", "hello & bye").unwrap();
    assert_eq!(message.id, "1700000000.000200");
    assert_eq!(message.body, "hello & bye");
    assert_eq!(message.author, "bycoda");
    assert!(message.outbound);
    let sent: Value = serde_json::from_str(fake.calls[0].1.as_deref().unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({ "channel": "C0000000001", "text": "hello & bye", "unfurl_links": false, "unfurl_media": false })
    );

    let mut denied = Fake::default().ok(
        "chat.postMessage",
        json!({ "ok": false, "error": "not_in_channel" }),
    );
    assert!(reply_with(&mut denied, "C0000000001", "x")
        .unwrap_err()
        .contains("/invite"));
}

#[test]
fn group_dm_titles() {
    assert_eq!(group_dm_title("mpdm-ana--bora-1"), "ana, bora");
    assert_eq!(group_dm_title("mpdm-a.b--c-d-12"), "a.b, c-d");
    assert_eq!(group_dm_title(""), "Group message");
}

#[test]
fn manifest_lists_every_required_scope() {
    for scope in REQUIRED_SCOPES {
        assert!(
            SLACK_APP_MANIFEST.contains(&format!("- {scope}\n")),
            "{scope}"
        );
    }
    assert!(SLACK_APP_MANIFEST.contains("display_name: bycoda"));
}

fn user_secret(access: &str) -> Secret {
    let mut secret = Secret::new();
    secret.insert("botToken".into(), json!("xoxb-old-bot"));
    secret.insert(
        "slack".into(),
        json!({ "accessToken": access, "refreshToken": "r1", "expiresAt": 0, "clientId": "1.2", "identity": "Acme" }),
    );
    secret
}

#[test]
fn resolver_prefers_signed_in_user_token_over_bot_token() {
    let mut secret = user_secret("xoxp-user-1");
    assert!(uses_user_token(&secret));
    assert_eq!(
        resolve_token(&mut secret).unwrap(),
        Token::User("xoxp-user-1".into())
    );

    let mut bot_only = Secret::new();
    bot_only.insert("botToken".into(), json!(" xoxb-1-2 "));
    assert!(!uses_user_token(&bot_only));
    assert_eq!(
        resolve_token(&mut bot_only).unwrap(),
        Token::Bot("xoxb-1-2".into())
    );

    let mut bad = user_secret("xoxp-bad\ninjected");
    assert!(resolve_token(&mut bad).unwrap_err().contains("Reconnect"));
}

#[test]
fn user_token_marks_own_messages_outbound() {
    let mut fake = Fake::default()
        .ok(
            "auth.test",
            json!({ "ok": true, "team": "Acme", "user": "ana", "user_id": "UANA" }),
        )
        .ok(
            "conversations.history",
            json!({ "ok": true, "messages": [
                { "ts": "2.0", "user": "UANA", "text": "mine" },
                { "ts": "1.0", "user": "UBOB", "text": "theirs" },
                { "ts": "3.0", "bot_id": "B1", "username": "CI", "text": "bot" }
            ]}),
        )
        .ok(
            "user=UANA",
            json!({ "ok": true, "user": { "name": "ana" } }),
        )
        .ok(
            "user=UBOB",
            json!({ "ok": true, "user": { "name": "bob" } }),
        );
    let messages = thread_messages_with(&mut fake, "C0000000001").unwrap();
    let outbound: Vec<(&str, bool)> = messages
        .iter()
        .map(|message| (message.body.as_str(), message.outbound))
        .collect();
    assert_eq!(
        outbound,
        vec![("theirs", false), ("mine", true), ("bot", false)]
    );

    let mut reply = Fake::default().ok(
        "chat.postMessage",
        json!({ "ok": true, "ts": "4.0", "message": { "user": "UANA", "text": "hi" } }),
    );
    reply = reply.ok(
        "users.info",
        json!({ "ok": true, "user": { "name": "ana" } }),
    );
    let sent = reply_with(&mut reply, "C0000000001", "hi").unwrap();
    assert!(sent.outbound);
    assert_eq!(sent.author, "ana");
}

#[test]
fn expired_user_token_refreshes_once_and_retries() {
    let mut secret = user_secret("xoxp-old");
    let mut tokens = Vec::new();
    let mut refreshes = 0;
    let result = run_with(
        &mut secret,
        resolve_token,
        |_| {
            refreshes += 1;
            Ok("xoxp-new".into())
        },
        |token| {
            tokens.push(token.to_string());
            let error = if token == "xoxp-old" {
                "token_expired"
            } else {
                ""
            };
            let mut fake = if error.is_empty() {
                Fake::default().ok(
                    "auth.test",
                    json!({ "ok": true, "team": "Acme", "user": "ana" }),
                )
            } else {
                Fake::default().ok("auth.test", json!({ "ok": false, "error": error }))
            };
            verify_with(&mut fake)
        },
    );
    assert_eq!(result.unwrap(), "Acme (ana)");
    assert_eq!(tokens, vec!["xoxp-old", "xoxp-new"]);
    assert_eq!(refreshes, 1);

    // Still rejected after the refresh: one retry only, worded for a person.
    let mut calls = 0;
    let error = run_with(
        &mut user_secret("xoxp-old"),
        resolve_token,
        |_| Ok("xoxp-new".into()),
        |_| {
            calls += 1;
            verify_with(
                &mut Fake::default()
                    .ok("auth.test", json!({ "ok": false, "error": "invalid_auth" })),
            )
        },
    )
    .unwrap_err();
    assert_eq!(calls, 2);
    assert_eq!(error, "Slack sign-in expired. Reconnect this account.");

    // A refresh that needs a new sign-in returns its message.
    let error = run_with::<String>(
        &mut user_secret("xoxp-old"),
        resolve_token,
        |_| Err("Slack sign-in expired. Reconnect this account.".into()),
        |_| Err(error_text("token_expired", None)),
    )
    .unwrap_err();
    assert!(error.contains("Reconnect"));
}

#[test]
fn bot_token_errors_keep_bot_wording_and_never_refresh() {
    let mut secret = Secret::new();
    secret.insert("botToken".into(), json!("xoxb-1"));
    let error = run_with::<String>(
        &mut secret,
        resolve_token,
        |_| panic!("bot tokens are not refreshed"),
        |_| Err(error_text("invalid_auth", None)),
    )
    .unwrap_err();
    assert!(error.contains("rejected the bot token"));
    assert_eq!(
        user_wording(error_text("not_in_channel", None)),
        "You are not a member of this Slack conversation."
    );
    assert!(!error_text("missing_scope", Some("chat:write")).contains("reinstall"));
}

#[test]
fn manifest_declares_user_scopes_and_pkce_redirect() {
    assert!(SLACK_APP_MANIFEST.contains("    user:\n"));
    assert!(SLACK_APP_MANIFEST.contains("    bot:\n"));
    assert!(SLACK_APP_MANIFEST.contains(&format!("- {}\n", oauth::SLACK_REDIRECT_URL)));
    assert!(SLACK_APP_MANIFEST.contains("pkce_enabled: true"));
    let user_scopes: Vec<&str> = oauth::SLACK_USER_SCOPE.split(',').collect();
    assert_eq!(user_scopes, REQUIRED_SCOPES);
}
