use super::*;

fn profile(kind: &str) -> ShellProfile {
    ShellProfile {
        id: kind.into(),
        name: kind.into(),
        path: kind.into(),
        kind: kind.into(),
    }
}

#[test]
fn one_shot_argv_preserves_code_without_stdin_or_markers() {
    let code = "printf '%s' \"a'b\"\nexit 7";
    assert_eq!(
        command_args(&profile("bash"), code, Some("posix")).unwrap(),
        vec!["-c", code]
    );
    let code = "Write-Output 'Türkçe'\nexit 9";
    assert_eq!(
        command_args(&profile("pwsh"), code, Some("powershell")).unwrap(),
        vec!["-NoLogo", "-NoProfile", "-Command", code]
    );
}

#[test]
fn command_language_must_match_an_explicit_supported_shell() {
    assert!(command_args(&profile("bash"), "echo hi", Some("powershell")).is_err());
    assert!(command_args(&profile("fish"), "echo hi", Some("posix")).is_err());
    assert!(command_args(&profile("cmd"), "echo \"hello\"", Some("cmd")).is_err());
    assert!(command_args(&profile("bash"), "echo hi", None).is_err());
    assert!(launch(None, Some("echo hi"), Some("posix")).is_err());
    assert!(launch(None, None, Some("posix")).is_err());
}

#[test]
fn reject_empty_oversized_and_nul_commands() {
    for code in [" ".to_owned(), "echo\0hi".to_owned(), "x".repeat(10_001)] {
        assert!(command_args(&profile("bash"), &code, Some("posix")).is_err());
    }
    assert!(command_args(&profile("bash"), &"ş".repeat(10_000), Some("posix")).is_ok());
}

#[test]
fn one_shot_requires_drain_acknowledgement_but_interactive_exit_does_not_wait() {
    let (sender, receiver) = std::sync::mpsc::channel();
    sender.send(true).unwrap();
    assert_eq!(await_drain(true, receiver), Some(true));
    let (sender, receiver) = std::sync::mpsc::channel();
    drop(sender);
    assert_eq!(await_drain(true, receiver), Some(false));
    let (_sender, receiver) = std::sync::mpsc::channel();
    assert_eq!(await_drain(false, receiver), None);
}
