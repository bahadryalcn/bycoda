use super::windows::write_all;
use super::*;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::{
    ffi::OsStrExt,
    io::{AsHandle, AsRawHandle, FromRawHandle, OwnedHandle},
    process::CommandExt,
};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use windows_sys::Win32::{
    Foundation::{
        GetHandleInformation, LocalFree, GENERIC_READ, GENERIC_WRITE, HANDLE_FLAG_INHERIT,
        INVALID_HANDLE_VALUE,
    },
    Security::{
        Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT},
        GetAce, GetLengthSid, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE,
        DACL_SECURITY_INFORMATION, SE_DACL_PROTECTED,
    },
    Storage::FileSystem::{CreateFileW, FILE_FLAG_OVERLAPPED, OPEN_EXISTING},
};

fn budget() -> PipeBudget {
    PipeBudget::new(Duration::from_secs(5), PipeCancellation::default()).unwrap()
}
fn pair() -> (AuthorityPipeConnection, AuthorityPipeConnection) {
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let connector = std::thread::spawn(move || {
        AuthorityPipeConnection::connect(
            &address,
            &NativePeerExpectation::current_process().unwrap(),
            &budget(),
        )
        .unwrap()
    });
    let server = listener
        .accept(
            &NativePeerExpectation::current_process().unwrap(),
            &budget(),
        )
        .unwrap();
    (server, connector.join().unwrap())
}
fn cancel_when_pending(budget: &PipeBudget) -> std::thread::JoinHandle<()> {
    let probe = budget.pending_probe.clone();
    let cancellation = budget.cancellation.clone();
    std::thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(3);
        while probe.load(Ordering::Acquire) == 0 {
            assert!(
                Instant::now() < until,
                "fixture never submitted overlapped I/O"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        cancellation.cancel();
    })
}

#[test]
fn endpoint_has_protected_current_sid_only_dacl_and_noninheritable_handle() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let mut flags = 0;
    assert_ne!(
        unsafe { GetHandleInformation(listener.handle.as_raw_handle(), &mut flags) },
        0
    );
    assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
    let mut acl = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    assert_eq!(
        unsafe {
            GetSecurityInfo(
                listener.handle.as_raw_handle(),
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut acl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        },
        0
    );
    assert!(!acl.is_null());
    assert!(!descriptor.is_null());
    let mut control = 0;
    let mut revision = 0;
    assert_ne!(
        unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) },
        0
    );
    assert_ne!(control & SE_DACL_PROTECTED, 0);
    assert_eq!(unsafe { (*acl).AceCount }, 1);
    let mut ace = std::ptr::null_mut();
    assert_ne!(unsafe { GetAce(acl, 0, &mut ace) }, 0);
    let ace = ace.cast::<ACCESS_ALLOWED_ACE>();
    assert_eq!(unsafe { (*ace).Header.AceType }, 0);
    let sid = unsafe { std::ptr::addr_of_mut!((*ace).SidStart).cast() };
    let length = unsafe { GetLengthSid(sid) } as usize;
    assert_eq!(
        unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), length) },
        crate::native_authority_peer::current_user_sid().unwrap()
    );
    unsafe {
        LocalFree(descriptor);
    }
}

#[test]
fn addresses_are_random_local_only_and_existing_instance_cannot_be_rebound() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let other = AuthorityPipeListener::bind().unwrap();
    assert_ne!(listener.address().as_str(), other.address().as_str());
    assert!(matches!(
        windows::bind(listener.address()),
        Err(PipeError::Unavailable)
    ));
    for value in [
        r"\\server\pipe\bycoda-authority-v1-00000000000000000000000000000000",
        r"\\.\pipe\bycoda-relaunch-x",
        r"\\.\pipe\bycoda-authority-v1-../x",
        r"\\.\pipe\bycoda-authority-v1-00000000000000000000000000000000\x",
    ] {
        assert!(matches!(
            AuthorityPipeAddress::parse_local(value),
            Err(PipeError::InvalidAddress)
        ));
    }
    assert!(PipeBudget::new(Duration::ZERO, PipeCancellation::default()).is_err());
    assert!(PipeBudget::new(Duration::from_secs(31), PipeCancellation::default()).is_err());
}

