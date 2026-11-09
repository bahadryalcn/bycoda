use super::html::{decode_entities, html_to_text, single_line, text_to_html};
use super::*;
use serde_json::json;

const ME: &str = "me-id";

#[test]
fn config_defaults_tenant_and_validates_client_id() {
    assert_eq!(
        normalize_config(&Value::Null),
        Ok(json!({ "tenant": "common" }))
    );
    assert_eq!(
        normalize_config(
            &json!({ "clientId": " 1B2C3D4E-0000-4ABC-8DEF-0123456789AB ", "tenant": "Contoso.com" })
        ),
        Ok(json!({ "clientId": "1b2c3d4e-0000-4abc-8def-0123456789ab", "tenant": "contoso.com" }))
    );
    assert_eq!(
        normalize_config(&json!({ "clientId": "", "tenant": "" })),
        Ok(json!({ "tenant": "common" }))
    );
    assert!(normalize_config(&json!({ "clientId": "abc" })).is_err());
    assert!(normalize_config(&json!({ "tenant": "bad/tenant" })).is_err());
    assert!(normalize_config(&json!([1])).is_err());
}

#[test]
fn verify_requires_teams_sign_in() {
    let mut secret = Secret::new();
    assert!(verify(&Value::Null, &mut secret)
        .unwrap_err()
        .contains("Sign in"));
    secret.insert("microsoft".into(), json!({ "purpose": "outlook" }));
    assert!(verify(&Value::Null, &mut secret)
        .unwrap_err()
        .contains("Sign in"));
}

#[test]
fn identity_prefers_name_and_principal() {
    assert_eq!(
        identity(
            &json!({ "displayName": "Ada", "userPrincipalName": "ada@contoso.com", "mail": "x" })
        ),
        "Ada (ada@contoso.com)"
    );
    assert_eq!(
        identity(&json!({ "displayName": "", "mail": "a@b.c" })),
        "a@b.c"
    );
    assert_eq!(identity(&json!({ "displayName": "Ada" })), "Ada");
    assert_eq!(identity(&json!({})), "Microsoft account");
}

#[test]
fn user_id_is_cached_in_secret() {
    let mut secret = Secret::new();
    secret.insert("microsoft".into(), json!({ "accessToken": "a" }));
    store_user_id(&mut secret, "u1");
    assert_eq!(me_id(&mut secret), Ok("u1".into()));
    store_user_id(&mut secret, "");
    assert_eq!(secret["microsoft"]["userId"], "u1");
}

#[test]
fn chat_ids_are_validated_and_encoded() {
    assert!(valid_chat_id(
        "19:2da4c29f6d7041eca70b638b43d45437@thread.v2"
    ));
    assert!(valid_chat_id("19:a1-b2_c3@unq.gbl.spaces"));
    assert!(valid_chat_id("48:notes"));
    for bad in [
        "",
        "19:x/../me",
        "19:x?y",
        "19:x#y",
        "19 x",
        "19:x%2F",
        &"a".repeat(257),
    ] {
        assert!(!valid_chat_id(bad), "{bad}");
    }
    assert_eq!(encode_segment("19:abc@thread.v2"), "19%3Aabc%40thread.v2");
    assert_eq!(encode_segment("a-b_c.d~e"), "a-b_c.d~e");
    assert_eq!(encode_segment("a/b ü"), "a%2Fb%20%C3%BC");
    assert_eq!(chat_segment("19:x/y"), Err(INVALID_CHAT.into()));
}

#[test]
fn next_link_stays_on_graph() {
    let link = "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc";
    assert_eq!(
        next_link(&json!({ "@odata.nextLink": link })),
        Some(link.into())
    );
    assert_eq!(
        next_link(&json!({ "@odata.nextLink": "https://evil.example/v1.0" })),
        None
    );
    assert_eq!(
        next_link(&json!({ "@odata.nextLink": "https://graph.microsoft.com.evil.example/x" })),
        None
    );
    assert_eq!(
        next_link(&json!({ "@odata.nextLink": "https://graph.microsoft.com/x\r\nHost: y" })),
        None
    );
    assert_eq!(next_link(&json!({ "value": [] })), None);
}

#[test]
fn retry_after_is_honored_only_when_short() {
    assert_eq!(retry_delay(Some("2")), Some(Duration::from_secs(2)));
    assert_eq!(retry_delay(Some(" 5 ")), Some(Duration::from_secs(5)));
    assert_eq!(retry_delay(Some("0")), Some(Duration::from_secs(1)));
    assert_eq!(retry_delay(Some("6")), None);
    assert_eq!(retry_delay(Some("Wed, 21 Oct 2026 07:28:00 GMT")), None);
    assert_eq!(retry_delay(None), None);
    assert!(busy_message(Some("30")).contains("30 seconds"));
    assert!(busy_message(None).contains("moment"));
}

