use super::file_log::*;
use super::logs::{collect_from, host_marker_path, Sources};
use log::Level;
use time::macros::datetime;

#[test]
fn line_matches_the_shared_format() {
    let at = datetime!(2026-03-04 05:06:07.089 UTC);
    assert_eq!(
        format_line(at, Level::Warn, "bycoda_lib::account", "hi"),
        "2026-03-04T05:06:07.089Z WARN  [native.bycoda_lib.account] hi"
    );
}

#[test]
fn levels_map_to_shared_names() {
    assert_eq!(level_name(Level::Error), "ERROR");
    assert_eq!(level_name(Level::Warn), "WARN");
    assert_eq!(level_name(Level::Info), "INFO");
    assert_eq!(level_name(Level::Debug), "DEBUG");
    assert_eq!(level_name(Level::Trace), "DEBUG");
}

#[test]
fn category_is_sanitized_and_limited() {
    assert_eq!(category_for("Foo Bar::baz!"), "native.foo_bar.baz_");
    assert_eq!(category_for(&"a".repeat(100)).len(), 48);
}

#[test]
fn continuation_lines_are_indented() {
    let line = format_line(
        datetime!(2026-01-01 00:00 UTC),
        Level::Error,
        "x",
        "first\r\nsecond\nthird\n\n",
    );
    assert!(line.ends_with("first\n  second\n  third"));
}

#[test]
fn level_env_parses_or_falls_back() {
    assert_eq!(level_from_env(Some("warn")), log::LevelFilter::Warn);
    assert_eq!(level_from_env(Some("nope")), level_from_env(None));
}

#[test]
fn rotation_keeps_two_older_files() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().join("bycoda.log");
    let mut file = RotatingFile::new(base.clone(), 40);
    for index in 0..8 {
        file.write_line(&format!("line number {index} padding"))
            .unwrap();
    }
    assert!(base.exists());
    assert!(rotated_path(&base, 1).exists());
    assert!(rotated_path(&base, 2).exists());
    assert!(!rotated_path(&base, 3).exists());
    let newest = std::fs::read_to_string(&base).unwrap();
    assert!(newest.contains("line number 7"));
    assert!(std::fs::metadata(&base).unwrap().len() <= 80);
}

#[test]
fn sections_follow_the_documented_order_and_skip_missing() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    let host = dir.path().join("host");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::create_dir_all(host.join("logs")).unwrap();
    for (path, text) in [
        (app.join("bycoda.log"), "a\n"),
        (app.join("bycoda.1.log"), "b\n"),
        (host.join("logs").join("host.log"), "c\n"),
        (host.join("logs").join("host.1.log"), "d\n"),
        (host.join("host.log"), "e\n"),
    ] {
        std::fs::write(path, text).unwrap();
    }
    let marker = r#"{"message":"m","location":null,"thread":"host","backtrace":"b","occurredAt":"t","appVersion":"v"}"#;
    std::fs::write(host_marker_path(&host), marker).unwrap();
    let native = dir.path().join("last-crash.json");
    std::fs::write(&native, marker.replace("\"host\"", "\"main\"")).unwrap();
    let sources = Sources {
        environment: "appVersion: 1".into(),
        native_marker: Some(native),
        app_log: Some(app.join("bycoda.log")),
        host_dir: Some(host.clone()),
    };
    let (sections, crash, host_crash) = collect_from(&sources);
    let names: Vec<_> = sections.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "environment",
            "native",
            "host-crash",
            "app",
            "app-previous",
            "host",
            "host-previous",
            "host-stdout"
        ]
    );
    assert_eq!(crash.unwrap().thread.as_deref(), Some("main"));
    assert_eq!(host_crash.unwrap().thread.as_deref(), Some("host"));

    std::fs::remove_dir_all(host.join("logs")).unwrap();
    let (sections, _, host_crash) = collect_from(&sources);
    assert!(host_crash.is_none());
    let names: Vec<_> = sections.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "environment",
            "native",
            "app",
            "app-previous",
            "host-stdout"
        ]
    );
}