#[test]
fn duplex_json_frames_and_fragmented_headers_bodies_are_exact() {
    let (mut server, mut client) = pair();
    let original = serde_json::json!({"message":"界😀", "value":[1,null,true]});
    client.send_json(&original, &budget()).unwrap();
    assert_eq!(server.read_json(&budget()).unwrap(), original);
    server
        .send_json(&serde_json::json!({"reply":true}), &budget())
        .unwrap();
    assert_eq!(
        client.read_json(&budget()).unwrap(),
        serde_json::json!({"reply":true})
    );
    let raw = serde_json::to_vec(&original).unwrap();
    let writer = std::thread::spawn(move || {
        let handle = client.handle.as_ref().unwrap().as_handle();
        for byte in (raw.len() as u32).to_le_bytes().into_iter().chain(raw) {
            write_all(handle, &[byte], &budget()).unwrap();
        }
        client
    });
    assert_eq!(server.read_json(&budget()).unwrap(), original);
    drop(writer.join().unwrap());
}

#[test]
fn oversized_or_malformed_headers_and_json_close_the_connection() {
    for raw in [
        (u32::MAX).to_le_bytes().to_vec(),
        0u32.to_le_bytes().to_vec(),
        [1u32.to_le_bytes().as_slice(), b"{"].concat(),
    ] {
        let (mut server, client) = pair();
        write_all(client.handle.as_ref().unwrap().as_handle(), &raw, &budget()).unwrap();
        let result = server.read_json(&budget());
        assert!(matches!(
            result,
            Err(PipeError::FrameTooLarge | PipeError::Malformed)
        ));
        assert!(server.handle.is_none() && server.peer.is_none());
        assert_eq!(server.read_json(&budget()), Err(PipeError::Closed));
    }
    let (mut server, mut client) = pair();
    let too_big = Value::String("x".repeat(MAX_CONTROL_FRAME));
    assert_eq!(
        client.send_json(&too_big, &budget()),
        Err(PipeError::FrameTooLarge)
    );
    assert!(client.handle.is_none());
    assert!(server.read_json(&budget()).is_err());
}

#[test]
fn truncated_frame_does_not_keep_its_connection_or_partial_payload() {
    let (mut server, mut client) = pair();
    let handle = client.handle.as_ref().unwrap().as_handle();
    write_all(handle, &20u32.to_le_bytes(), &budget()).unwrap();
    write_all(handle, b"{", &budget()).unwrap();
    client.close();
    assert_eq!(server.read_json(&budget()), Err(PipeError::Truncated));
    assert!(server.handle.is_none());
}

#[test]
fn actual_pending_read_cancellation_drains_before_return_and_closes() {
    let (mut server, _client) = pair();
    let budget = budget();
    let cancel = cancel_when_pending(&budget);
    assert_eq!(server.read_json(&budget), Err(PipeError::Cancelled));
    cancel.join().unwrap();
    assert_eq!(budget.pending_probe.load(Ordering::Acquire), 0);
    assert!(server.handle.is_none() && server.peer.is_none());
}

#[test]
fn independent_pipe_budgets_do_not_observe_or_cancel_another_pending_read() {
    let (mut first, _first_client) = pair();
    let first_budget = budget();
    let first_probe = first_budget.pending_probe.clone();
    let first_cancel = first_budget.cancellation.clone();
    let first_reader = std::thread::spawn(move || first.read_json(&first_budget));
    let until = Instant::now() + Duration::from_secs(3);
    while first_probe.load(Ordering::Acquire) == 0 {
        assert!(Instant::now() < until, "first owned read was never pending");
        std::thread::sleep(Duration::from_millis(1));
    }
    let (mut second, _second_client) = pair();
    let second_budget = budget();
    assert_eq!(second_budget.pending_probe.load(Ordering::Acquire), 0);
    assert!(!second_budget.cancellation.0.load(Ordering::Acquire));
    let cancel_second = cancel_when_pending(&second_budget);
    assert_eq!(second.read_json(&second_budget), Err(PipeError::Cancelled));
    cancel_second.join().unwrap();
    assert_eq!(second_budget.pending_probe.load(Ordering::Acquire), 0);
    assert_eq!(first_probe.load(Ordering::Acquire), 1);
    assert!(!first_cancel.0.load(Ordering::Acquire));
    first_cancel.cancel();
    assert_eq!(first_reader.join().unwrap(), Err(PipeError::Cancelled));
    assert_eq!(first_probe.load(Ordering::Acquire), 0);
}

