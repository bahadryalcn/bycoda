//! One-shot, native-only private Windows transport foundation.
//!
//! No public RPC, actor enrollment, challenge, authority decision or grant is
//! installed. An address locates an endpoint; it is never authentication proof.
//! Every connected endpoint checks an actual native-owned peer expectation.
//! Any failed/partial operation closes this connection without replay. Errors
//! never assert that a domain mutation was not admitted or did not complete.
#![allow(dead_code)] // Actor-channel composition is a separate source slice.

#[cfg(windows)]
use crate::native_authority_peer::VerifiedNativePeer;
use crate::native_authority_peer::{NativePeerError, NativePeerExpectation};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

pub(crate) const MAX_CONTROL_FRAME: usize = 64 * 1024;
const PREFIX: &str = r"\\.\pipe\bycoda-authority-v1-";
const MAX_WAIT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PipeError {
    Unsupported,
    InvalidAddress,
    InvalidBudget,
    Unavailable,
    Peer(NativePeerError),
    Deadline,
    Cancelled,
    Closed,
    Truncated,
    Malformed,
    FrameTooLarge,
}
impl std::fmt::Display for PipeError {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "NATIVE_AUTHORITY_PIPE_{self:?}")
    }
}
impl std::error::Error for PipeError {}
impl From<NativePeerError> for PipeError {
    fn from(error: NativePeerError) -> Self {
        Self::Peer(error)
    }
}

#[derive(Clone)]
pub(crate) struct AuthorityPipeAddress(String);
impl AuthorityPipeAddress {
    pub(crate) fn parse_local(value: &str) -> Result<Self, PipeError> {
        let suffix = value
            .strip_prefix(PREFIX)
            .ok_or(PipeError::InvalidAddress)?;
        if suffix.len() != 32
            || !suffix
                .bytes()
                .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
        {
            return Err(PipeError::InvalidAddress);
        }
        Ok(Self(value.into()))
    }
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Default)]
pub(crate) struct PipeCancellation(Arc<AtomicBool>);
impl PipeCancellation {
    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub(crate) fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}
pub(crate) struct PipeBudget {
    deadline: Instant,
    cancellation: PipeCancellation,
    #[cfg(test)]
    pending_probe: Arc<std::sync::atomic::AtomicUsize>,
}
impl PipeBudget {
    pub(crate) fn new(
        timeout: Duration,
        cancellation: PipeCancellation,
    ) -> Result<Self, PipeError> {
        if timeout.is_zero() || timeout > MAX_WAIT {
            return Err(PipeError::InvalidBudget);
        }
        Ok(Self {
            deadline: Instant::now() + timeout,
            cancellation,
            #[cfg(test)]
            pending_probe: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        })
    }
    fn check(&self) -> Result<(), PipeError> {
        if self.cancellation.0.load(Ordering::Acquire) {
            Err(PipeError::Cancelled)
        } else if Instant::now() >= self.deadline {
            Err(PipeError::Deadline)
        } else {
            Ok(())
        }
    }
}

pub(crate) struct AuthorityPipeListener {
    address: AuthorityPipeAddress,
    #[cfg(windows)]
    handle: std::os::windows::io::OwnedHandle,
    #[cfg(not(windows))]
    _unsupported: std::convert::Infallible,
}
impl AuthorityPipeListener {
    pub(crate) fn bind() -> Result<Self, PipeError> {
        #[cfg(windows)]
        {
            windows::bind(AuthorityPipeAddress(format!(
                "{PREFIX}{}",
                uuid::Uuid::new_v4().simple()
            )))
        }
        #[cfg(not(windows))]
        {
            Err(PipeError::Unsupported)
        }
    }
    pub(crate) fn address(&self) -> AuthorityPipeAddress {
        self.address.clone()
    }
    /// Consumes the server instance. No reconnect/reaccept or automatic retries.
    pub(crate) fn accept(
        self,
        expected: &NativePeerExpectation,
        budget: &PipeBudget,
    ) -> Result<AuthorityPipeConnection, PipeError> {
        #[cfg(windows)]
        {
            windows::accept(self, expected, budget)
        }
        #[cfg(not(windows))]
        {
            let _ = (expected, budget);
            Err(PipeError::Unsupported)
        }
    }

