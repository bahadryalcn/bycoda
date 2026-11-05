use bycoda_physical_store_admission::rename_no_replace_at::rename_no_replace_at;
use cap_std::{ambient_authority, fs::Dir};
use std::{ffi::OsStr, fs, time::{SystemTime, UNIX_EPOCH}};

#[test]
fn handles_refuse_collision_and_paths_are_single_entries() {
    let root = std::env::temp_dir().join(format!("bycoda-rename-at-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(root.join("source")).unwrap();
    fs::create_dir(root.join("target")).unwrap();
    fs::write(root.join("source/a"), b"source").unwrap();
    fs::write(root.join("target/b"), b"existing").unwrap();
    let source = Dir::open_ambient_dir(root.join("source"), ambient_authority()).unwrap();
    let target = Dir::open_ambient_dir(root.join("target"), ambient_authority()).unwrap();
    assert!(rename_no_replace_at(&source, OsStr::new("a"), &target, OsStr::new("b")).is_err());
    assert!(rename_no_replace_at(&source, OsStr::new("../source/a"), &target, OsStr::new("c")).is_err());
    assert_eq!(fs::read(root.join("target/b")).unwrap(), b"existing");
    assert_eq!(fs::read(root.join("source/a")).unwrap(), b"source");
    rename_no_replace_at(&source, OsStr::new("a"), &target, OsStr::new("c")).unwrap();
    assert_eq!(fs::read(root.join("target/c")).unwrap(), b"source");
    drop(source); drop(target);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn captured_parent_handle_survives_namespace_replacement() {
    let root = std::env::temp_dir().join(format!("bycoda-rename-at-swap-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(root.join("source")).unwrap();
    fs::create_dir(root.join("target")).unwrap();
    fs::write(root.join("source/a"), b"real").unwrap();
    let source = Dir::open_ambient_dir(root.join("source"), ambient_authority()).unwrap();
    let target = Dir::open_ambient_dir(root.join("target"), ambient_authority()).unwrap();
    fs::rename(root.join("source"), root.join("original")).unwrap();
    fs::create_dir(root.join("source")).unwrap();
    fs::write(root.join("source/a"), b"replacement").unwrap();
    rename_no_replace_at(&source, OsStr::new("a"), &target, OsStr::new("b")).unwrap();
    assert_eq!(fs::read(root.join("target/b")).unwrap(), b"real");
    assert_eq!(fs::read(root.join("source/a")).unwrap(), b"replacement");
    drop(source); drop(target);
    fs::remove_dir_all(root).unwrap();
}