#[test]
fn pending_read_and_accept_deadlines_settle_and_release_the_instance() {
    let (mut server, _client) = pair();
    let read_budget =
        PipeBudget::new(Duration::from_millis(40), PipeCancellation::default()).unwrap();
    assert_eq!(server.read_json(&read_budget), Err(PipeError::Deadline));
    assert_eq!(read_budget.pending_probe.load(Ordering::Acquire), 0);
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let accept_budget =
        PipeBudget::new(Duration::from_millis(40), PipeCancellation::default()).unwrap();
    assert!(matches!(
        listener.accept(
            &NativePeerExpectation::current_process().unwrap(),
            &accept_budget
        ),
        Err(PipeError::Deadline)
    ));
    assert_eq!(accept_budget.pending_probe.load(Ordering::Acquire), 0);
    assert!(windows::bind(address).is_ok());
}

struct TestChild {
    child: Child,
    messages: Receiver<String>,
    reader: Option<std::thread::JoinHandle<()>>,
}
impl TestChild {
    fn spawn(address: &AuthorityPipeAddress) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "native_authority_pipe::tests::hidden_pipe_child",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("BYCODA_AUTHORITY_PIPE_TEST_ADDRESS", address.as_str())
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
                let _ = send.send(line);
            }
        });
        Self {
            child,
            messages,
            reader: Some(reader),
        }
    }
    fn ready(&self) {
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            if self
                .messages
                .recv_timeout(until.saturating_duration_since(Instant::now()))
                .unwrap()
                .contains("PIPE_TEST_READY")
            {
                return;
            }
        }
    }
    fn expected(&self) -> NativePeerExpectation {
        NativePeerExpectation::for_owned_child(&self.child, &std::env::current_exe().unwrap())
            .unwrap()
    }
}
impl Drop for TestChild {
    fn drop(&mut self) {
        self.child.stdin.take();
        let until = Instant::now() + Duration::from_secs(3);
        while self.child.try_wait().unwrap().is_none() {
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
#[test]
#[ignore = "owned hidden fixture entry, invoked only by parent tests"]
fn hidden_pipe_child() {
    let Ok(address) = std::env::var("BYCODA_AUTHORITY_PIPE_TEST_ADDRESS") else {
        return;
    };
    AuthorityPipeAddress::parse_local(&address).unwrap();
    let name: Vec<u16> = std::ffi::OsStr::new(&address)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let raw = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(raw, INVALID_HANDLE_VALUE);
    let _handle = unsafe { OwnedHandle::from_raw_handle(raw) };
    println!("PIPE_TEST_READY");
    std::io::stdout().flush().unwrap();
    std::io::stdin().read_to_end(&mut Vec::new()).unwrap();
}

#[test]
fn actual_hidden_child_peer_and_stalled_write_cancellation_are_kernel_verified() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let child = TestChild::spawn(&listener.address());
    let mut server = listener.accept(&child.expected(), &budget()).unwrap();
    child.ready();
    let budget = budget();
    let cancel = cancel_when_pending(&budget);
    let value = Value::String("x".repeat(MAX_CONTROL_FRAME - 2));
    assert_eq!(server.send_json(&value, &budget), Err(PipeError::Cancelled));
    cancel.join().unwrap();
    assert_eq!(budget.pending_probe.load(Ordering::Acquire), 0);
    assert!(server.handle.is_none() && server.peer.is_none());
}

#[test]
fn wrong_actual_child_is_rejected_and_failed_accept_does_not_reopen() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let child = TestChild::spawn(&address);
    assert!(matches!(
        listener.accept(
            &NativePeerExpectation::current_process().unwrap(),
            &budget()
        ),
        Err(PipeError::Peer(NativePeerError::ProcessMismatch))
    ));
    child.ready();
    assert!(matches!(
        AuthorityPipeConnection::connect(
            &address,
            &NativePeerExpectation::current_process().unwrap(),
            &PipeBudget::new(Duration::from_millis(40), PipeCancellation::default()).unwrap()
        ),
        Err(PipeError::Deadline)
    ));
}

#[test]
fn closed_same_process_connection_is_not_automatically_reconnected_or_replayed() {
    let (mut server, mut client) = pair();
    server.close();
    client.close();
    assert_eq!(
        client.send_json(&serde_json::json!({"request":1}), &budget()),
        Err(PipeError::Closed)
    );
    assert!(client.handle.is_none());
}

#[test]
fn native_image_connect_is_separate_from_the_unchanged_exact_process_expectation() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let connector = std::thread::spawn(move || {
        AuthorityPipeConnection::connect_current_native_image(&address, &budget()).unwrap()
    });
    let mut server = listener
        .accept(
            &NativePeerExpectation::current_process().unwrap(),
            &budget(),
        )
        .unwrap();
    let mut client = connector.join().unwrap();
    client
        .send_json(&serde_json::json!({"native":"image-only"}), &budget())
        .unwrap();
    assert_eq!(
        server.read_json(&budget()).unwrap(),
        serde_json::json!({"native":"image-only"})
    );
    client.close();
    assert!(client
        .send_json(&serde_json::Value::Null, &budget())
        .is_err());
}