    /// Separate image-only client policy for a Node-owned native helper. The
    /// expected image/user come from this executable, never a request or PID.
    /// Consumes this one server instance, including on rejection.
    pub(crate) fn accept_current_native_image(
        self,
        budget: &PipeBudget,
    ) -> Result<AuthorityPipeConnection, PipeError> {
        #[cfg(windows)]
        {
            windows::accept_current_native_image(self, budget)
        }
        #[cfg(not(windows))]
        {
            let _ = budget;
            Err(PipeError::Unsupported)
        }
    }
}

pub(crate) struct AuthorityPipeConnection {
    #[cfg(windows)]
    handle: Option<std::os::windows::io::OwnedHandle>,
    #[cfg(windows)]
    peer: Option<VerifiedNativePeer>,
    #[cfg(not(windows))]
    _unsupported: std::convert::Infallible,
}
impl AuthorityPipeConnection {
    pub(crate) fn connect(
        address: &AuthorityPipeAddress,
        expected: &NativePeerExpectation,
        budget: &PipeBudget,
    ) -> Result<Self, PipeError> {
        #[cfg(windows)]
        {
            windows::connect(address, expected, budget)
        }
        #[cfg(not(windows))]
        {
            let _ = (address, expected, budget);
            Err(PipeError::Unsupported)
        }
    }

