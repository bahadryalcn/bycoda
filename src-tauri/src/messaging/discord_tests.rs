use super::*;
use serde_json::json;

const CHANNEL: &str = "112233445566778899";
const OTHER: &str = "998877665544332211";
const BOT: &str = "100000000000000001";

/// Offline Discord: each canned response answers the first request whose path contains its pattern.
#[derive(Default)]
struct Fake {
    responses: Vec<(String, Response)>,
    calls: Vec<(String, Option<String>)>,
    waits: Vec<Duration>,
}

impl Fake {
    fn ok(self, pattern: &str, body: Value) -> Self {
        self.status(pattern, 200, body)
    }

    fn status(mut self, pattern: &str, status: u16, body: Value) -> Self {
        self.responses.push((
            pattern.into(),
            Response {
                status,
                retry_after: None,
                body: body.to_string(),
            },
        ));
        self
    }

    fn limited(self, pattern: &str, seconds: f64) -> Self {
        self.status(
            pattern,
            429,
            json!({ "message": "You are being rate limited.", "retry_after": seconds, "global": false }),
        )
    }
}

impl Http for Fake {
    fn send(&mut self, path: &str, json_body: Option<&str>) -> Result<Response, String> {
        self.calls
            .push((path.to_string(), json_body.map(str::to_string)));
        let index = self
            .responses
            .iter()
            .position(|(pattern, _)| path.contains(pattern.as_str()))
            .ok_or_else(|| format!("unexpected request {path}"))?;
        Ok(self.responses.remove(index).1)
    }

    fn wait(&mut self, delay: Duration) {
        self.waits.push(delay);
    }
}

fn me() -> Value {
    json!({ "id": BOT, "username": "bycoda-bot", "bot": true })
}

#[test]
fn config_normalizes_channel_ids() {
    let config = normalize_config(&json!({
        "channelIds": [" 112233445566778899 ", "", "112233445566778899", "12345678901234567"]
    }))
    .unwrap();
    assert_eq!(
        config,
        json!({ "channelIds": ["112233445566778899", "12345678901234567"] })
    );
    let from_text =
        normalize_config(&json!({ "channelIds": "112233445566778899, 998877665544332211" }))
            .unwrap();
    assert_eq!(from_text["channelIds"].as_array().unwrap().len(), 2);
    assert_eq!(
        normalize_config(&json!(null)).unwrap(),
        json!({ "channelIds": [] })
    );
    assert_eq!(
        normalize_config(&json!({})).unwrap(),
        json!({ "channelIds": [] })
    );
    for bad in [
        json!({ "channelIds": ["1234"] }),
        json!({ "channelIds": ["99999999999999999999"] }),
        json!({ "channelIds": ["11223344556677889a"] }),
        json!({ "channelIds": [112233445566778899u64] }),
        json!({ "channelIds": 5 }),
        json!("x"),
    ] {
        assert!(normalize_config(&bad).is_err(), "{bad}");
    }
    let many: Vec<String> = (0..51)
        .map(|index| format!("1122334455667{index:05}"))
        .collect();
    assert!(normalize_config(&json!({ "channelIds": many }))
        .unwrap_err()
        .contains("50"));
}

#[test]
fn token_accepts_bot_prefix_and_rejects_header_injection() {
    let mut secret = Secret::new();
    assert!(bot_token(&secret).is_err());
    secret.insert(
        "botToken".into(),
        json!(" Bot MTAx.abc_DEF-123.xyzxyzxyzxyz "),
    );
    assert_eq!(bot_token(&secret).unwrap(), "MTAx.abc_DEF-123.xyzxyzxyzxyz");
    secret.insert(
        "botToken".into(),
        json!("MTAx.abc_DEF-123.xyz\r\nX-Evil: 1"),
    );
    let error = bot_token(&secret).unwrap_err();
    assert!(!error.contains("MTAx"));
}

#[test]
fn snowflake_and_iso_times() {
    assert_eq!(snowflake_ms("175928847299117063"), Some(1_462_015_105_796));
    assert_eq!(
        iso_ms("2024-01-02T03:04:05.678000+00:00"),
        Some(1_704_164_645_678)
    );
    assert_eq!(iso_ms("not a date"), None);
}

#[test]
fn content_mentions_become_names() {
    let names = HashMap::from([(BOT.to_string(), "bycoda".to_string())]);
    let text = format!(
        "hi <@{BOT}> <@!{BOT}> <@{OTHER}> <@&{OTHER}> in <#{CHANNEL}> <:wave:{OTHER}> <a:dance:{OTHER}> a<b> <@x>"
    );
    assert_eq!(
        content_to_plain(&text, &names),
        "hi @bycoda @bycoda @unknown-user @role in #channel :wave: :dance: a<b> <@x>"
    );
}

