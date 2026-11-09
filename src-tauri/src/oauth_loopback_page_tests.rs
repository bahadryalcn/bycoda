use super::*;

#[test]
fn pages_are_self_contained() {
    for kind in [Kind::Success, Kind::Failure, Kind::Cancelled] {
        for lang in [Lang::En, Lang::Tr] {
            let page = render(kind, "Sign-in failed (x).", lang);
            for forbidden in [
                "http:", "https:", "//", "<script", "src=", "href=", "url(", "@import",
            ] {
                assert!(!page.contains(forbidden), "{kind:?} contains {forbidden}");
            }
            assert!(page.contains("<svg"));
        }
    }
}

#[test]
fn the_reason_is_escaped_and_only_shown_on_failure() {
    let page = render(Kind::Failure, "<img onerror=x>&\"'", Lang::En);
    assert!(page.contains("&lt;img onerror=x&gt;&amp;&quot;&#39;"));
    assert!(!page.contains("<img"));
    assert!(!render(Kind::Success, "secret reason", Lang::En).contains("secret reason"));
}

#[test]
fn language_follows_the_most_preferred_accept_language() {
    let head = |value: &str| format!("GET /callback HTTP/1.1\r\nAccept-Language: {value}\r\n\r\n");
    assert_eq!(
        Lang::from_request(&head("tr-TR,tr;q=0.9,en;q=0.8")),
        Lang::Tr
    );
    assert_eq!(Lang::from_request(&head("en-US,tr;q=0.9")), Lang::En);
    assert_eq!(
        Lang::from_request("GET /callback HTTP/1.1\r\n\r\n"),
        Lang::En
    );
    assert!(render(Kind::Success, "", Lang::Tr).contains("Oturum açıldı"));
}
