use super::*;
use serde_json::json;

fn config() -> EmailConfig {
    EmailConfig::parse(
        &json!({ "preset": "gmail", "address": "me@gmail.com", "displayName": "Me" }),
    )
    .unwrap()
}

fn account() -> Account {
    Account {
        id: "acc".into(),
        provider: Provider::Email,
        label: "Me".into(),
        identity: "me@gmail.com".into(),
        config: config().to_value(),
        created_at: 0,
        updated_at: 0,
    }
}

fn mailbox(name: Option<&str>, address: &str) -> Mailbox {
    Mailbox {
        name: name.map(str::to_string),
        address: address.into(),
    }
}

#[test]
fn normalize_config_returns_the_normalized_shape() {
    let value =
        normalize_config(&json!({ "preset": "gmail", "address": " me@gmail.com " })).unwrap();
    assert_eq!(value["address"], "me@gmail.com");
    assert_eq!(value["smtpPort"], 465);
    assert!(normalize_config(&json!({})).is_err());
}

#[test]
fn reply_goes_to_reply_to_then_from() {
    let mut parent = Summary {
        from: Some(mailbox(Some("Bob"), "bob@x.org")),
        ..Summary::default()
    };
    assert_eq!(
        reply_recipients(&parent).unwrap(),
        vec![mailbox(Some("Bob"), "bob@x.org")]
    );
    parent.reply_to = vec![
        mailbox(None, "list@x.org"),
        mailbox(None, "LIST@x.org"),
        mailbox(None, "bad address@x.org"),
        mailbox(None, "inject@x.org>\r\nRCPT TO:<y@z.org"),
    ];
    assert_eq!(
        reply_recipients(&parent).unwrap(),
        vec![mailbox(None, "list@x.org")]
    );
    assert!(reply_recipients(&Summary::default()).is_err());
}

#[test]
fn thread_view_summarizes_a_group() {
    let summaries = vec![
        Summary {
            uid: 1,
            message_id: Some("a@x".into()),
            subject: "Plan".into(),
            from: Some(mailbox(Some("Bob"), "bob@x.org")),
            at: 1_000,
            seen: true,
            ..Summary::default()
        },
        Summary {
            uid: 2,
            message_id: Some("b@x".into()),
            references: vec!["a@x".into()],
            subject: "Re: Plan".into(),
            from: Some(mailbox(None, "ME@gmail.com")),
            at: 2_000,
            seen: false,
            ..Summary::default()
        },
    ];
    let groups = threads::group(&summaries);
    assert_eq!(groups.len(), 1);
    let previews = HashMap::from([(2u32, "Sounds good".to_string())]);
    let thread = thread_view(&account(), &config(), &summaries, &groups[0], &previews);
    assert_eq!(thread.title, "Plan");
    assert_eq!(thread.participants, vec!["Bob"]);
    assert_eq!(thread.preview, "Sounds good");
    assert_eq!(thread.updated_at, 2_000);
    assert!(thread.unread);
    assert_eq!(thread.account_id, "acc");
    let without_preview = thread_view(
        &account(),
        &config(),
        &summaries,
        &groups[0],
        &HashMap::new(),
    );
    assert_eq!(without_preview.preview, "Re: Plan");
}

#[test]
fn full_message_parses_body_and_direction() {
    let raw = b"From: Me <me@gmail.com>\r\nSubject: Hi\r\nContent-Type: text/html\r\n\r\n<p>Hi&nbsp;<i>there</i></p>\r\n";
    let fetched = Fetched {
        uid: 5,
        size: Some(raw.len() as u64),
        sections: vec![("BODY[]<0>".into(), raw.to_vec())],
        ..Fetched::default()
    };
    let summary = Summary {
        uid: 5,
        message_id: Some("m@x".into()),
        from: Some(mailbox(Some("Me"), "me@gmail.com")),
        at: 9_000,
        ..Summary::default()
    };
    let message = full_message(&config(), "e:t", &summary, &fetched);
    assert_eq!(message.body, "Hi there");
    assert!(message.outbound);
    assert_eq!(message.author, "Me");
    assert_eq!(message.at, 9_000);
    assert_eq!(message.id, threads::message_key(Some("m@x"), 5));
    let large = Fetched {
        size: Some(MAX_MESSAGE_BYTES + 1),
        ..fetched
    };
    assert!(full_message(&config(), "e:t", &summary, &large)
        .body
        .ends_with("only the beginning is shown.]"));
}

#[test]
fn uid_sets_are_comma_separated() {
    assert_eq!(uid_set(&[3, 9, 12]), "3,9,12");
}
