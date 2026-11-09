use bycoda_physical_store_admission::guarded_move::move_with_recovery;
use cap_std::{ambient_authority, fs::Dir};
use std::{ffi::OsStr, fs, path::PathBuf};

fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!("guarded-move-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    for child in ["source", "destination", "recovery", "stage"] {
        fs::create_dir(root.join(child)).unwrap();
    }
    root
}
fn open(root: &std::path::Path, child: &str) -> Dir {
    Dir::open_ambient_dir(root.join(child), ambient_authority()).unwrap()
}

#[test]
fn move_publishes_exact_contents_and_retains_recovery_and_receipt() {
    let root = fixture();
    fs::create_dir(root.join("source/tree")).unwrap();
    fs::write(root.join("source/tree/file"), b"payload").unwrap();
    let (source, destination, recovery, stage) = (
        open(&root, "source"),
        open(&root, "destination"),
        open(&root, "recovery"),
        open(&root, "stage"),
    );
    move_with_recovery(
        &source,
        OsStr::new("tree"),
        &destination,
        OsStr::new("tree"),
        &recovery,
        &stage,
        br#"{"version":1}"#,
        &|| Ok(()),
    )
    .unwrap();
    assert_eq!(
        fs::read(root.join("destination/tree/file")).unwrap(),
        b"payload"
    );
    assert_eq!(
        fs::read(root.join("recovery/source/file")).unwrap(),
        b"payload"
    );
    assert!(root.join("recovery/receipt.json").is_file());
    drop((source, destination, recovery, stage));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn occupied_destination_retains_existing_data_and_restores_source() {
    let root = fixture();
    fs::write(root.join("source/file"), b"source").unwrap();
    fs::write(root.join("destination/file"), b"existing").unwrap();
    let (source, destination, recovery, stage) = (
        open(&root, "source"),
        open(&root, "destination"),
        open(&root, "recovery"),
        open(&root, "stage"),
    );
    let error = move_with_recovery(
        &source,
        OsStr::new("file"),
        &destination,
        OsStr::new("file"),
        &recovery,
        &stage,
        b"receipt",
        &|| Ok(()),
    )
    .unwrap_err();
    assert!(!error.published);
    assert!(error.source_restored);
    assert_eq!(fs::read(root.join("source/file")).unwrap(), b"source");
    assert_eq!(
        fs::read(root.join("destination/file")).unwrap(),
        b"existing"
    );
    drop((source, destination, recovery, stage));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn path_adapter_publishes_and_retires_verified_recovery() {
    let root = fixture();
    let from = root.join("source/file");
    let to = root.join("destination/file");
    fs::write(&from, b"payload").unwrap();
    let moved =
        bycoda_physical_store_admission::guarded_move_paths::move_paths(&from, &to).unwrap();
    assert_eq!(fs::read(&to).unwrap(), b"payload");
    // A verified move retires the quarantined copy and receipt (commit 1dc3d8f0).
    assert!(!moved.recovery_retained);
    assert!(fs::symlink_metadata(&moved.recovery_path).is_err());
    assert!(fs::symlink_metadata(&moved.receipt_path).is_err());
    assert!(!from.exists());
    assert!(moved.warning.is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn revoked_admission_before_publication_restores_source_without_publishing() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let root = fixture();
    fs::write(root.join("source/file"), b"source").unwrap();
    let (source, destination, recovery, stage) = (
        open(&root, "source"),
        open(&root, "destination"),
        open(&root, "recovery"),
        open(&root, "stage"),
    );
    let calls = AtomicUsize::new(0);
    let check = || {
        if calls.fetch_add(1, Ordering::SeqCst) == 2 {
            Err(std::io::Error::other("authority revoked"))
        } else {
            Ok(())
        }
    };
    let error = move_with_recovery(
        &source,
        OsStr::new("file"),
        &destination,
        OsStr::new("file"),
        &recovery,
        &stage,
        b"receipt",
        &check,
    )
    .unwrap_err();
    assert!(!error.published);
    assert!(error.source_restored);
    assert_eq!(fs::read(root.join("source/file")).unwrap(), b"source");
    assert!(!root.join("destination/file").exists());
    drop((source, destination, recovery, stage));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn windows_alternate_data_stream_fails_before_source_retirement() {
    let root = fixture();
    let from = root.join("source/file.txt");
    let to = root.join("destination/file.txt");
    fs::write(&from, b"original").unwrap();
    let stream = format!("{}:private", from.display());
    if fs::write(&stream, b"stream").is_ok() {
        assert!(
            bycoda_physical_store_admission::guarded_move_paths::move_paths(&from, &to).is_err()
        );
        assert_eq!(fs::read(&from).unwrap(), b"original");
        assert_eq!(fs::read(&stream).unwrap(), b"stream");
        assert!(!to.exists());
    }
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn windows_unverified_symlink_acl_leaves_original_in_place() {
    use std::os::windows::fs::symlink_file;
    let root = fixture();
    let from = root.join("source/link");
    let to = root.join("destination/link");
    fs::write(root.join("source/target"), b"payload").unwrap();
    if symlink_file("target", &from).is_ok() {
        assert!(
            bycoda_physical_store_admission::guarded_move_paths::move_paths(&from, &to).is_err()
        );
        assert!(fs::symlink_metadata(&from)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(fs::symlink_metadata(&to).is_err());
    }
    fs::remove_dir_all(root).unwrap();
}
