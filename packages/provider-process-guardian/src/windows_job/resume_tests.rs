//! Regression guard for `resume_child`: the suspended-start path must resume the
//! child's own thread list, never a machine-wide thread snapshot. Each provider
//! start paid for every thread on the system before this lookup changed.

/// Body of `pub fn resume_child`, from its signature to the closing brace at column 0.
fn resume_child_body() -> &'static str {
    const SOURCE: &str = include_str!("../windows_job.rs");
    let start = SOURCE
        .find("pub fn resume_child(")
        .expect("resume_child definition present");
    let rest = &SOURCE[start..];
    let end = rest.find("\n}\n").expect("resume_child closing brace present");
    &rest[..end]
}

#[test]
fn resume_child_does_not_enumerate_system_threads() {
    let body = resume_child_body();
    assert!(
        !body.contains("CreateToolhelp32Snapshot") && !body.contains("Thread32First"),
        "resume_child must not walk a machine-wide thread snapshot"
    );
    assert!(
        body.contains("NtGetNextThread"),
        "resume_child must look up the child's own primary thread"
    );
}

#[test]
fn resume_child_keeps_single_thread_resume_and_no_leaked_handles() {
    let body = resume_child_body();
    assert_eq!(
        body.matches("ResumeThread(").count(),
        1,
        "exactly one thread is resumed"
    );
    assert!(
        body.contains("OwnedHandle::from_raw_handle(raw)")
            && body.matches("OwnedHandle::from_raw_handle").count() == 2,
        "process and thread handles are owned so every return path closes them"
    );
}
