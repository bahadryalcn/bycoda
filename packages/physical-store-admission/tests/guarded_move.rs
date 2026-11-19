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

/// Rewrite a file in place with same-length bytes and put its mtime back, so
/// only a content digest (not length/mtime/identity checks) can see the change.
fn rewrite_keeping_metadata(path: &std::path::Path, bytes: &[u8]) {
    let modified = fs::metadata(path).unwrap().modified().unwrap();
    let mut file = fs::OpenOptions::new().write(true).open(path).unwrap();
    std::io::Write::write_all(&mut file, bytes).unwrap();
    file.set_modified(modified).unwrap();
}

#[test]
fn large_nested_move_publishes_exact_multi_chunk_contents() {
    // Several read chunks (64 KiB) with a pattern, so a copy that dropped its
    // read-back must still be proven exact by the staged digest alone.
    let root = fixture();
    fs::create_dir_all(root.join("source/tree/inner")).unwrap();
    let big: Vec<u8> = (0..(65536 * 3 + 17)).map(|i| (i % 251) as u8).collect();
    fs::write(root.join("source/tree/inner/big"), &big).unwrap();
    fs::write(root.join("source/tree/empty"), b"").unwrap();
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
        b"receipt",
        &|| Ok(()),
    )
    .unwrap();
    assert_eq!(fs::read(root.join("destination/tree/inner/big")).unwrap(), big);
    assert_eq!(fs::read(root.join("recovery/source/inner/big")).unwrap(), big);
    assert!(fs::read(root.join("destination/tree/empty")).unwrap().is_empty());
    assert!(!root.join("source/tree").exists());
    drop((source, destination, recovery, stage));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn same_length_edit_after_digest_is_refused_before_quarantine() {
    // Edit lands after the original digest and before the copy reads the file.
    // The copy is then faithful to the *edited* bytes, so only comparing the
    // staged digest with the original digest (not a copy-vs-source compare)
    // can refuse it. Length, mtime and identity are all unchanged.
    use std::sync::atomic::{AtomicUsize, Ordering};
    let root = fixture();
    let file = root.join("source/file");
    fs::write(&file, b"AAAAAAAA").unwrap();
    let (source, destination, recovery, stage) = (
        open(&root, "source"),
        open(&root, "destination"),
        open(&root, "recovery"),
        open(&root, "stage"),
    );
    let calls = AtomicUsize::new(0);
    let check = || {
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            rewrite_keeping_metadata(&file, b"BBBBBBBB");
        }
        Ok(())
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
    assert!(error.message.contains("Staged copy differs"), "{}", error.message);
    assert!(!error.quarantined);
    assert!(!error.published);
    assert_eq!(fs::read(&file).unwrap(), b"BBBBBBBB");
    assert!(!root.join("destination/file").exists());
    drop((source, destination, recovery, stage));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn same_length_edit_after_staging_is_refused_after_quarantine_and_restored() {
    // Edit lands after the staged copy was verified. Nothing before the
    // quarantine rename can see it without a content re-read, so the digest of
    // the quarantined source must refuse publication and give the source back.
    use std::sync::atomic::{AtomicUsize, Ordering};
    let root = fixture();
    let file = root.join("source/file");
    fs::write(&file, b"AAAAAAAA").unwrap();
    let (source, destination, recovery, stage) = (
        open(&root, "source"),
        open(&root, "destination"),
        open(&root, "recovery"),
        open(&root, "stage"),
    );
    let calls = AtomicUsize::new(0);
    let check = || {
        // Call 0 precedes the copy, call 1 follows the staged digest.
        if calls.fetch_add(1, Ordering::SeqCst) == 1 {
            rewrite_keeping_metadata(&file, b"BBBBBBBB");
        }
        Ok(())
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
    assert!(
        error.message.contains("Source changed before quarantine"),
        "{}",
        error.message
    );
    assert!(error.quarantined);
    assert!(error.source_restored);
    assert!(!error.published);
    assert_eq!(fs::read(&file).unwrap(), b"BBBBBBBB");
    assert!(!root.join("destination/file").exists());
    drop((source, destination, recovery, stage));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn metadata_walk_reads_no_bytes_and_sees_size_changes() {
    use bycoda_physical_store_admission::guarded_snapshot::{
        same_metadata, snapshot_child, snapshot_child_metadata,
    };
    let root = fixture();
    let file = root.join("source/file");
    fs::write(&file, b"AAAAAAAA").unwrap();
    let source = open(&root, "source");
    let full = snapshot_child(&source, OsStr::new("file")).unwrap();
    let light = snapshot_child_metadata(&source, OsStr::new("file")).unwrap();
    assert!(full[0].data.len() == 32 && light[0].data.is_empty());
    assert!(same_metadata(&full, &light));
    fs::write(&file, b"AAAAAAAAA").unwrap();
    let grown = snapshot_child_metadata(&source, OsStr::new("file")).unwrap();
    assert!(!same_metadata(&full, &grown));
    drop(source);
    fs::remove_dir_all(root).unwrap();
}

fn move_leftovers(dir: &std::path::Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".bycoda-move-"))
        .collect()
}

#[test]
fn failed_path_move_discards_staged_copy_and_private_directories() {
    // Occupied destination: the copy is staged, then publication fails and the
    // source is restored, so the staged copy must not stay on disk.
    let root = fixture();
    let from = root.join("source/tree");
    let to = root.join("destination/tree");
    fs::create_dir(&from).unwrap();
    fs::write(from.join("file"), b"payload").unwrap();
    fs::create_dir(&to).unwrap();
    fs::write(to.join("existing"), b"keep").unwrap();
    let error =
        bycoda_physical_store_admission::guarded_move_paths::move_paths(&from, &to).unwrap_err();
    assert!(error.to_string().contains("Source restored."));
    assert!(error.to_string().contains("Staged copy removed."));
    assert_eq!(fs::read(from.join("file")).unwrap(), b"payload");
    assert_eq!(fs::read(to.join("existing")).unwrap(), b"keep");
    assert!(!to.join("file").exists());
    assert!(move_leftovers(&root.join("source")).is_empty());
    assert!(move_leftovers(&root.join("destination")).is_empty());
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
