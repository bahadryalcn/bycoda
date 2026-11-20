use bycoda_provider_process_guardian::{diagnostic, protocol};
use std::io::{self, Cursor};

const SECRET: &str = "sk-diagnostic-secret-payload";

#[test]
fn failure_line_is_one_bounded_line_with_stage_and_kind_only() {
    let error = io::Error::new(
        io::ErrorKind::BrokenPipe,
        format!("{SECRET}\n{}", "x".repeat(1_000)),
    );
    let line = diagnostic::failure_line("control run", &error);

    assert_eq!(
        line,
        "bycoda-provider-process-guardian: control run failed (BrokenPipe)\n"
    );
}

#[test]
fn failure_line_keeps_the_numeric_os_error_code() {
    let error = io::Error::from_raw_os_error(2);
    let line = diagnostic::failure_line("handle protection", &error);

    assert_eq!(
        line,
        format!(
            "bycoda-provider-process-guardian: handle protection failed ({:?}, OS error 2)\n",
            error.kind()
        )
    );
}

#[test]
fn invalid_frame_error_names_serde_category_without_payload() {
    let frame = format!("{{\"kind\":\"write\",\"data\":\"{SECRET}\",\"extra\":1}}\n");
    let error = protocol::read_command(&mut Cursor::new(frame.into_bytes()))
        .expect_err("unknown fields must be rejected");

    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    assert_eq!(error.to_string(), "Invalid control frame (data)");
    assert!(!error.to_string().contains(SECRET));
}

#[test]
fn malformed_json_reports_syntax_category_without_payload() {
    let frame = format!("{{\"kind\":{SECRET}\n");
    let error = protocol::read_command(&mut Cursor::new(frame.into_bytes()))
        .expect_err("malformed JSON must be rejected");

    assert_eq!(error.to_string(), "Invalid control frame (syntax)");
    assert!(!error.to_string().contains(SECRET));
}

#[test]
fn clean_eof_is_not_a_failure_for_the_diagnostic_path() {
    let result = protocol::read_command(&mut Cursor::new(Vec::<u8>::new()))
        .expect("empty input is a normal parent EOF");
    assert!(result.is_none());
}