#[test]
fn native_image_accept_uses_the_actual_owned_child_peer_and_consumes_one_listener() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let child = TestChild::spawn(&address);
    let mut connection = listener.accept_current_native_image(&budget()).unwrap();
    child.ready();
    connection.close();
    let short = PipeBudget::new(Duration::from_millis(40), PipeCancellation::default()).unwrap();
    assert!(matches!(
        AuthorityPipeConnection::connect_current_native_image(&address, &short),
        Err(PipeError::Deadline)
    ));
}

#[test]
fn native_image_accept_rejects_actual_different_image_client_and_never_reaccepts() {
    let listener = AuthorityPipeListener::bind().unwrap();
    let address = listener.address();
    let name = address.as_str().strip_prefix(r"\\.\pipe\").unwrap();
    let script = format!("$p=[System.IO.Pipes.NamedPipeClientStream]::new('.', '{name}',[System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::Asynchronous); try {{ $p.Connect(5000); [Console]::Out.WriteLine('connected'); [Console]::In.ReadLine() | Out-Null }} finally {{ $p.Dispose() }}");
    let root = std::env::var_os("SystemRoot").unwrap();
    let executable =
        std::path::PathBuf::from(&root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let child = Command::new(executable)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .env_clear()
        .env("SystemRoot", &root)
        .env("WINDIR", &root)
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    struct OwnedClient(Child);
    impl Drop for OwnedClient {
        fn drop(&mut self) {
            self.0.stdin.take();
            let until = Instant::now() + Duration::from_secs(3);
            while self.0.try_wait().unwrap().is_none() {
                if Instant::now() >= until {
                    let _ = self.0.kill();
                    self.0.wait().unwrap();
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
    let _client = OwnedClient(child);
    assert!(matches!(
        listener.accept_current_native_image(&budget()),
        Err(PipeError::Peer(
            crate::native_authority_peer::NativePeerError::ImageMismatch
        ))
    ));
    let short = PipeBudget::new(Duration::from_millis(40), PipeCancellation::default()).unwrap();
    assert!(matches!(
        AuthorityPipeConnection::connect_current_native_image(&address, &short),
        Err(PipeError::Deadline)
    ));
}
