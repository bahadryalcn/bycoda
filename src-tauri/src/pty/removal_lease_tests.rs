use super::*;

#[test]
fn desktop_removal_lease_refuses_existing_pty_and_fences_new_spawns() {
    use crate::worktree_lifecycle::{release_desktop_removal_lease, reserve_spawn};
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target");
    let child = target.join("child");
    std::fs::create_dir_all(&child).unwrap();
    let host = PtyHost::new();
    let agents = crate::harness::HarnessHost::new();
    let lease_id = uuid::Uuid::new_v4().to_string();
    let acquire = |ttl| {
        acquire_desktop_removal_lease(
            &host,
            &agents,
            &crate::native_workspace::editor_buffers::EditorBuffers::default(),
            &target,
            "desktop".into(),
            lease_id.clone(),
            ttl,
        )
    };
    #[cfg(windows)]
    let pair = portable_pty::native_pty_system()
        .openpty(portable_pty::PtySize::default())
        .unwrap();
    host.insert(
        "existing".into(),
        Arc::new(LivePty {
            _jump_config: None,
            _http_proxy: None,
            ssh_identity: None,
            shell_integration: None,
            cwd: child.clone(),
            completion_shell: None,
            writer: Mutex::new(Box::new(std::io::sink())),
            #[cfg(unix)]
            master_fd: std::fs::File::open("/dev/null").unwrap(),
            #[cfg(unix)]
            child: None,
            #[cfg(windows)]
            master: Mutex::new(pair.master),
            pid: 0,
            owner: Arc::new(Mutex::new("main".into())),
            output: Arc::default(),
        }),
    );
    assert!(acquire(Duration::from_secs(30)).is_err());
    host.sessions.lock().unwrap().remove("existing");
    acquire(Duration::from_secs(30)).unwrap();
    assert!(reserve_spawn(&child).is_err());
    assert!(reserve_spawn(root.path()).is_ok());
    release_desktop_removal_lease("other", &lease_id);
    assert!(reserve_spawn(&child).is_err());
    release_desktop_removal_lease("desktop", &lease_id);
    assert!(reserve_spawn(&child).is_ok());
    acquire(Duration::ZERO).unwrap();
    assert!(reserve_spawn(&child).is_ok());
}

fn buffer(path: &str, dirty: bool) -> crate::native_workspace::BufferState {
    serde_json::from_value(serde_json::json!({ "path": path, "dirty": dirty })).unwrap()
}

#[test]
fn desktop_removal_lease_refuses_dirty_editors_under_path_only() {
    use crate::native_workspace::editor_buffers::EditorBuffers;
    use crate::worktree_lifecycle::{release_desktop_removal_lease, reserve_spawn};
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("Editor worktree with long name");
    std::fs::create_dir_all(&target).unwrap();
    let sibling = format!("{}-sibling/a.ts", target.display());
    #[cfg(windows)]
    let reported = short_path(&target);
    #[cfg(not(windows))]
    let reported = target.clone();
    let inside = reported.join("src/a.ts").to_string_lossy().into_owned();
    let host = PtyHost::new();
    let agents = crate::harness::HarnessHost::new();
    let editors = EditorBuffers::default();
    let lease_id = uuid::Uuid::new_v4().to_string();
    let acquire = || {
        acquire_desktop_removal_lease(
            &host,
            &agents,
            &editors,
            &target,
            "desktop".into(),
            lease_id.clone(),
            Duration::from_secs(30),
        )
    };
    // No window reported: granted.
    acquire().unwrap();
    release_desktop_removal_lease("desktop", &lease_id);
    // Clean buffer under the path and dirty buffers outside it: granted.
    editors.report("main", &[buffer(&inside, false), buffer(&sibling, true)]);
    acquire().unwrap();
    release_desktop_removal_lease("desktop", &lease_id);
    // Dirty buffer under the path: refused with the stable code, no lease left behind.
    editors.report("main", &[buffer(&inside, true)]);
    let err = acquire().unwrap_err();
    assert!(err.starts_with("editors:"), "{err}");
    assert!(reserve_spawn(&target).is_ok());
}

#[cfg(windows)]
fn short_path(path: &std::path::Path) -> std::path::PathBuf {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

    // NTFS with 8.3 naming disabled returns the long spelling. On volumes that
    // support it, exercise the real alias of the parent of a not-yet-created file.
    let long: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let size = unsafe { GetShortPathNameW(long.as_ptr(), std::ptr::null_mut(), 0) };
    assert!(size > 0, "{}", std::io::Error::last_os_error());
    let mut short = vec![0; size as usize];
    let written = unsafe { GetShortPathNameW(long.as_ptr(), short.as_mut_ptr(), size) };
    assert!(written > 0 && written < size);
    OsString::from_wide(&short[..written as usize]).into()
}