#[test]
fn message_body_falls_back_to_embeds_and_intent_hint() {
    let with_mention = json!({ "content": format!("ping <@{BOT}>"), "mentions": [{ "id": BOT, "username": "b", "global_name": "Bycoda" }] });
    assert_eq!(message_body(&with_mention), "ping @Bycoda");
    let embed = json!({ "content": "", "embeds": [{ "title": "Deploy", "description": "done" }] });
    assert_eq!(message_body(&embed), "Deploy\ndone");
    assert!(message_body(&json!({ "content": "", "type": 0 })).contains("Message Content intent"));
    assert_eq!(
        message_body(&json!({ "content": "", "attachments": [{ "filename": "a" }] })),
        ""
    );
    assert_eq!(message_body(&json!({ "content": "", "type": 7 })), "");
}

#[test]
fn errors_are_readable() {
    assert!(error_text(ApiError::Status(401, None), None, false).contains("rejected the bot token"));
    assert!(
        error_text(ApiError::Status(403, None), Some(CHANNEL), false)
            .contains("Read Message History")
    );
    assert!(error_text(ApiError::Status(403, None), Some(CHANNEL), true).contains("Send Messages"));
    assert!(error_text(ApiError::Status(404, None), Some(CHANNEL), false).contains(CHANNEL));
    assert!(error_text(ApiError::Status(502, None), None, false).contains("unavailable"));
    assert_eq!(
        error_text(
            ApiError::Status(400, Some("Invalid Form Body".into())),
            None,
            true
        ),
        "Discord request failed (400): Invalid Form Body"
    );
    assert!(error_text(ApiError::RateLimited(12.2), None, false).contains("13 seconds"));
}

#[test]
fn verify_checks_bot_and_each_channel() {
    let mut fake = Fake::default()
        .ok("/users/@me", me())
        .ok(
            &format!("/channels/{CHANNEL}"),
            json!({ "id": CHANNEL, "name": "general" }),
        )
        .status(
            &format!("/channels/{OTHER}"),
            403,
            json!({ "message": "Missing Access", "code": 50001 }),
        );
    let error = verify_with(&mut fake, &[CHANNEL.into(), OTHER.into()]).unwrap_err();
    assert!(error.contains(OTHER) && error.contains("View Channel"));

    let mut good = Fake::default().ok("/users/@me", me());
    assert_eq!(verify_with(&mut good, &[]).unwrap(), "bycoda-bot");

    let mut bad_token =
        Fake::default().status("/users/@me", 401, json!({ "message": "401: Unauthorized" }));
    assert!(verify_with(&mut bad_token, &[])
        .unwrap_err()
        .contains("rejected"));
}

#[test]
fn rate_limit_retries_once_when_short() {
    let mut fake = Fake::default()
        .limited("/users/@me", 0.5)
        .ok("/users/@me", me());
    assert_eq!(verify_with(&mut fake, &[]).unwrap(), "bycoda-bot");
    assert_eq!(fake.waits, vec![Duration::from_millis(500)]);

    let mut long = Fake::default().limited("/users/@me", 20.0);
    assert!(verify_with(&mut long, &[])
        .unwrap_err()
        .contains("20 seconds"));
    assert!(long.waits.is_empty());
}

#[test]
fn list_threads_maps_channels_and_sorts_newest_first() {
    let mut fake = Fake::default()
        .ok(
            &format!("/channels/{CHANNEL}/messages?limit=1"),
            json!([{ "id": OTHER, "content": "old", "timestamp": "2024-01-01T00:00:00+00:00" }]),
        )
        .ok(
            &format!("/channels/{CHANNEL}"),
            json!({ "id": CHANNEL, "name": "general", "guild_id": "123456789012345678" }),
        )
        .ok(
            &format!("/channels/{OTHER}/messages?limit=1"),
            json!([{ "id": OTHER, "content": "new", "timestamp": "2025-01-01T00:00:00+00:00" }]),
        )
        .ok(
            &format!("/channels/{OTHER}"),
            json!({ "id": OTHER, "name": "ops" }),
        );
    let threads = list_threads_with(&mut fake, "acct", &[CHANNEL.into(), OTHER.into()]).unwrap();
    assert_eq!(threads.len(), 2);
    assert_eq!(
        (threads[0].title.as_str(), threads[0].preview.as_str()),
        ("#ops", "new")
    );
    assert_eq!(threads[1].title, "#general");
    assert_eq!(
        threads[1].url.as_deref(),
        Some("https://discord.com/channels/123456789012345678/112233445566778899")
    );
    assert_eq!(
        threads[0].url.as_deref(),
        Some("https://discord.com/channels/@me/998877665544332211")
    );
    assert_eq!(threads[1].updated_at, 1_704_067_200_000);
    assert!(threads
        .iter()
        .all(|thread| thread.provider == Provider::Discord));
}