#[test]
fn status_errors_are_readable() {
    let body = json!({ "error": { "code": "Forbidden", "message": "Missing scope permissions on the request." } });
    let message = status_message(403, &body);
    assert!(message.starts_with("Microsoft Teams denied access: Missing scope"));
    assert!(message.contains("administrator"));
    assert_eq!(
        status_message(404, &Value::Null),
        "This Teams chat was not found."
    );
    assert_eq!(
        status_message(500, &Value::Null),
        "Microsoft Teams request failed (500)."
    );
}

#[test]
fn iso_dates_parse_to_milliseconds() {
    assert_eq!(iso_ms(Some(&json!("1970-01-01T00:00:01.5Z"))), Some(1500));
    assert_eq!(
        iso_ms(Some(&json!("2024-05-01T10:00:00.1234567Z"))),
        Some(1_714_557_600_123)
    );
    assert_eq!(
        iso_ms(Some(&json!("2024-05-01T12:00:00+02:00"))),
        Some(1_714_557_600_000)
    );
    assert_eq!(iso_ms(Some(&json!("0001-01-01T00:00:00Z"))), None);
    assert_eq!(iso_ms(Some(&json!("yesterday"))), None);
    assert_eq!(iso_ms(None), None);
}

#[test]
fn html_converts_to_plain_text() {
    assert_eq!(
        html_to_text("<p>Hello <b>there</b></p><p>Second&nbsp;line</p>"),
        "Hello there\nSecond line"
    );
    assert_eq!(html_to_text("a<br>b<br/>c<BR />d"), "a\nb\nc\nd");
    assert_eq!(html_to_text("<div>x\n   y</div>\n\n<div>z</div>"), "x y\nz");
    assert_eq!(
        html_to_text("<p>a</p><p>&nbsp;</p><p>&nbsp;</p><p>b</p>"),
        "a\n\nb"
    );
    assert_eq!(
        html_to_text("1 &lt; 2 &amp;&amp; 3 &gt; 2 &quot;q&quot; &#39;s&#x27; &#128512;"),
        "1 < 2 && 3 > 2 \"q\" 's' 😀"
    );
    assert_eq!(
        html_to_text("<ul><li>one</li><li>two</li></ul>"),
        "• one\n• two"
    );
    assert_eq!(
        html_to_text("hi <emoji id=\"smile\" alt=\"😄\" title=\"Smile\"></emoji>"),
        "hi 😄"
    );
    assert_eq!(
        html_to_text("<img src=\"x\"> <img alt='cat' src=\"y\">"),
        "[Image] cat"
    );
    assert_eq!(
        html_to_text("<at id=\"0\">Ada</at> look <attachment id=\"1\"></attachment>"),
        "Ada look"
    );
    assert_eq!(
        html_to_text("<style>p{color:red}</style>ok<script>alert(1)</script>!"),
        "ok!"
    );
    assert_eq!(html_to_text("broken <b"), "broken <b");
    assert_eq!(html_to_text("AT&T &unknown; &"), "AT&T &unknown; &");
}

#[test]
fn entity_decoding_rejects_invalid_code_points() {
    assert_eq!(decode_entities("&#0;&#xD800;&#x41;"), "&#0;&#xD800;A");
}

#[test]
fn reply_text_is_escaped_html() {
    assert_eq!(
        text_to_html("a < b & \"c\"\r\nnext 'line'\n<script>"),
        "a &lt; b &amp; &quot;c&quot;<br>next &#39;line&#39;<br>&lt;script&gt;"
    );
    assert_eq!(html_to_text(&text_to_html("x <y>\nz")), "x <y>\nz");
}

#[test]
fn previews_are_single_line_and_truncated() {
    assert_eq!(single_line(" a\n b\t c ", 10), "a b c");
    assert_eq!(single_line("abcdef ghij", 7), "abcdef…");
    assert_eq!(single_line("ççççç", 3), "ççç…");
}

fn chat(value: Value) -> Option<Thread> {
    chat_to_thread("acc", ME, &value)
}

#[test]
fn chat_maps_to_thread() {
    let thread = chat(json!({
        "id": "19:abc@thread.v2",
        "topic": "Release",
        "chatType": "group",
        "webUrl": "https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/0",
        "lastUpdatedDateTime": "2024-05-01T09:00:00Z",
        "members": [
            { "userId": ME, "displayName": "Me" },
            { "userId": "u2", "displayName": "Bob" },
            { "userId": "u3", "displayName": "Bob" },
            { "userId": "u4", "displayName": "Cy" }
        ],
        "lastMessagePreview": {
            "createdDateTime": "2024-05-01T10:00:00Z",
            "isDeleted": false,
            "body": { "contentType": "html", "content": "<p>Ship\nit</p><p>today</p>" },
            "from": { "user": { "id": "u2", "displayName": "Bob" } }
        }
    }))
    .unwrap();
    assert_eq!(thread.id, "19:abc@thread.v2");
    assert_eq!(thread.account_id, "acc");
    assert_eq!(thread.provider, Provider::Teams);
    assert_eq!(thread.title, "Release");
    assert_eq!(thread.participants, vec!["Bob", "Cy"]);
    assert_eq!(thread.preview, "Ship it today");
    assert_eq!(thread.updated_at, 1_714_557_600_000);
    assert!(!thread.unread);
    assert!(thread
        .url
        .unwrap()
        .starts_with("https://teams.microsoft.com/"));
}

