use super::*;
use mail_parser::MessageParser;

#[test]
fn html_to_text_drops_markup_scripts_and_styles() {
    let html = concat!(
        "<html><head><title>T</title><style>p{color:red}</style></head><body>",
        "<script type=\"text/javascript\">alert('x<y')</script>",
        "<p>Hello&nbsp;<b>Ada</b> &amp; team,</p><!-- hidden -->",
        "<div>Line one<br>Line two</div>",
        "<ul><li>First</li><li>Second &#8211; &#x263A;</li></ul>",
        "<p>Visit <a href=\"https://example.org/x?a=1&amp;b=2\">our site</a>.</p>",
        "<p><a href='https://example.org'>https://example.org</a></p>",
        "<pre>  keep   spacing</pre>",
        "</body></html>",
    );
    let text = html_to_text(html);
    assert!(!text.contains('<') || text.contains("<https://"), "{text}");
    assert!(!text.contains("alert"));
    assert!(!text.contains("color"));
    assert!(!text.contains("hidden"));
    assert_eq!(
        text,
        "Hello Ada & team,\nLine one\nLine two\n- First\n- Second – ☺\n\
Visit our site <https://example.org/x?a=1&b=2>.\nhttps://example.org\n  keep   spacing"
    );
}

#[test]
fn html_to_text_handles_broken_markup() {
    assert_eq!(html_to_text("a < b and c"), "a < b and c");
    assert_eq!(html_to_text("<p>unclosed <script>evil()"), "unclosed");
    assert_eq!(
        html_to_text("&unknown; &amp &lt;tag&gt;"),
        "&unknown; &amp <tag>"
    );
    assert_eq!(html_to_text("<P>One</P>\n\n\n<P>Two</P>"), "One\nTwo");
    assert_eq!(html_to_text("<img alt=\"Logo\" src=x>"), "Logo");
}

#[test]
fn body_prefers_plain_text_and_decodes_charsets() {
    let raw = concat!(
        "From: a@example.org\r\n",
        "Content-Type: multipart/alternative; boundary=\"b\"\r\n\r\n",
        "--b\r\n",
        "Content-Type: text/plain; charset=iso-8859-9\r\n",
        "Content-Transfer-Encoding: quoted-printable\r\n\r\n",
        "G=FCnayd=FDn, toplant=FD yar=FDn.\r\n",
        "--b\r\n",
        "Content-Type: text/html; charset=utf-8\r\n\r\n",
        "<p>HTML version</p>\r\n",
        "--b--\r\n",
    );
    let parsed = MessageParser::default().parse(raw.as_bytes()).unwrap();
    assert_eq!(body_text(&parsed), "Günaydın, toplantı yarın.");
}

#[test]
fn html_only_body_is_converted_to_text() {
    let raw = concat!(
        "From: a@example.org\r\n",
        "Content-Type: text/html; charset=windows-1252\r\n",
        "Content-Transfer-Encoding: base64\r\n\r\n",
        "PHA+SGkgPGI+dGhlcmU8L2I+IJY8L3A+PHNjcmlwdD54KCk8L3NjcmlwdD4=\r\n",
    );
    let parsed = MessageParser::default().parse(raw.as_bytes()).unwrap();
    assert_eq!(body_text(&parsed), "Hi there –");
}

#[test]
fn attachments_report_names_and_sizes() {
    let raw = concat!(
        "From: a@example.org\r\n",
        "Content-Type: multipart/mixed; boundary=\"m\"\r\n\r\n",
        "--m\r\n",
        "Content-Type: text/plain\r\n\r\n",
        "See attached.\r\n",
        "--m\r\n",
        "Content-Type: application/pdf; name=\"report.pdf\"\r\n",
        "Content-Disposition: attachment; filename=\"report.pdf\"\r\n",
        "Content-Transfer-Encoding: base64\r\n\r\n",
        "AAECAwQF\r\n",
        "--m--\r\n",
    );
    let parsed = MessageParser::default().parse(raw.as_bytes()).unwrap();
    assert_eq!(body_text(&parsed), "See attached.");
    let complete = attachments(&parsed, true);
    assert_eq!(
        complete,
        vec![Attachment {
            name: "report.pdf".into(),
            size: Some(6)
        }]
    );
    assert_eq!(attachments(&parsed, false)[0].size, None);
}

