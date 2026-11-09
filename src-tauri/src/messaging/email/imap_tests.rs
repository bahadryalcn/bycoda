use super::*;

#[test]
fn detects_literal_markers() {
    assert_eq!(literal_len(b"* 1 FETCH (UID 9 BODY[] {12}"), Some(12));
    assert_eq!(literal_len(b"A1 LOGIN {5+}"), Some(5));
    assert_eq!(literal_len(b"* OK done"), None);
    assert_eq!(literal_len(b"* OK {}"), None);
    assert_eq!(literal_len(b"* OK {1a}"), None);
}

#[test]
fn parses_fetch_with_section_literal_and_flags() {
    let header = b"Subject: Hi\r\nFrom: a@example.org\r\n\r\n";
    let mut response = Vec::new();
    response.extend_from_slice(
        b"* 12 FETCH (UID 345 FLAGS (\\Seen \\Answered) INTERNALDATE \"17-Jul-1996 02:44:25 -0700\" \
RFC822.SIZE 4286 BODY[HEADER.FIELDS (SUBJECT FROM)] {",
    );
    response.extend_from_slice(format!("{}}}\r\n", header.len()).as_bytes());
    response.extend_from_slice(header);
    response.extend_from_slice(b" BODY[TEXT]<0> {5}\r\nhello)\r\n");
    let items = parse_items(&response).unwrap();
    let fetched = parse_fetch(&items).unwrap();
    assert_eq!(fetched.uid, 345);
    assert!(fetched.seen());
    assert_eq!(fetched.size, Some(4286));
    assert_eq!(
        fetched.internal_date.as_deref(),
        Some("17-Jul-1996 02:44:25 -0700")
    );
    assert_eq!(fetched.section("BODY[HEADER"), Some(&header[..]));
    assert_eq!(fetched.section("BODY[TEXT]"), Some(&b"hello"[..]));
    assert_eq!(fetched.section("BODY[]"), None);
}

#[test]
fn literal_bytes_may_contain_parentheses_and_quotes() {
    let response = b"* 1 FETCH (UID 2 BODY[] {9}\r\n(\"x\") {1}\r\n)\r\n";
    let fetched = parse_fetch(&parse_items(response).unwrap()).unwrap();
    assert_eq!(fetched.section("BODY[]"), Some(&b"(\"x\") {1}"[..]));
    assert!(!fetched.seen());
}

#[test]
fn parses_quoted_strings_nil_and_nested_lists() {
    let items =
        parse_items(b"* LIST (\\HasNoChildren) \"/\" \"a \\\"b\\\" \\\\c\" NIL (1 (2))\r\n")
            .unwrap();
    assert_eq!(items[3], Item::Bytes(b"/".to_vec()));
    assert_eq!(items[4], Item::Bytes(b"a \"b\" \\c".to_vec()));
    assert_eq!(items[5], Item::Nil);
    assert_eq!(
        items[6],
        Item::List(vec![
            Item::Atom("1".into()),
            Item::List(vec![Item::Atom("2".into())])
        ])
    );
    assert!(parse_items(b"* 1 FETCH (UID 2").is_err());
    assert!(parse_items(b"* 1 FETCH (BODY[] {99}\r\nshort)").is_err());
}

#[test]
fn fetch_without_uid_is_ignored() {
    let items = parse_items(b"* 3 FETCH (FLAGS (\\Seen))\r\n").unwrap();
    assert_eq!(parse_fetch(&items), None);
    let items = parse_items(b"* 3 EXISTS\r\n").unwrap();
    assert_eq!(parse_fetch(&items), None);
}

#[test]
fn internal_date_converts_to_utc_seconds() {
    assert_eq!(
        parse_internal_date("17-Jul-1996 02:44:25 -0700"),
        Some(837_596_665)
    );
    assert_eq!(parse_internal_date(" 1-Jan-1970 00:00:00 +0000"), Some(0));
    assert_eq!(parse_internal_date("01-Jan-1970 03:00:00 +0300"), Some(0));
    assert_eq!(parse_internal_date("32-Foo-2020 00:00:00 +0000"), None);
    assert_eq!(parse_internal_date("garbage"), None);
}