#[test]
fn untitled_chats_use_members_then_sender_then_fallback() {
    let members: Vec<Value> = (1..=6)
        .map(|index| json!({ "userId": format!("u{index}"), "displayName": format!("P{index}") }))
        .collect();
    let thread =
        chat(json!({ "id": "19:g@thread.v2", "topic": null, "members": members })).unwrap();
    assert_eq!(thread.title, "P1, P2, P3, P4 +2");
    let thread = chat(json!({
        "id": "19:a_b@unq.gbl.spaces",
        "chatType": "oneOnOne",
        "lastMessagePreview": { "from": { "user": { "id": "u9", "displayName": "Dee" } } }
    }))
    .unwrap();
    assert_eq!(thread.title, "Dee");
    assert_eq!(thread.participants, vec!["Dee"]);
    let thread = chat(json!({
        "id": "19:a_b@unq.gbl.spaces",
        "chatType": "oneOnOne",
        "createdDateTime": "2024-01-01T00:00:00Z",
        "lastMessagePreview": {
            "isDeleted": true,
            "body": { "contentType": "text", "content": "secret" },
            "from": { "user": { "id": ME, "displayName": "Me" } }
        }
    }))
    .unwrap();
    assert_eq!(thread.title, "Chat");
    assert_eq!(thread.preview, "");
    assert_eq!(thread.updated_at, 1_704_067_200_000);
    assert_eq!(thread.url, None);
    assert_eq!(
        chat(json!({ "id": "19:m@thread.v2", "chatType": "meeting" }))
            .unwrap()
            .title,
        "Meeting chat"
    );
    assert!(chat(json!({ "id": "bad/id" })).is_none());
    assert!(chat(json!({})).is_none());
}

#[test]
fn graph_messages_map_and_skip_system_events() {
    let message = graph_message(
        "19:abc@thread.v2",
        ME,
        &json!({
            "id": "1714557600000",
            "messageType": "message",
            "createdDateTime": "2024-05-01T10:00:00Z",
            "deletedDateTime": null,
            "from": { "user": { "id": ME, "displayName": "Me" } },
            "body": { "contentType": "html", "content": "<p>Hi&nbsp;<at id=\"0\">Bob</at></p><p>Line 2</p>" },
            "attachments": [
                { "contentType": "reference", "name": "plan.docx" },
                { "contentType": "messageReference", "name": null },
                { "contentType": "application/vnd.microsoft.card.adaptive", "name": null }
            ]
        }),
    )
    .unwrap();
    assert_eq!(message.id, "1714557600000");
    assert_eq!(message.thread_id, "19:abc@thread.v2");
    assert_eq!(message.author, "Me");
    assert_eq!(message.body, "Hi Bob\nLine 2");
    assert_eq!(message.at, 1_714_557_600_000);
    assert!(message.outbound);
    let names: Vec<&str> = message
        .attachments
        .iter()
        .map(|item| item.name.as_str())
        .collect();
    assert_eq!(names, vec!["plan.docx", "Attachment"]);

    let bot = graph_message(
        "t",
        ME,
        &json!({
            "id": "2",
            "messageType": "message",
            "from": { "user": null, "application": { "displayName": "Planner" } },
            "body": { "contentType": "text", "content": "Task\r\ndone" }
        }),
    )
    .unwrap();
    assert_eq!(bot.author, "Planner");
    assert_eq!(bot.body, "Task\ndone");
    assert!(!bot.outbound);
    assert_eq!(bot.at, 0);

    let system = json!({ "id": "3", "messageType": "systemEventMessage", "body": { "content": "<systemEventMessage/>" } });
    assert!(graph_message("t", ME, &system).is_none());
    let deleted =
        json!({ "id": "4", "messageType": "message", "deletedDateTime": "2024-05-01T10:00:00Z" });
    assert!(graph_message("t", ME, &deleted).is_none());
    assert!(graph_message("t", ME, &json!({ "messageType": "message" })).is_none());
    let other = json!({ "id": "5", "from": { "user": { "id": "u2", "displayName": "Bob" } } });
    assert!(!graph_message("t", "", &other).unwrap().outbound);
}

#[test]
fn page_items_tolerate_missing_value() {
    assert_eq!(items(&json!({ "value": [1, 2] })).len(), 2);
    assert!(items(&Value::Null).is_empty());
    assert!(items(&json!({ "value": "x" })).is_empty());
}