#[test]
fn reply_subject_does_not_stack() {
    assert_eq!(reply_subject("Plan"), "Re: Plan");
    assert_eq!(reply_subject("Re: Plan"), "Re: Plan");
    assert_eq!(reply_subject("RE: Plan"), "RE: Plan");
    assert_eq!(reply_subject("re[2]: Plan"), "re[2]: Plan");
    assert_eq!(reply_subject("  "), "Re:");
    assert_eq!(reply_subject("Fwd: Plan"), "Re: Fwd: Plan");
}

#[test]
fn reply_references_append_parent_and_cap() {
    let parent = vec!["a@x".to_string(), "b@x".to_string()];
    assert_eq!(
        reply_references(&parent, Some("c@x")),
        vec!["a@x", "b@x", "c@x"]
    );
    assert_eq!(reply_references(&parent, Some("b@x")), vec!["a@x", "b@x"]);
    assert_eq!(reply_references(&[], None), Vec::<String>::new());
    let long: Vec<String> = (0..30).map(|n| format!("{n}@x")).collect();
    let capped = reply_references(&long, Some("new@x"));
    assert_eq!(capped.len(), 20);
    assert_eq!(capped[0], "0@x");
    assert_eq!(capped.last().unwrap(), "new@x");
}

#[test]
fn formats_dates_and_mailboxes() {
    assert_eq!(rfc5322_date(0), "Thu, 01 Jan 1970 00:00:00 +0000");
    assert_eq!(rfc5322_date(837_596_665), "Wed, 17 Jul 1996 09:44:25 +0000");
    let mailbox = |name: Option<&str>| Mailbox {
        name: name.map(str::to_string),
        address: "a@x.org".into(),
    };
    assert_eq!(format_mailbox(&mailbox(None)), "<a@x.org>");
    assert_eq!(
        format_mailbox(&mailbox(Some("Ada Lovelace"))),
        "Ada Lovelace <a@x.org>"
    );
    assert_eq!(
        format_mailbox(&mailbox(Some("Lovelace, Ada"))),
        "\"Lovelace, Ada\" <a@x.org>"
    );
    assert!(format_mailbox(&mailbox(Some("Çağrı"))).starts_with("=?UTF-8?B?"));
}

#[test]
fn builds_a_parseable_reply_without_header_injection() {
    let from = Mailbox {
        name: Some("Ada Yılmaz".into()),
        address: "ada@example.org".into(),
    };
    let to = vec![Mailbox {
        name: Some("Bob".into()),
        address: "bob@example.org".into(),
    }];
    let references = vec!["root@x".to_string(), "parent@x".to_string()];
    let data = build_reply(&Reply {
        from: &from,
        to: &to,
        subject: "Re: Toplantı\r\nBcc: evil@example.org",
        in_reply_to: Some("parent@x"),
        references: &references,
        message_id: "new@example.org",
        date: "Thu, 01 Jan 1970 00:00:00 +0000",
        body: "Merhaba,\n.\nGörüşürüz",
    });
    let text = String::from_utf8(data.clone()).unwrap();
    assert!(!text.lines().any(|line| line.starts_with("Bcc:")));
    assert!(text.contains("In-Reply-To: <parent@x>\r\n"));
    assert!(text.contains("References: <root@x>\r\n <parent@x>\r\n"));
    assert!(text.contains("Content-Transfer-Encoding: base64\r\n"));
    assert!(text.lines().all(|line| line.len() <= 998));
    let parsed = MessageParser::default().parse(&data).unwrap();
    assert_eq!(parsed.subject(), Some("Re: Toplantı Bcc: evil@example.org"));
    assert_eq!(parsed.message_id(), Some("new@example.org"));
    assert_eq!(
        parsed.from().unwrap().first().unwrap().name(),
        Some("Ada Yılmaz")
    );
    assert_eq!(
        parsed.to().unwrap().first().unwrap().address(),
        Some("bob@example.org")
    );
    assert_eq!(
        body_text(&parsed),
        "Merhaba,\r\n.\r\nGörüşürüz".replace("\r\n", "\n")
    );
}

#[test]
fn ascii_reply_uses_seven_bit() {
    let from = Mailbox {
        name: None,
        address: "a@x.org".into(),
    };
    let data = build_reply(&Reply {
        from: &from,
        to: std::slice::from_ref(&from),
        subject: "Re: Hi",
        in_reply_to: None,
        references: &[],
        message_id: "m@x.org",
        date: "Thu, 01 Jan 1970 00:00:00 +0000",
        body: "Plain\nreply",
    });
    let text = String::from_utf8(data).unwrap();
    assert!(text.contains("Content-Transfer-Encoding: 7bit\r\n\r\nPlain\r\nreply\r\n"));
    assert!(!text.contains("In-Reply-To"));
    assert!(!text.contains("References"));
}
