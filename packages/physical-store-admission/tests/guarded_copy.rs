use bycoda_physical_store_admission::guarded_copy::copy_child_no_follow;
use cap_std::{ambient_authority, fs::Dir};
use std::{ffi::OsStr, fs, path::PathBuf};

// Tests run as parallel threads of one process and macOS clocks tick in
// microseconds, so a pid plus timestamp can give two fixtures the same root.
fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!("guarded-copy-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("source/tree")).unwrap();
    fs::create_dir(root.join("destination")).unwrap();
    root
}

#[test]
fn copies_nested_files_and_rejects_existing_destination() {
    let root = fixture();
    fs::write(root.join("source/tree/file"), b"contents").unwrap();
    let source = Dir::open_ambient_dir(root.join("source"), ambient_authority()).unwrap();
    let destination = Dir::open_ambient_dir(root.join("destination"), ambient_authority()).unwrap();
    copy_child_no_follow(
        &source,
        OsStr::new("tree"),
        &destination,
        OsStr::new("copy"),
    )
    .unwrap();
    assert_eq!(
        fs::read(root.join("destination/copy/file")).unwrap(),
        b"contents"
    );
    assert!(copy_child_no_follow(
        &source,
        OsStr::new("tree"),
        &destination,
        OsStr::new("copy")
    )
    .is_err());
    drop((source, destination));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn copies_link_text_without_reading_external_target() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    fs::write(root.join("outside"), b"private").unwrap();
    symlink(root.join("outside"), root.join("source/tree/link")).unwrap();
    let source = Dir::open_ambient_dir(root.join("source"), ambient_authority()).unwrap();
    let destination = Dir::open_ambient_dir(root.join("destination"), ambient_authority()).unwrap();
    copy_child_no_follow(
        &source,
        OsStr::new("tree"),
        &destination,
        OsStr::new("copy"),
    )
    .unwrap();
    assert!(fs::symlink_metadata(root.join("destination/copy/link"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        fs::read_link(root.join("destination/copy/link")).unwrap(),
        root.join("outside")
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn concurrent_directory_symlink_swap_never_copies_external_tree() {
    use std::{
        os::unix::fs::symlink,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
    };
    let root = fixture();
    fs::create_dir(root.join("outside")).unwrap();
    fs::write(root.join("outside/private"), b"secret").unwrap();
    fs::write(root.join("source/tree/inside"), b"safe").unwrap();
    symlink(root.join("outside"), root.join("source/link")).unwrap();
    let running = Arc::new(AtomicBool::new(true));
    let active = running.clone();
    let source_path = root.join("source");
    let worker = thread::spawn(move || {
        while active.load(Ordering::Relaxed) {
            let _ = fs::rename(source_path.join("tree"), source_path.join("holding"));
            let _ = fs::rename(source_path.join("link"), source_path.join("tree"));
            let _ = fs::rename(source_path.join("tree"), source_path.join("link"));
            let _ = fs::rename(source_path.join("holding"), source_path.join("tree"));
        }
    });
    let source = Dir::open_ambient_dir(root.join("source"), ambient_authority()).unwrap();
    let destination = Dir::open_ambient_dir(root.join("destination"), ambient_authority()).unwrap();
    for number in 0..100 {
        let target = format!("copy-{number}");
        let _ = copy_child_no_follow(
            &source,
            OsStr::new("tree"),
            &destination,
            OsStr::new(&target),
        );
        let copied = root.join("destination").join(target);
        if fs::symlink_metadata(&copied).is_ok_and(|m| m.is_dir()) {
            assert!(!copied.join("private").exists());
        }
    }
    running.store(false, Ordering::Relaxed);
    worker.join().unwrap();
    fs::remove_dir_all(root).unwrap();
}
