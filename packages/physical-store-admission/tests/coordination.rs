#![cfg(any(windows, unix))]

use bycoda_physical_store_admission::{
    BusyResource, ClosingFence, Error, PhysicalFileId, Registry,
};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex, MutexGuard, PoisonError,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// Fixtures run one at a time. A child spawned by `Peer` briefly inherits every
/// descriptor of this process between fork and exec, and Unix lock ownership
/// follows the open file description, so a concurrent test's lock released in
/// that window would stay held. `Command::spawn` returns only after exec, so
/// serializing fixtures keeps every release observable immediately.
static SERIAL: Mutex<()> = Mutex::new(());

struct Fixture(PathBuf, #[allow(dead_code)] MutexGuard<'static, ()>);
impl Fixture {
    fn new() -> Self {
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "bycoda-physical-admission-test-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use std::os::unix::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        builder.create(&path).unwrap();
        fs::write(path.join("store.db"), b"not a SQLite attestation").unwrap();
        Self(path, serial)
    }
    fn database(&self) -> PathBuf {
        self.0.join("store.db")
    }
    fn root(&self) -> PathBuf {
        self.0.join("locks")
    }
    fn registry(&self) -> Registry {
        Registry::open(&self.root()).unwrap()
    }
    fn file(&self) -> File {
        File::open(self.database()).unwrap()
    }
    fn namespace(&self) -> PathBuf {
        fs::read_dir(self.root())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.is_dir())
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this uniquely created fixture subtree, after its handles drop.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn waiting(fence: ClosingFence) -> ClosingFence {
    let error = fence.try_upgrade().unwrap_err();
    assert!(matches!(error.error(), Error::Busy(BusyResource::Writers)));
    error.into_parts().1
}

#[test]
fn shared_writers_drain_only_after_every_original_handle_is_dropped() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let store = registry.bind(fixture.file()).unwrap();
    let other = registry.bind(fixture.file()).unwrap();
    let first = store.try_writer().unwrap();
    let second = other.try_writer().unwrap();
    let fence = waiting(other.try_begin_close().unwrap());
    assert!(matches!(
        store.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(first);
    let fence = waiting(fence);
    drop(store);
    drop(registry);
    assert_eq!(second.identity(), other.identity());
    drop(second);
    let closed = fence.try_upgrade().unwrap();
    assert_eq!(closed.identity(), other.identity());
    assert!(matches!(
        other.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    assert!(matches!(
        other.try_begin_close(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(closed);
    drop(other.try_writer().unwrap());
}

#[test]
fn hardlink_aliases_in_different_directories_share_the_physical_namespace() {
    let fixture = Fixture::new();
    let alias_dir = fixture.0.join("another-directory");
    fs::create_dir(&alias_dir).unwrap();
    let alias = alias_dir.join("different-name.db");
    fs::hard_link(fixture.database(), &alias).unwrap();
    let registry = fixture.registry();
    let original = registry.bind(fixture.file()).unwrap();
    let aliased = registry.bind(File::open(alias).unwrap()).unwrap();
    assert_eq!(original.identity(), aliased.identity());
    let (inspected, links) = PhysicalFileId::inspect(&fixture.file()).unwrap();
    assert_eq!(&inspected, original.identity());
    assert_eq!(links, 2);
    assert_eq!(inspected.to_string(), inspected.native_format());
    #[cfg(windows)]
    {
        let parts = inspected.native_format().split(':').collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "windows-file");
        assert_eq!(parts[1].len(), 16);
        assert_eq!(parts[2].len(), 32);
        assert!(parts[2]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = fixture.file().metadata().unwrap();
        assert_eq!(
            inspected.native_format(),
            format!("unix-file:{}:{}", metadata.dev(), metadata.ino())
        );
    }
    assert_eq!(fs::read_dir(fixture.root()).unwrap().count(), 1);
    let writer = original.try_writer().unwrap();
    let error = aliased
        .try_begin_close()
        .unwrap()
        .try_upgrade()
        .unwrap_err();
    assert!(matches!(
        original.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(writer);
    let closed = error.into_parts().1.try_upgrade().unwrap();
    assert!(matches!(
        aliased.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(closed);
    drop(aliased.try_writer().unwrap());
}

#[test]
fn dropping_only_a_closing_fence_reopens_ingress_without_releasing_old_writers() {
    let fixture = Fixture::new();
    let store = fixture.registry().bind(fixture.file()).unwrap();
    let first = store.try_writer().unwrap();
    let closing = waiting(store.try_begin_close().unwrap());
    drop(closing);
    let second = store.try_writer().unwrap();
    let closing = waiting(store.try_begin_close().unwrap());
    drop(second);
    let closing = waiting(closing);
    drop(first);
    drop(closing.try_upgrade().unwrap());
    drop(store.try_writer().unwrap());
}

#[test]
fn dropping_failed_upgrade_does_not_release_another_owners_writer() {
    let fixture = Fixture::new();
    let store = fixture.registry().bind(fixture.file()).unwrap();
    let writer = store.try_writer().unwrap();
    let failure = store.try_begin_close().unwrap().try_upgrade().unwrap_err();
    drop(failure);
    let closing = waiting(store.try_begin_close().unwrap());
    drop(writer);
    drop(closing.try_upgrade().unwrap());
}

#[test]
fn replacing_a_path_does_not_change_the_identity_of_the_retained_actual_file() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let original = registry.bind(fixture.file()).unwrap();
    fs::rename(fixture.database(), fixture.0.join("retained-original.db")).unwrap();
    fs::write(
        fixture.database(),
        b"different physical file at same pathname",
    )
    .unwrap();
    let replacement = registry.bind(fixture.file()).unwrap();
    assert_ne!(original.identity(), replacement.identity());
    let old_writer = original.try_writer().unwrap();
    let closing = waiting(original.try_begin_close().unwrap());
    drop(replacement.try_writer().unwrap());
    drop(old_writer);
    drop(closing.try_upgrade().unwrap());
}

#[test]
fn corrupt_sidecars_are_not_truncated_or_accepted() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let store = registry.bind(fixture.file()).unwrap();
    let path = fixture.namespace().join("writers.lock");
    fs::write(&path, b"original corrupt bytes").unwrap();
    assert!(matches!(store.try_writer(), Err(Error::Unsafe(_))));
    assert!(matches!(
        registry.bind(fixture.file()),
        Err(Error::Unsafe(_))
    ));
    assert_eq!(fs::read(path).unwrap(), b"original corrupt bytes");
}

#[test]
fn an_error_after_closing_still_returns_the_actual_ingress_fence() {
    let fixture = Fixture::new();
    let store = fixture.registry().bind(fixture.file()).unwrap();
    let closing = store.try_begin_close().unwrap();
    let namespace = fixture.namespace();
    fs::hard_link(
        namespace.join("writers.lock"),
        fixture.0.join("unsafe-sidecar-alias"),
    )
    .unwrap();
    let failure = closing.try_upgrade().unwrap_err();
    assert!(matches!(failure.error(), Error::Unsafe(_)));
    let raw = OpenOptions::new()
        .read(true)
        .write(true)
        .open(namespace.join("turnstile.lock"))
        .unwrap();
    assert!(matches!(raw.try_lock(), Err(TryLockError::WouldBlock)));
    let (_, closing) = failure.into_parts();
    assert!(matches!(raw.try_lock(), Err(TryLockError::WouldBlock)));
    drop(closing);
    raw.try_lock().unwrap();
    drop(raw);
}

#[test]
fn an_incomplete_existing_namespace_is_not_silently_repaired() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let store = registry.bind(fixture.file()).unwrap();
    let namespace = fixture.namespace();
    drop(store);
    fs::remove_file(namespace.join("writers.lock")).unwrap();
    assert!(matches!(
        registry.bind(fixture.file()),
        Err(Error::Io { .. })
    ));
    assert!(!namespace.join("writers.lock").exists());
}

#[test]
fn non_regular_roots_and_physical_files_are_refused_before_admission() {
    let fixture = Fixture::new();
    assert!(matches!(
        Registry::open(&fixture.database()),
        Err(Error::Unsafe(_))
    ));
    assert!(matches!(
        Registry::open(&fixture.0.join("missing/parent/locks")),
        Err(Error::Io { .. })
    ));
    let mut directory = OpenOptions::new();
    directory.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
        directory.custom_flags(FILE_FLAG_BACKUP_SEMANTICS);
    }
    let file = directory.open(&fixture.0).unwrap();
    assert!(matches!(
        fixture.registry().bind(file),
        Err(Error::Unsafe(_))
    ));
}

#[cfg(unix)]
#[test]
fn symbolic_roots_and_sidecars_and_non_private_directories_are_refused() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let alias = fixture.0.join("linked-root");
    symlink(fixture.root(), &alias).unwrap();
    assert!(matches!(Registry::open(&alias), Err(Error::Unsafe(_))));
    let store = registry.bind(fixture.file()).unwrap();
    let namespace = fixture.namespace();
    fs::remove_file(namespace.join("writers.lock")).unwrap();
    symlink(fixture.database(), namespace.join("writers.lock")).unwrap();
    assert!(store.try_writer().is_err());
    assert!(registry.bind(fixture.file()).is_err());
    let insecure = fixture.0.join("insecure");
    fs::create_dir(&insecure).unwrap();
    fs::set_permissions(&insecure, fs::Permissions::from_mode(0o777)).unwrap();
    assert!(matches!(Registry::open(&insecure), Err(Error::Unsafe(_))));
}

struct Peer {
    child: Child,
    input: ChildStdin,
    lines: mpsc::Receiver<String>,
}

impl Peer {
    fn new(fixture: &Fixture, database: &Path, mode: &str) -> Self {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "subprocess_peer",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("BYCODA_PHYSICAL_TEST_ROOT", fixture.root())
            .env("BYCODA_PHYSICAL_TEST_FILE", database)
            .env("BYCODA_PHYSICAL_TEST_MODE", mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (send, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                if let Some(index) = line.find("@physical:") {
                    if send
                        .send(line[index + "@physical:".len()..].trim().to_owned())
                        .is_err()
                    {
                        break;
                    }
                }
            }
        });
        Self {
            child,
            input,
            lines,
        }
    }
    fn expect(&self, expected: &str) {
        assert_eq!(
            self.lines.recv_timeout(Duration::from_secs(10)).unwrap(),
            expected
        );
    }
    fn send(&mut self, command: &str) {
        writeln!(self.input, "{command}").unwrap();
        self.input.flush().unwrap();
    }
    fn exited(&mut self) -> std::process::ExitStatus {
        let until = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(Instant::now() < until, "owned child did not exit");
            std::thread::yield_now();
        }
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let until = Instant::now() + Duration::from_secs(10);
            while self.child.try_wait().ok().flatten().is_none() && Instant::now() < until {
                std::thread::yield_now();
            }
        }
    }
}

fn emit(message: &str) {
    println!("@physical:{message}");
    std::io::stdout().flush().unwrap();
}

/// This actual child test only activates with an explicit private fixture env.
#[test]
fn subprocess_peer() {
    let Some(mode) = std::env::var_os("BYCODA_PHYSICAL_TEST_MODE") else {
        return;
    };
    let root = PathBuf::from(std::env::var_os("BYCODA_PHYSICAL_TEST_ROOT").unwrap());
    let file = File::open(std::env::var_os("BYCODA_PHYSICAL_TEST_FILE").unwrap()).unwrap();
    let store = Registry::open(&root).unwrap().bind(file).unwrap();
    let (send, commands) = mpsc::channel();
    std::thread::spawn(move || {
        for command in std::io::stdin().lock().lines() {
            let Ok(command) = command else { break };
            if send.send(command).is_err() {
                break;
            }
        }
    });
    let receive = || commands.recv_timeout(Duration::from_secs(15)).unwrap();
    if mode.to_str() == Some("writer") {
        let writer = store.try_writer().unwrap();
        emit("writer-ready");
        assert_eq!(receive(), "finish");
        drop(writer);
        emit("done");
    } else if mode.to_str() == Some("closer") {
        let closing = store.try_begin_close().unwrap();
        emit("closing");
        assert_eq!(receive(), "try");
        let closing = waiting(closing);
        emit("writers-live");
        assert_eq!(receive(), "try");
        let closed = closing.try_upgrade().unwrap();
        emit("closed");
        assert_eq!(receive(), "finish");
        drop(closed);
        emit("done");
    } else {
        panic!("unknown explicit child mode");
    }
}

#[test]
fn a_real_child_writer_blocks_drain_even_through_a_hardlink_alias() {
    let fixture = Fixture::new();
    let store = fixture.registry().bind(fixture.file()).unwrap();
    let alias = fixture.0.join("child-alias.db");
    fs::hard_link(fixture.database(), &alias).unwrap();
    let mut peer = Peer::new(&fixture, &alias, "writer");
    peer.expect("writer-ready");
    let closing = waiting(store.try_begin_close().unwrap());
    assert!(matches!(
        store.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    peer.send("finish");
    peer.expect("done");
    assert!(peer.exited().success());
    drop(closing.try_upgrade().unwrap());
    drop(store.try_writer().unwrap());
}

#[test]
fn a_real_child_closer_refuses_new_ingress_until_the_original_writer_finishes() {
    let fixture = Fixture::new();
    let store = fixture.registry().bind(fixture.file()).unwrap();
    let writer = store.try_writer().unwrap();
    let mut peer = Peer::new(&fixture, &fixture.database(), "closer");
    peer.expect("closing");
    assert!(matches!(
        store.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    peer.send("try");
    peer.expect("writers-live");
    assert!(matches!(
        store.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    drop(writer);
    peer.send("try");
    peer.expect("closed");
    assert!(matches!(
        store.try_writer(),
        Err(Error::Busy(BusyResource::Ingress))
    ));
    peer.send("finish");
    peer.expect("done");
    assert!(peer.exited().success());
    drop(store.try_writer().unwrap());
}

#[test]
fn actual_process_exit_releases_only_the_childs_writer_reservation() {
    let fixture = Fixture::new();
    let store = fixture.registry().bind(fixture.file()).unwrap();
    let original = store.try_writer().unwrap();
    let mut peer = Peer::new(&fixture, &fixture.database(), "writer");
    peer.expect("writer-ready");
    let closing = waiting(store.try_begin_close().unwrap());
    peer.child.kill().unwrap();
    assert!(!peer.exited().success());
    let closing = waiting(closing);
    drop(original);
    drop(closing.try_upgrade().unwrap());
}
