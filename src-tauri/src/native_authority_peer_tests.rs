//! Isolated kernel/pipe tests. Children are this test executable, hidden, and
//! wait only on test-owned stdin. No GUI, provider, credentials or profile.
use super::*;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::os::windows::{
    ffi::OsStrExt,
    io::{AsHandle, AsRawHandle, FromRawHandle, OwnedHandle},
};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};
use windows_sys::Win32::{
    Foundation::{ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{
        CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
    },
    System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_NOWAIT,
        PIPE_REJECT_REMOTE_CLIENTS,
    },
};

fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(Some(0))
        .collect()
}
struct Pipe {
    handle: OwnedHandle,
    name: String,
}
impl Pipe {
    fn new() -> Self {
        let name = format!(r"\\.\pipe\bycoda-authority-test-{}", uuid::Uuid::new_v4());
        // Test-only endpoint. Production endpoint DACL/framing is a later slice.
        let raw = unsafe {
            CreateNamedPipeW(
                wide(&name).as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                1024,
                1024,
                0,
                std::ptr::null(),
            )
        };
        assert_ne!(raw, INVALID_HANDLE_VALUE);
        Self {
            handle: unsafe { OwnedHandle::from_raw_handle(raw) },
            name,
        }
    }
    fn connected(&self) {
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            if unsafe { ConnectNamedPipe(self.handle.as_raw_handle(), std::ptr::null_mut()) } != 0
                || std::io::Error::last_os_error().raw_os_error()
                    == Some(ERROR_PIPE_CONNECTED as i32)
            {
                return;
            }
            assert!(
                Instant::now() < until,
                "owned fixture pipe failed to connect"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
struct PeerChild {
    child: Child,
    messages: Receiver<String>,
    reader: Option<std::thread::JoinHandle<()>>,
}
impl PeerChild {
    fn new(pipe: &Pipe) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "native_authority_peer::tests::hidden_pipe_peer_child",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("BYCODA_AUTHORITY_PEER_TEST_PIPE", &pipe.name)
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, messages) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.len() <= 1024 {
                    let _ = send.send(line);
                }
            }
        });
        Self {
            child,
            messages,
            reader: Some(reader),
        }
    }
    fn marker(&self, wanted: &str) {
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            let line = self
                .messages
                .recv_timeout(until.saturating_duration_since(Instant::now()))
                .unwrap();
            if line.contains(wanted) {
                return;
            }
        }
    }
    fn expected(&self) -> NativePeerExpectation {
        NativePeerExpectation::for_owned_child(&self.child, &std::env::current_exe().unwrap())
            .unwrap()
    }
    fn finish(&mut self) {
        self.child.stdin.take();
        let until = Instant::now() + Duration::from_secs(3);
        loop {
            if self.child.try_wait().unwrap().is_some() {
                break;
            }
            if Instant::now() >= until {
                self.child.kill().unwrap();
                self.child.wait().unwrap();
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        if let Some(reader) = self.reader.take() {
            reader.join().unwrap();
        }
    }
}
impl Drop for PeerChild {
    fn drop(&mut self) {
        self.finish();
    }
}

#[test]
#[ignore = "owned hidden child entry, invoked only by parent tests"]
fn hidden_pipe_peer_child() {
    let Ok(name) = std::env::var("BYCODA_AUTHORITY_PEER_TEST_PIPE") else {
        return;
    };
    assert!(name.starts_with(r"\\.\pipe\bycoda-authority-test-"));
    let raw = unsafe {
        CreateFileW(
            wide(&name).as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(raw, INVALID_HANDLE_VALUE);
    let pipe = unsafe { OwnedHandle::from_raw_handle(raw) };
    println!("NATIVE_PEER_READY");
    std::io::stdout().flush().unwrap();
    let mut byte = [0];
    let first = std::io::stdin().read(&mut byte).unwrap();
    drop(pipe);
    if first != 0 {
        println!("NATIVE_PEER_DISCONNECTED");
        std::io::stdout().flush().unwrap();
        std::io::stdin().read_to_end(&mut Vec::new()).unwrap();
    }
}

#[test]
fn actual_owned_hidden_child_is_verified_and_keeps_its_process_handle() {
    let pipe = Pipe::new();
    let child = PeerChild::new(&pipe);
    pipe.connected();
    child.marker("NATIVE_PEER_READY");
    let expected = child.expected();
    let verified = VerifiedNativePeer::client_of(pipe.handle.as_handle(), &expected).unwrap();
    assert_eq!(verified.identity.pid, child.child.id());
    assert!(verified.identity.created > 0);
    assert!(!verified.identity.user.is_empty());
    drop(expected);
    verified.revalidate().unwrap();
}

#[test]
fn real_kernel_peer_cannot_be_replaced_by_another_owned_childs_expectation() {
    let pipe = Pipe::new();
    let first = PeerChild::new(&pipe);
    pipe.connected();
    first.marker("NATIVE_PEER_READY");
    let other_pipe = Pipe::new();
    let other = PeerChild::new(&other_pipe);
    other_pipe.connected();
    other.marker("NATIVE_PEER_READY");
    assert!(matches!(
        VerifiedNativePeer::client_of(pipe.handle.as_handle(), &other.expected()),
        Err(NativePeerError::ProcessMismatch)
    ));
}

#[test]
fn changed_start_image_or_user_expectation_never_becomes_a_capability() {
    let pipe = Pipe::new();
    let child = PeerChild::new(&pipe);
    pipe.connected();
    child.marker("NATIVE_PEER_READY");
    let mut wrong_start = child.expected();
    wrong_start.identity.created += 1;
    assert!(matches!(
        VerifiedNativePeer::client_of(pipe.handle.as_handle(), &wrong_start),
        Err(NativePeerError::StartTimeMismatch)
    ));
    let mut wrong_image = child.expected();
    wrong_image.identity.image.set_file_name("untrusted.exe");
    assert!(matches!(
        VerifiedNativePeer::client_of(pipe.handle.as_handle(), &wrong_image),
        Err(NativePeerError::ImageMismatch)
    ));
    let mut wrong_user = child.expected();
    wrong_user.identity.user[0] ^= 1;
    assert!(matches!(
        VerifiedNativePeer::client_of(pipe.handle.as_handle(), &wrong_user),
        Err(NativePeerError::UserMismatch)
    ));
    assert!(matches!(
        NativePeerExpectation::for_owned_child(
            &child.child,
            &std::env::current_exe()
                .unwrap()
                .with_file_name("absent.exe")
        ),
        Err(NativePeerError::ImageMismatch)
    ));
}

#[test]
fn held_handle_detects_actual_exit_instead_of_reopening_a_reused_pid() {
    let pipe = Pipe::new();
    let mut child = PeerChild::new(&pipe);
    pipe.connected();
    child.marker("NATIVE_PEER_READY");
    let expected = child.expected();
    let verified = VerifiedNativePeer::client_of(pipe.handle.as_handle(), &expected).unwrap();
    child.finish();
    assert!(matches!(
        verified.revalidate(),
        Err(NativePeerError::Exited)
    ));
    assert!(matches!(
        VerifiedNativePeer::client_of(pipe.handle.as_handle(), &expected),
        Err(NativePeerError::Exited)
    ));
}

#[test]
fn a_live_process_does_not_keep_a_reconnected_server_instance_authorized() {
    let pipe = Pipe::new();
    let mut old = PeerChild::new(&pipe);
    pipe.connected();
    old.marker("NATIVE_PEER_READY");
    let verified = VerifiedNativePeer::client_of(pipe.handle.as_handle(), &old.expected()).unwrap();
    old.child.stdin.as_mut().unwrap().write_all(&[1]).unwrap();
    old.marker("NATIVE_PEER_DISCONNECTED");
    assert!(old.child.try_wait().unwrap().is_none());
    unsafe {
        DisconnectNamedPipe(pipe.handle.as_raw_handle());
    }
    let replacement = PeerChild::new(&pipe);
    pipe.connected();
    replacement.marker("NATIVE_PEER_READY");
    assert!(matches!(
        verified.revalidate(),
        Err(NativePeerError::ProcessMismatch)
    ));
    VerifiedNativePeer::client_of(pipe.handle.as_handle(), &replacement.expected())
        .unwrap()
        .revalidate()
        .unwrap();
}

#[test]
fn server_identity_comes_from_an_actual_client_pipe_handle() {
    let pipe = Pipe::new();
    let raw = unsafe {
        CreateFileW(
            wide(&pipe.name).as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(raw, INVALID_HANDLE_VALUE);
    let client = unsafe { OwnedHandle::from_raw_handle(raw) };
    pipe.connected();
    let expected = NativePeerExpectation::current_process().unwrap();
    VerifiedNativePeer::server_of(client.as_handle(), &expected)
        .unwrap()
        .revalidate()
        .unwrap();
    assert!(matches!(
        VerifiedNativePeer::server_of(pipe.handle.as_handle(), &expected),
        Err(NativePeerError::InvalidPipe)
    ));
    assert!(matches!(
        VerifiedNativePeer::client_of(client.as_handle(), &expected),
        Err(NativePeerError::InvalidPipe)
    ));
    // A real non-pipe kernel handle cannot masquerade as a named pipe handle.
    let non_pipe = std::fs::File::open(std::env::current_exe().unwrap()).unwrap();
    assert!(matches!(
        VerifiedNativePeer::server_of(non_pipe.as_handle(), &expected),
        Err(NativePeerError::InvalidPipe)
    ));
    let policy = NativeImagePeerPolicy::current_native_image().unwrap();
    VerifiedNativePeer::server_of_current_image(client.as_handle(), &policy)
        .unwrap()
        .revalidate()
        .unwrap();
    VerifiedNativePeer::client_of_current_image(pipe.handle.as_handle(), &policy)
        .unwrap()
        .revalidate()
        .unwrap();
    assert!(matches!(
        VerifiedNativePeer::client_of_current_image(client.as_handle(), &policy),
        Err(NativePeerError::InvalidPipe)
    ));
    assert!(matches!(
        VerifiedNativePeer::server_of_current_image(pipe.handle.as_handle(), &policy),
        Err(NativePeerError::InvalidPipe)
    ));
    let mut wrong_image = NativeImagePeerPolicy::current_native_image().unwrap();
    wrong_image.image = std::path::PathBuf::from("native-not-this-executable.exe");
    assert!(matches!(
        VerifiedNativePeer::server_of_current_image(client.as_handle(), &wrong_image),
        Err(NativePeerError::ImageMismatch)
    ));
    let mut wrong_user = NativeImagePeerPolicy::current_native_image().unwrap();
    wrong_user.user.push(0);
    assert!(matches!(
        VerifiedNativePeer::server_of_current_image(client.as_handle(), &wrong_user),
        Err(NativePeerError::UserMismatch)
    ));
}