#[test]
fn tagged_status_and_quoting() {
    let tagged = parse_tagged(b"A7 NO [AUTHENTICATIONFAILED] Invalid credentials", "A7").unwrap();
    assert!(!tagged.ok);
    assert_eq!(tagged.text, "[AUTHENTICATIONFAILED] Invalid credentials");
    assert!(parse_tagged(b"A7 OK done", "A7").unwrap().ok);
    assert!(parse_tagged(b"A70 OK done", "A7").is_none());
    assert!(parse_tagged(b"* OK done", "A7").is_none());
    assert_eq!(quote("p\"a\\ss").as_deref(), Some("\"p\\\"a\\\\ss\""));
    assert_eq!(quote("şifre"), None);
    assert_eq!(quote("a\r\nb"), None);
    assert!(is_fetch(b"* 5 FETCH (UID 1)"));
    assert!(!is_fetch(b"* OK [ALERT] \"quoted"));
}

#[test]
fn server_text_is_sanitized_and_capped() {
    assert_eq!(server_text(" bad\r\npass\u{7} "), "badpass");
    assert_eq!(server_text(&"x".repeat(300)).chars().count(), 201);
}

/// Loopback fake server: per step, records one client line, then replies in small chunks.
fn serve(steps: Vec<&'static [u8]>) -> (u16, std::thread::JoinHandle<Vec<String>>) {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        let mut writer = socket;
        let mut seen = Vec::new();
        for reply in steps {
            let mut line = Vec::new();
            reader.read_until(b'\n', &mut line).unwrap();
            seen.push(String::from_utf8_lossy(&line).trim_end().to_string());
            for chunk in reply.chunks(7) {
                writer.write_all(chunk).unwrap();
                writer.flush().unwrap();
            }
        }
        seen
    });
    (port, handle)
}

fn loopback(port: u16, capabilities: &[&str]) -> Imap {
    let deadline = Instant::now() + std::time::Duration::from_secs(10);
    Imap::from_conn(
        Conn::connect("127.0.0.1", port, false, deadline).unwrap(),
        capabilities,
    )
}

#[test]
fn session_signs_in_examines_and_fetches_literals_over_loopback() {
    let (port, server) = serve(vec![
        b"A1 OK signed in\r\n",
        b"* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\nA2 OK\r\n",
        b"* 2 EXISTS\r\n* OK [UIDVALIDITY 1] \"stray quote\r\nA3 OK [READ-ONLY] done\r\n",
        b"* 1 FETCH (UID 10 FLAGS () BODY[] {12}\r\nSubject: a\r\n)\r\n\
* 2 FETCH (UID 11 FLAGS (\\Seen) BODY[] {0}\r\n)\r\nA4 OK\r\n",
        b"* BYE bye\r\nA5 OK\r\n",
    ]);
    let mut imap = loopback(port, &["IMAP4rev1", "AUTH=PLAIN", "SASL-IR"]);
    let credential = Credential::Password {
        user: "ada".into(),
        password: "pässword".into(),
    };
    imap.login(&credential, "").unwrap();
    assert_eq!(imap.examine_inbox().unwrap(), 2);
    let fetched = imap.fetch("FETCH 1:2 (UID FLAGS BODY.PEEK[])").unwrap();
    assert_eq!(fetched.len(), 2);
    assert_eq!(fetched[0].section("BODY[]"), Some(&b"Subject: a\r\n"[..]));
    assert!(!fetched[0].seen());
    assert!(fetched[1].seen());
    imap.logout();
    let seen = server.join().unwrap();
    assert_eq!(
        seen[0],
        format!("A1 AUTHENTICATE PLAIN {}", sasl_plain("ada", "pässword"))
    );
    assert_eq!(seen[2], "A3 EXAMINE INBOX");
    assert_eq!(seen[3], "A4 FETCH 1:2 (UID FLAGS BODY.PEEK[])");
}

#[test]
fn xoauth2_failure_challenge_is_answered_and_reported() {
    let (port, server) = serve(vec![
        b"+ eyJzdGF0dXMiOiI0MDEifQ==\r\n",
        b"A1 NO [AUTHENTICATIONFAILED] Invalid credentials\r\n",
    ]);
    let mut imap = loopback(port, &["IMAP4rev1", "AUTH=XOAUTH2", "SASL-IR"]);
    let credential = Credential::OAuth {
        user: "ada@contoso.com".into(),
        token: "secret-token".into(),
    };
    let error = imap.login(&credential, " Sign in again.").unwrap_err();
    assert!(error.contains("rejected the sign-in"), "{error}");
    assert!(error.ends_with("Sign in again."));
    assert!(!error.contains("secret-token"));
    let seen = server.join().unwrap();
    assert!(seen[0].starts_with("A1 AUTHENTICATE XOAUTH2 "));
    assert_eq!(seen[1], "");
}
