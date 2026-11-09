use super::*;

fn summary(
    uid: u32,
    at: u64,
    id: Option<&str>,
    irt: &[&str],
    refs: &[&str],
    subject: &str,
) -> Summary {
    Summary {
        uid,
        message_id: id.map(str::to_string),
        in_reply_to: irt.iter().map(|id| id.to_string()).collect(),
        references: refs.iter().map(|id| id.to_string()).collect(),
        subject: subject.into(),
        at,
        seen: true,
        ..Summary::default()
    }
}

fn fixture() -> Vec<Summary> {
    vec![
        summary(1, 1_000, Some("a@x"), &[], &[], "Plan"),
        summary(2, 2_000, Some("b@x"), &["a@x"], &["a@x"], "Re: Plan"),
        // Replies only naming the parent still join the root.
        summary(3, 5_000, Some("c@x"), &["b@x"], &[], "Re: Plan"),
        summary(4, 3_000, Some("d@x"), &[], &[], "Other"),
        summary(5, 4_000, None, &[], &[], "Hello there"),
        summary(6, 4_500, None, &[], &[], "RE: Fwd: hello   there"),
    ]
}

#[test]
fn groups_by_root_and_sorts_newest_first() {
    let summaries = fixture();
    let groups = group(&summaries);
    assert_eq!(groups.len(), 3);
    assert_eq!(groups[0].members, vec![0, 1, 2]);
    assert_eq!(groups[0].id, thread_id("id:a@x"));
    assert_eq!(groups[1].members, vec![4, 5]);
    assert_eq!(groups[1].id, thread_id("subject:hello there"));
    assert_eq!(groups[2].members, vec![3]);
    assert_eq!(groups[0].newest(&summaries).uid, 3);
}

#[test]
fn thread_ids_are_opaque_and_stable() {
    let id = thread_id("id:a@x");
    assert!(id.starts_with("e:"));
    assert_eq!(id.len(), 34);
    assert!(id[2..].chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(id, thread_id("id:a@x"));
    assert_ne!(id, thread_id("id:b@x"));
    assert!(message_key(Some("a@x"), 1).starts_with("m:"));
    assert_eq!(message_key(None, 7), "u:7");
}

#[test]
fn membership_survives_a_window_without_the_root() {
    let full = fixture();
    // A smaller scan without A and B resolves C to its parent B only.
    let partial = vec![full[2].clone()];
    let partial_id = group(&partial)[0].id.clone();
    assert_eq!(partial_id, thread_id("id:b@x"));
    let members = members_of(&full, &partial_id);
    assert_eq!(members, vec![2]);
    assert_eq!(members_of(&full, &thread_id("id:a@x")), vec![0, 1, 2]);
    assert!(members_of(&full, "e:unknown").is_empty());
}

#[test]
fn reference_cycles_terminate() {
    let summaries = vec![
        summary(1, 1, Some("a@x"), &["b@x"], &[], "x"),
        summary(2, 2, Some("b@x"), &["a@x"], &[], "x"),
    ];
    assert_eq!(
        group(&summaries)
            .iter()
            .map(|group| group.members.len())
            .sum::<usize>(),
        2
    );
}

#[test]
fn normalizes_reply_prefixes_and_tags() {
    assert_eq!(
        normalize_subject("Re: Fwd: [list] Hello  World"),
        "hello world"
    );
    assert_eq!(normalize_subject("AW: RE: Bericht"), "bericht");
    assert_eq!(normalize_subject("Re[2]: Status"), "status");
    assert_eq!(normalize_subject("Ynt: Toplantı"), "toplantı");
    assert_eq!(normalize_subject("Meeting: notes"), "meeting: notes");
}

#[test]
fn summarizes_encoded_headers() {
    let raw = concat!(
        "Message-ID: <root@example.org>\r\n",
        "In-Reply-To: <p1@example.org>\r\n",
        "References: <r0@example.org>\r\n <p1@example.org>\r\n",
        "Subject: =?UTF-8?B?VG9wbGFudMSxIG5vdGxhcsSx?=\r\n",
        "From: =?UTF-8?B?w4dhxJ9yxLEgWcSxbG1heg==?= <cagri@example.org>\r\n",
        "Reply-To: \"Team\" <team@example.org>, other@example.org\r\n",
        "Date: Thu, 01 Jan 1970 00:01:40 +0000\r\n",
        "\r\n",
    );
    let parsed = parse_headers(raw.as_bytes()).unwrap();
    let summary = summarize(&parsed, 9, None);
    assert_eq!(summary.message_id.as_deref(), Some("root@example.org"));
    assert_eq!(summary.in_reply_to, vec!["p1@example.org"]);
    assert_eq!(summary.references, vec!["r0@example.org", "p1@example.org"]);
    assert_eq!(summary.subject, "Toplantı notları");
    assert_eq!(summary.from.as_ref().unwrap().label(), "Çağrı Yılmaz");
    assert_eq!(summary.from.as_ref().unwrap().address, "cagri@example.org");
    assert_eq!(summary.reply_to.len(), 2);
    assert_eq!(summary.reply_to[0].name.as_deref(), Some("Team"));
    assert_eq!(summary.at, 100_000);
    assert_eq!(summarize(&parsed, 9, Some(5)).at, 5_000);
}

#[test]
fn decodes_iso_8859_and_quoted_printable_subjects() {
    let raw = b"Subject: =?ISO-8859-1?Q?Caf=E9_cr=E8me?=\r\nFrom: Bob <bob@example.org>\r\n\r\n";
    let summary = summarize(&parse_headers(raw).unwrap(), 1, None);
    assert_eq!(summary.subject, "Café crème");
    assert_eq!(summary.from.unwrap().label(), "Bob");
}

#[test]
fn previews_skip_quotes_and_cap_length() {
    let body = "Thanks, see below.\n\nOn Mon, Ada wrote:\n> old text\n> more";
    assert_eq!(preview_text(body, 100), "Thanks, see below.");
    assert_eq!(preview_text("a   b\n\tc", 100), "a b c");
    assert_eq!(preview_text(&"é".repeat(10), 4), "éééé…");
}
