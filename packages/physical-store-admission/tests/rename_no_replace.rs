use bycoda_physical_store_admission::rename_no_replace;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn never_replaces_existing_file_or_directory() {
    let root = std::env::temp_dir().join(format!(
        "bycoda-no-replace-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&root).unwrap();
    let source = root.join("source");
    let destination = root.join("destination");
    fs::write(&source, b"source").unwrap();
    fs::write(&destination, b"destination").unwrap();
    assert!(rename_no_replace(&source, &destination).is_err());
    assert_eq!(fs::read(&source).unwrap(), b"source");
    assert_eq!(fs::read(&destination).unwrap(), b"destination");
    fs::remove_file(&destination).unwrap();
    fs::create_dir(&destination).unwrap();
    assert!(rename_no_replace(&source, &destination).is_err());
    assert_eq!(fs::read(&source).unwrap(), b"source");
    fs::remove_dir(&destination).unwrap();
    rename_no_replace(&source, &destination).unwrap();
    assert_eq!(fs::read(&destination).unwrap(), b"source");
    fs::remove_dir_all(root).unwrap();
}