#[test]
fn list_threads_skips_failing_channels_and_stops_on_long_rate_limit() {
    let mut fake = Fake::default()
        .status(
            &format!("/channels/{CHANNEL}"),
            404,
            json!({ "message": "Unknown Channel" }),
        )
        .ok(&format!("/channels/{OTHER}/messages"), json!([]))
        .ok(
            &format!("/channels/{OTHER}"),
            json!({ "id": OTHER, "name": "ops", "last_message_id": OTHER }),
        );
    let threads = list_threads_with(&mut fake, "acct", &[CHANNEL.into(), OTHER.into()]).unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].updated_at, snowflake_ms(OTHER).unwrap());

    let mut only_failures = Fake::default().status(&format!("/channels/{CHANNEL}"), 403, json!({}));
    let error = list_threads_with(&mut only_failures, "acct", &[CHANNEL.into()]).unwrap_err();
    assert!(error.contains(CHANNEL));

    let mut limited = Fake::default()
        .ok(&format!("/channels/{CHANNEL}/messages"), json!([]))
        .ok(
            &format!("/channels/{CHANNEL}"),
            json!({ "id": CHANNEL, "name": "general" }),
        )
        .limited(&format!("/channels/{OTHER}"), 30.0);
    let threads = list_threads_with(&mut limited, "acct", &[CHANNEL.into(), OTHER.into()]).unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(limited.calls.len(), 3);
}

#[test]
fn thread_messages_are_oldest_first_and_mark_outbound() {
    let mut fake = Fake::default().ok("/users/@me", me()).ok(
        "/messages?limit=50",
        json!([
            { "id": "300000000000000003", "content": "mine", "timestamp": "2024-01-01T00:00:03+00:00",
              "author": { "id": BOT, "username": "bycoda-bot" } },
            { "id": "200000000000000002", "content": "", "timestamp": "2024-01-01T00:00:02+00:00",
              "author": { "id": OTHER, "username": "ana", "global_name": "Ana" },
              "attachments": [{ "filename": "log.txt", "size": 42 }] },
            { "id": "100000000000000001", "content": "hello", "timestamp": "2024-01-01T00:00:01+00:00",
              "author": { "id": OTHER, "username": "ana" } }
        ]),
    );
    let messages = thread_messages_with(&mut fake, CHANNEL).unwrap();
    let bodies: Vec<&str> = messages
        .iter()
        .map(|message| message.body.as_str())
        .collect();
    assert_eq!(bodies, vec!["hello", "", "mine"]);
    assert_eq!(messages[1].author, "Ana");
    assert_eq!(
        messages[1].attachments,
        vec![Attachment {
            name: "log.txt".into(),
            size: Some(42)
        }]
    );
    assert!(!messages[0].outbound && messages[2].outbound);
    assert_eq!(messages[0].at, 1_704_067_201_000);
    assert_eq!(
        fake.calls[1].0,
        format!("/channels/{CHANNEL}/messages?limit=50")
    );
}

#[test]
fn reply_posts_without_pings_and_enforces_length() {
    let mut fake = Fake::default().ok(
        &format!("/channels/{CHANNEL}/messages"),
        json!({ "id": "300000000000000003", "content": "hi @everyone", "timestamp": "2024-01-01T00:00:03+00:00",
                "author": { "id": BOT, "username": "bycoda-bot" } }),
    );
    let message = reply_with(&mut fake, CHANNEL, "hi @everyone").unwrap();
    assert!(message.outbound);
    assert_eq!(message.author, "bycoda-bot");
    let sent: Value = serde_json::from_str(fake.calls[0].1.as_deref().unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({ "content": "hi @everyone", "allowed_mentions": { "parse": [] } })
    );

    let mut unused = Fake::default();
    let long = "é".repeat(MAX_CONTENT_CHARS + 1);
    assert!(reply_with(&mut unused, CHANNEL, &long)
        .unwrap_err()
        .contains("2000"));
    assert!(unused.calls.is_empty());
    assert!(reply_with(&mut unused, CHANNEL, &"é".repeat(MAX_CONTENT_CHARS)).is_err());
    assert_eq!(unused.calls.len(), 1);

    let mut denied =
        Fake::default().status(&format!("/channels/{CHANNEL}/messages"), 403, json!({}));
    assert!(reply_with(&mut denied, CHANNEL, "x")
        .unwrap_err()
        .contains("Send Messages"));
}

#[test]
fn thread_ids_must_be_configured_snowflakes() {
    let config = json!({ "channelIds": [CHANNEL] });
    assert!(configured_channel(&config, CHANNEL).is_ok());
    assert!(configured_channel(&config, OTHER).is_err());
    assert!(configured_channel(&config, "../users/@me").is_err());
    assert!(configured_channel(&config, "112233445566778899?x").is_err());
}
