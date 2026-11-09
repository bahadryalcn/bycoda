use super::*;

#[test]
fn parses_reply_lines() {
    assert_eq!(
        parse_reply_line("250-SIZE 35882577"),
        Some((250, false, "SIZE 35882577".into()))
    );
    assert_eq!(parse_reply_line("250 OK"), Some((250, true, "OK".into())));
    assert_eq!(parse_reply_line("354"), Some((354, true, String::new())));
    assert_eq!(
        parse_reply_line("535 5.7.8 Username and Password not accepted"),
        Some((535, true, "5.7.8 Username and Password not accepted".into()))
    );
    assert_eq!(parse_reply_line("OK"), None);
    assert_eq!(parse_reply_line("2x0 nope"), None);
}

#[test]
fn dot_stuffs_and_terminates_data() {
    assert_eq!(
        dot_stuff(b".hidden\r\nline\r\n..x"),
        b"..hidden\r\nline\r\n...x\r\n.\r\n".to_vec()
    );
    assert_eq!(dot_stuff(b"a\r\n"), b"a\r\n.\r\n".to_vec());
    assert_eq!(dot_stuff(b"a\r\n.\r\n"), b"a\r\n..\r\n.\r\n".to_vec());
}

#[test]
fn reply_classes() {
    let reply = |code| Reply {
        code,
        lines: vec!["x\u{7}".into()],
    };
    assert!(reply(250).positive());
    assert!(reply(354).positive());
    assert!(!reply(550).positive());
    assert_eq!(reply(550).text(), "x");
}