    /// Headless helper policy selected only from this native executable image.
    /// No bootstrap/request PID, image or user can select the expected peer.
    pub(crate) fn connect_current_native_image(
        address: &AuthorityPipeAddress,
        budget: &PipeBudget,
    ) -> Result<Self, PipeError> {
        #[cfg(windows)]
        {
            windows::connect_current_native_image(address, budget)
        }
        #[cfg(not(windows))]
        {
            let _ = (address, budget);
            Err(PipeError::Unsupported)
        }
    }
    pub(crate) fn close(&mut self) {
        #[cfg(windows)]
        {
            self.peer.take();
            self.handle.take();
        }
    }
    pub(crate) fn read_json(&mut self, budget: &PipeBudget) -> Result<Value, PipeError> {
        #[cfg(windows)]
        {
            let result = self.read_inner(budget);
            if result.is_err() {
                self.close();
            }
            result
        }
        #[cfg(not(windows))]
        {
            let _ = budget;
            Err(PipeError::Unsupported)
        }
    }
    pub(crate) fn send_json(
        &mut self,
        value: &Value,
        budget: &PipeBudget,
    ) -> Result<(), PipeError> {
        #[cfg(windows)]
        {
            let result = self.send_inner(value, budget);
            if result.is_err() {
                self.close();
            }
            result
        }
        #[cfg(not(windows))]
        {
            let _ = (value, budget);
            Err(PipeError::Unsupported)
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::native_authority_peer::current_user_sid;
    use std::os::windows::{
        ffi::OsStrExt,
        io::{AsHandle, AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle},
    };
    use windows_sys::Win32::{
        Foundation::{
            GetLastError, LocalFree, ERROR_FILE_NOT_FOUND, ERROR_IO_INCOMPLETE, ERROR_IO_PENDING,
            ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE,
            INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
        },
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            SECURITY_ATTRIBUTES,
        },
        Storage::FileSystem::{
            CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
            OPEN_EXISTING, PIPE_ACCESS_DUPLEX, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT,
        },
        System::{
            Pipes::{ConnectNamedPipe, CreateNamedPipeW, PIPE_REJECT_REMOTE_CLIENTS},
            Threading::{CreateEventW, WaitForSingleObject},
            IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED},
        },
    };
    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(Some(0))
            .collect()
    }
    struct LocalMemory(*mut core::ffi::c_void);
    impl Drop for LocalMemory {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    fn descriptor() -> Result<LocalMemory, PipeError> {
        let sid = current_user_sid()?;
        let mut aligned_sid = vec![0usize; sid.len().div_ceil(std::mem::size_of::<usize>())];
        unsafe {
            std::ptr::copy_nonoverlapping(
                sid.as_ptr(),
                aligned_sid.as_mut_ptr().cast::<u8>(),
                sid.len(),
            );
        }
        let mut text = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(aligned_sid.as_mut_ptr().cast(), &mut text) } == 0 {
            return Err(PipeError::Unavailable);
        }
        let _text_owner = LocalMemory(text.cast());
        let mut length = 0;
        while length < 256 && unsafe { *text.add(length) } != 0 {
            length += 1;
        }
        if length == 256 {
            return Err(PipeError::Unavailable);
        }
        let sid_text = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) })
            .map_err(|_| PipeError::Unavailable)?;
        let sddl = wide(&format!("D:P(A;;GA;;;{sid_text})"));
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(PipeError::Unavailable);
        }
        Ok(LocalMemory(descriptor))
    }
    pub(super) fn bind(address: AuthorityPipeAddress) -> Result<AuthorityPipeListener, PipeError> {
        AuthorityPipeAddress::parse_local(address.as_str())?;
        let descriptor = descriptor()?;
        let security = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        let raw = unsafe {
            CreateNamedPipeW(
                wide(address.as_str()).as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_REJECT_REMOTE_CLIENTS,
                1,
                MAX_CONTROL_FRAME as u32,
                MAX_CONTROL_FRAME as u32,
                0,
                &security,
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(PipeError::Unavailable);
        }
        Ok(AuthorityPipeListener {
            address,
            handle: unsafe { OwnedHandle::from_raw_handle(raw) },
        })
    }

    /// Owns a stable OVERLAPPED/event through completion, even on cancellation or
    /// unwinding. Buffers stay in the calling read/write stack until this drops.
    /// Cancellation requests a stop; only actual completion releases memory.
    struct PendingIo<'a> {
        handle: BorrowedHandle<'a>,
        event: OwnedHandle,
        overlapped: Box<OVERLAPPED>,
        pending: bool,
        #[cfg(test)]
        pending_probe: Option<Arc<std::sync::atomic::AtomicUsize>>,
    }
    impl<'a> PendingIo<'a> {
        fn new(handle: BorrowedHandle<'a>) -> Result<Self, PipeError> {
            let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
            if event.is_null() {
                return Err(PipeError::Unavailable);
            }
            let event = unsafe { OwnedHandle::from_raw_handle(event) };
            let mut overlapped = Box::new(unsafe { std::mem::zeroed::<OVERLAPPED>() });
            overlapped.hEvent = event.as_raw_handle();
            Ok(Self {
                handle,
                event,
                overlapped,
                pending: false,
                #[cfg(test)]
                pending_probe: None,
            })
        }
        fn settled(&mut self) {
            self.pending = false;
            #[cfg(test)]
            if let Some(probe) = self.pending_probe.take() {
                probe.fetch_sub(1, Ordering::AcqRel);
            }
        }
        fn drain(&mut self) {
            if self.pending {
                unsafe {
                    CancelIoEx(self.handle.as_raw_handle(), &*self.overlapped);
                    let mut bytes = 0;
                    GetOverlappedResult(
                        self.handle.as_raw_handle(),
                        &*self.overlapped,
                        &mut bytes,
                        1,
                    );
                }
                self.settled();
            }
        }
        fn run(
            &mut self,
            budget: &PipeBudget,
            connect: bool,
            start: impl FnOnce(*mut OVERLAPPED, *mut u32) -> i32,
        ) -> Result<u32, PipeError> {
            budget.check()?;
            let mut bytes = 0;
            self.pending = true;
            let started = start(&mut *self.overlapped, &mut bytes);
            let error = if started == 0 {
                unsafe { GetLastError() }
            } else {
                0
            };
            if started != 0 || (connect && error == ERROR_PIPE_CONNECTED) {
                self.pending = false;
                return Ok(bytes);
            }
            if error != ERROR_IO_PENDING {
                self.pending = false;
                return Err(PipeError::Truncated);
            }
            #[cfg(test)]
            {
                let probe = budget.pending_probe.clone();
                probe.fetch_add(1, Ordering::AcqRel);
                self.pending_probe = Some(probe);
            }
            loop {
                if let Err(error) = budget.check() {
                    self.drain();
                    return Err(error);
                }
                let wait = unsafe { WaitForSingleObject(self.event.as_raw_handle(), 10) };
                if wait == WAIT_TIMEOUT {
                    continue;
                }
                if wait != WAIT_OBJECT_0 {
                    self.drain();
                    return Err(PipeError::Unavailable);
                }
                let ok = unsafe {
                    GetOverlappedResult(
                        self.handle.as_raw_handle(),
                        &*self.overlapped,
                        &mut bytes,
                        0,
                    )
                };
                // Event belongs to this one operation and is signaled only at
                // completion. A failed operation is still settled before drop.
                if ok == 0 && unsafe { GetLastError() } == ERROR_IO_INCOMPLETE {
                    continue;
                }
                self.settled();
                if ok == 0 {
                    return Err(PipeError::Truncated);
                }
                budget.check()?;
                return Ok(bytes);
            }
        }
    }
    impl Drop for PendingIo<'_> {
        fn drop(&mut self) {
            self.drain();
        }
    }

    pub(super) fn accept(
        listener: AuthorityPipeListener,
        expected: &NativePeerExpectation,
        budget: &PipeBudget,
    ) -> Result<AuthorityPipeConnection, PipeError> {
        await_client(&listener, budget)?;
        let peer = VerifiedNativePeer::client_of(listener.handle.as_handle(), expected)?;
        budget.check()?;
        Ok(AuthorityPipeConnection {
            handle: Some(listener.handle),
            peer: Some(peer),
        })
    }

    pub(super) fn accept_current_native_image(
        listener: AuthorityPipeListener,
        budget: &PipeBudget,
    ) -> Result<AuthorityPipeConnection, PipeError> {
        let expected = crate::native_authority_peer::NativeImagePeerPolicy::current_native_image()?;
        await_client(&listener, budget)?;
        let peer =
            VerifiedNativePeer::client_of_current_image(listener.handle.as_handle(), &expected)?;
        budget.check()?;
        Ok(AuthorityPipeConnection {
            handle: Some(listener.handle),
            peer: Some(peer),
        })
    }

    fn await_client(
        listener: &AuthorityPipeListener,
        budget: &PipeBudget,
    ) -> Result<(), PipeError> {
        {
            let mut operation = PendingIo::new(listener.handle.as_handle())?;
            operation.run(budget, true, |overlapped, _| unsafe {
                ConnectNamedPipe(listener.handle.as_raw_handle(), overlapped)
            })?;
        }
        Ok(())
    }
    pub(super) fn connect(
        address: &AuthorityPipeAddress,
        expected: &NativePeerExpectation,
        budget: &PipeBudget,
    ) -> Result<AuthorityPipeConnection, PipeError> {
        let handle = connect_handle(address, budget)?;
        let peer = VerifiedNativePeer::server_of(handle.as_handle(), expected)?;
        budget.check()?;
        Ok(AuthorityPipeConnection {
            handle: Some(handle),
            peer: Some(peer),
        })
    }

    pub(super) fn connect_current_native_image(
        address: &AuthorityPipeAddress,
        budget: &PipeBudget,
    ) -> Result<AuthorityPipeConnection, PipeError> {
        let expected = crate::native_authority_peer::NativeImagePeerPolicy::current_native_image()?;
        let handle = connect_handle(address, budget)?;
        let peer = VerifiedNativePeer::server_of_current_image(handle.as_handle(), &expected)?;
        budget.check()?;
        Ok(AuthorityPipeConnection {
            handle: Some(handle),
            peer: Some(peer),
        })
    }

    fn connect_handle(
        address: &AuthorityPipeAddress,
        budget: &PipeBudget,
    ) -> Result<OwnedHandle, PipeError> {
        AuthorityPipeAddress::parse_local(address.as_str())?;
        let handle = loop {
            budget.check()?;
            let raw = unsafe {
                CreateFileW(
                    wide(address.as_str()).as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                    std::ptr::null_mut(),
                )
            };
            if raw != INVALID_HANDLE_VALUE {
                break unsafe { OwnedHandle::from_raw_handle(raw) };
            }
            let error = unsafe { GetLastError() };
            if error != ERROR_PIPE_BUSY && error != ERROR_FILE_NOT_FOUND {
                return Err(PipeError::Unavailable);
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        budget.check()?;
        Ok(handle)
    }
    pub(super) fn read_exact(
        handle: BorrowedHandle<'_>,
        mut bytes: &mut [u8],
        budget: &PipeBudget,
    ) -> Result<(), PipeError> {
        while !bytes.is_empty() {
            let mut operation = PendingIo::new(handle)?;
            let count = operation.run(budget, false, |overlapped, transferred| unsafe {
                ReadFile(
                    handle.as_raw_handle(),
                    bytes.as_mut_ptr(),
                    bytes.len() as u32,
                    transferred,
                    overlapped,
                )
            })? as usize;
            if count == 0 || count > bytes.len() {
                return Err(PipeError::Truncated);
            }
            bytes = &mut bytes[count..];
        }
        Ok(())
    }
    pub(super) fn write_all(
        handle: BorrowedHandle<'_>,
        mut bytes: &[u8],
        budget: &PipeBudget,
    ) -> Result<(), PipeError> {
        while !bytes.is_empty() {
            let mut operation = PendingIo::new(handle)?;
            let count = operation.run(budget, false, |overlapped, transferred| unsafe {
                WriteFile(
                    handle.as_raw_handle(),
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    transferred,
                    overlapped,
                )
            })? as usize;
            if count == 0 || count > bytes.len() {
                return Err(PipeError::Truncated);
            }
            bytes = &bytes[count..];
        }
        Ok(())
    }
    struct BoundedWriter(Vec<u8>);
    impl std::io::Write for BoundedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > MAX_CONTROL_FRAME.saturating_sub(self.0.len()) {
                return Err(std::io::Error::other("control frame too large"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl AuthorityPipeConnection {
        fn ready(&self, budget: &PipeBudget) -> Result<BorrowedHandle<'_>, PipeError> {
            budget.check()?;
            self.peer.as_ref().ok_or(PipeError::Closed)?.revalidate()?;
            Ok(self.handle.as_ref().ok_or(PipeError::Closed)?.as_handle())
        }
        pub(super) fn read_inner(&mut self, budget: &PipeBudget) -> Result<Value, PipeError> {
            let handle = self.ready(budget)?;
            let mut header = [0u8; 4];
            read_exact(handle, &mut header, budget)?;
            let length = u32::from_le_bytes(header) as usize;
            if length > MAX_CONTROL_FRAME {
                return Err(PipeError::FrameTooLarge);
            }
            if length == 0 {
                return Err(PipeError::Malformed);
            }
            let mut bytes = vec![0; length];
            read_exact(handle, &mut bytes, budget)?;
            let value = serde_json::from_slice(&bytes).map_err(|_| PipeError::Malformed)?;
            self.ready(budget)?;
            Ok(value)
        }
        pub(super) fn send_inner(
            &mut self,
            value: &Value,
            budget: &PipeBudget,
        ) -> Result<(), PipeError> {
            let handle = self.ready(budget)?;
            let mut writer = BoundedWriter(Vec::with_capacity(MAX_CONTROL_FRAME));
            serde_json::to_writer(&mut writer, value).map_err(|_| PipeError::FrameTooLarge)?;
            write_all(handle, &(writer.0.len() as u32).to_le_bytes(), budget)?;
            write_all(handle, &writer.0, budget)?;
            self.ready(budget)?;
            Ok(())
        }
    }
}

#[cfg(all(test, windows))]
#[path = "native_authority_pipe_tests.rs"]
mod tests;

#[cfg(all(test, not(windows)))]
mod unsupported_tests {
    use super::*;
    #[test]
    fn unsupported_never_mints_a_listener() {
        assert!(matches!(
            AuthorityPipeListener::bind(),
            Err(PipeError::Unsupported)
        ));
    }
}
