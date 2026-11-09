use super::crash::*;

fn marker() -> CrashMarker {
    CrashMarker {
        message: "boom".into(),
        location: Some("src/a.rs:1:2".into()),
        thread: None,
        backtrace: "frame".into(),
        occurred_at: "2026-01-01T00:00:00Z".into(),
        app_version: "0.7.7".into(),
    }
}

#[test]
fn marker_round_trips_with_camel_case_fields() {
    let raw = serde_json::to_string(&marker()).unwrap();
    assert!(raw.contains("\"occurredAt\"") && raw.contains("\"appVersion\""));
    assert_eq!(serde_json::from_str::<CrashMarker>(&raw).unwrap(), marker());
}

#[test]
fn truncation_respects_char_boundaries() {
    let text = "\u{e9}".repeat(5);
    assert_eq!(truncate_chars(&text, 3), "\u{e9}".repeat(3));
    assert_eq!(truncate_chars("abc", 10), "abc");
}

#[test]
fn render_lists_every_field() {
    let text = render_marker(&marker());
    for part in [
        "boom",
        "src/a.rs:1:2",
        "thread: unknown",
        "2026-01-01T00:00:00Z",
        "0.7.7",
        "frame",
    ] {
        assert!(text.contains(part), "{part}");
    }
}
