//! Kernel identity foundation for a future native authority channel.
//!
//! No IPC command, credential grant, writer inventory or migration proof lives
//! here. Expectations come from an actual native-owned child/current process;
//! pipe peer PIDs come only from the kernel. An executable path match is not a
//! signature, release-support or complete-writer qualification policy.
#![allow(dead_code)] // Private authority channel composition is a separate slice.

use std::path::Path;
use std::process::Child;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativePeerError {
    Unsupported,
    KernelIdentityUnavailable,
    InvalidPipe,
    Exited,
    ProcessMismatch,
    StartTimeMismatch,
    ImageMismatch,
    UserMismatch,
}

impl std::fmt::Display for NativePeerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "NATIVE_AUTHORITY_PEER_{self:?}")
    }
}
impl std::error::Error for NativePeerError {}

/// Native primary-token SID for an explicit private endpoint DACL. This is an
/// OS observation only, not an actor grant or executable qualification.
pub(crate) fn current_user_sid() -> Result<Vec<u8>, NativePeerError> {
    #[cfg(windows)]
    {
        windows::current_user_sid()
    }
    #[cfg(not(windows))]
    {
        Err(NativePeerError::Unsupported)
    }
}

/// Native-only expectation, never deserializable from a request or actor DTO.
/// A launcher still owns executable/support qualification before using it.
pub(crate) struct NativePeerExpectation {
    #[cfg(not(windows))]
    _unsupported: std::convert::Infallible,
    #[cfg(windows)]
    process: windows::Process,
    #[cfg(windows)]
    identity: windows::Identity,
}

impl NativePeerExpectation {
    pub(crate) fn current_process() -> Result<Self, NativePeerError> {
        #[cfg(windows)]
        {
            windows::expect_current()
        }
        #[cfg(not(windows))]
        {
            Err(NativePeerError::Unsupported)
        }
    }

    /// The expected image is a launcher-owned path, not a renderer claim. The
    /// owned child handle supplies birth time, PID and user directly from OS.
    pub(crate) fn for_owned_child(
        child: &Child,
        expected_image: &Path,
    ) -> Result<Self, NativePeerError> {
        #[cfg(windows)]
        {
            windows::expect_child(child, expected_image)
        }
        #[cfg(not(windows))]
        {
            let _ = (child, expected_image);
            Err(NativePeerError::Unsupported)
        }
    }
}

/// Native-selected image/user policy for a headless copy of this executable.
/// The peer PID and birth time still come only from the actual kernel pipe end.
/// This is weaker than an owned-child expectation and grants no actor/support
/// qualification. No caller-supplied path, PID, SID or serialized policy exists.
pub(crate) struct NativeImagePeerPolicy {
    #[cfg(windows)]
    image: std::path::PathBuf,
    #[cfg(windows)]
    user: Vec<u8>,
    #[cfg(not(windows))]
    _unsupported: std::convert::Infallible,
}
impl NativeImagePeerPolicy {
    pub(crate) fn current_native_image() -> Result<Self, NativePeerError> {
        #[cfg(windows)]
        {
            windows::expect_current_image()
        }
        #[cfg(not(windows))]
        {
            Err(NativePeerError::Unsupported)
        }
    }
}

/// Capability holds the actual process and pipe handles. It cannot be minted
/// from serialized PID/start/image/user values. Revalidate at each admission;
/// the channel owner separately owns disconnect/revoke and accepted-work policy.
pub(crate) struct VerifiedNativePeer {
    #[cfg(not(windows))]
    _unsupported: std::convert::Infallible,
    #[cfg(windows)]
    process: windows::Process,
    #[cfg(windows)]
    identity: windows::Identity,
    #[cfg(windows)]
    pipe: std::os::windows::io::OwnedHandle,
    #[cfg(windows)]
    side: windows::Side,
}

impl VerifiedNativePeer {
    pub(crate) fn revalidate(&self) -> Result<(), NativePeerError> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsHandle;
            windows::compare(&self.identity, &self.process.identity()?)?;
            if windows::pipe_pid(self.pipe.as_handle(), self.side)? != self.identity.pid {
                return Err(NativePeerError::ProcessMismatch);
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Err(NativePeerError::Unsupported)
        }
    }
}

#[cfg(windows)]
impl VerifiedNativePeer {
    /// Called on a native-owned, connected server pipe handle.
    pub(crate) fn client_of(
        pipe: std::os::windows::io::BorrowedHandle<'_>,
        expected: &NativePeerExpectation,
    ) -> Result<Self, NativePeerError> {
        windows::verify(pipe, windows::Side::Client, expected)
    }

    /// Called on a native-owned, connected client pipe handle.
    pub(crate) fn server_of(
        pipe: std::os::windows::io::BorrowedHandle<'_>,
        expected: &NativePeerExpectation,
    ) -> Result<Self, NativePeerError> {
        windows::verify(pipe, windows::Side::Server, expected)
    }

    /// Distinct image-only policy; never substitutes for strict owned-child or
    /// current-process verification at their existing call sites.
    pub(crate) fn server_of_current_image(
        pipe: std::os::windows::io::BorrowedHandle<'_>,
        expected: &NativeImagePeerPolicy,
    ) -> Result<Self, NativePeerError> {
        windows::verify_current_image(pipe, windows::Side::Server, expected)
    }

    /// A distinct image-only client policy for a connected native server end.
    pub(crate) fn client_of_current_image(
        pipe: std::os::windows::io::BorrowedHandle<'_>,
        expected: &NativeImagePeerPolicy,
    ) -> Result<Self, NativePeerError> {
        windows::verify_current_image(pipe, windows::Side::Client, expected)
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::{AsHandle, AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle};
    use std::path::PathBuf;
    use windows_sys::Win32::{
        Foundation::{
            DuplicateHandle, DUPLICATE_SAME_ACCESS, FILETIME, WAIT_OBJECT_0, WAIT_TIMEOUT,
        },
        Security::{
            GetLengthSid, GetTokenInformation, IsValidSid, TokenUser, TOKEN_QUERY, TOKEN_USER,
        },
        System::{
            Pipes::{
                GetNamedPipeClientProcessId, GetNamedPipeInfo, GetNamedPipeServerProcessId,
                PIPE_SERVER_END,
            },
            Threading::{
                GetCurrentProcess, GetProcessId, GetProcessTimes, OpenProcess, OpenProcessToken,
                QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
                PROCESS_SYNCHRONIZE,
            },
        },
    };

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub(super) struct Identity {
        pub(super) pid: u32,
        pub(super) created: u64,
        pub(super) image: PathBuf,
        pub(super) user: Vec<u8>,
    }
    pub(super) struct Process(OwnedHandle);
    #[derive(Clone, Copy)]
    pub(super) enum Side {
        Client,
        Server,
    }

    fn duplicate(handle: BorrowedHandle<'_>) -> Result<OwnedHandle, NativePeerError> {
        let mut copied = std::ptr::null_mut();
        // Both process references are the current process; the borrowed source
        // remains valid for this call and the returned duplicate is owned.
        let ok = unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                handle.as_raw_handle(),
                GetCurrentProcess(),
                &mut copied,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == 0 || copied.is_null() {
            return Err(NativePeerError::KernelIdentityUnavailable);
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(copied) })
    }

    fn user(process: BorrowedHandle<'_>) -> Result<Vec<u8>, NativePeerError> {
        let mut token = std::ptr::null_mut();
        if unsafe { OpenProcessToken(process.as_raw_handle(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(NativePeerError::KernelIdentityUnavailable);
        }
        let token = unsafe { OwnedHandle::from_raw_handle(token) };
        let mut bytes = 0;
        unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                std::ptr::null_mut(),
                0,
                &mut bytes,
            );
        }
        if bytes < std::mem::size_of::<TOKEN_USER>() as u32 || bytes > 64 * 1024 {
            return Err(NativePeerError::KernelIdentityUnavailable);
        }
        // usize storage guarantees TOKEN_USER pointer alignment, unlike Vec<u8>.
        let mut buffer = vec![0usize; (bytes as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                bytes,
                &mut bytes,
            )
        } == 0
        {
            return Err(NativePeerError::KernelIdentityUnavailable);
        }
        let sid = unsafe { (*(buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid };
        if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
            return Err(NativePeerError::KernelIdentityUnavailable);
        }
        let length = unsafe { GetLengthSid(sid) } as usize;
        if !(8..=68).contains(&length) {
            return Err(NativePeerError::KernelIdentityUnavailable);
        }
        Ok(unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), length) }.to_vec())
    }

    pub(super) fn current_user_sid() -> Result<Vec<u8>, NativePeerError> {
        user(Process::current()?.0.as_handle())
    }

    impl Process {
        fn open(pid: u32) -> Result<Self, NativePeerError> {
            if pid == 0 {
                return Err(NativePeerError::KernelIdentityUnavailable);
            }
            let handle = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    pid,
                )
            };
            if handle.is_null() {
                return Err(NativePeerError::KernelIdentityUnavailable);
            }
            Ok(Self(unsafe { OwnedHandle::from_raw_handle(handle) }))
        }
        fn current() -> Result<Self, NativePeerError> {
            Self::open(std::process::id())
        }
        pub(super) fn identity(&self) -> Result<Identity, NativePeerError> {
            let handle = self.0.as_raw_handle();
            match unsafe { WaitForSingleObject(handle, 0) } {
                WAIT_TIMEOUT => {}
                WAIT_OBJECT_0 => return Err(NativePeerError::Exited),
                _ => return Err(NativePeerError::KernelIdentityUnavailable),
            }
            let pid = unsafe { GetProcessId(handle) };
            if pid == 0 {
                return Err(NativePeerError::KernelIdentityUnavailable);
            }
            let mut created: FILETIME = unsafe { std::mem::zeroed() };
            let mut exited = created;
            let mut kernel = created;
            let mut cpu = created;
            if unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut cpu) }
                == 0
            {
                return Err(NativePeerError::KernelIdentityUnavailable);
            }
            // The Win32 extended path limit is bounded. Do not truncate names.
            let mut image = vec![0u16; 32_768];
            let mut length = image.len() as u32;
            if unsafe { QueryFullProcessImageNameW(handle, 0, image.as_mut_ptr(), &mut length) }
                == 0
                || length == 0
                || length as usize >= image.len()
            {
                return Err(NativePeerError::KernelIdentityUnavailable);
            }
            let image = PathBuf::from(OsString::from_wide(&image[..length as usize]))
                .canonicalize()
                .map_err(|_| NativePeerError::KernelIdentityUnavailable)?;
            let identity = Identity {
                pid,
                created: ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
                image,
                user: user(self.0.as_handle())?,
            };
            // A process can exit during the observations; no such cut qualifies.
            if unsafe { WaitForSingleObject(handle, 0) } != WAIT_TIMEOUT {
                return Err(NativePeerError::Exited);
            }
            Ok(identity)
        }
    }

    pub(super) fn compare(expected: &Identity, actual: &Identity) -> Result<(), NativePeerError> {
        if actual.pid != expected.pid {
            return Err(NativePeerError::ProcessMismatch);
        }
        if actual.created != expected.created {
            return Err(NativePeerError::StartTimeMismatch);
        }
        if actual.image != expected.image {
            return Err(NativePeerError::ImageMismatch);
        }
        if actual.user != expected.user {
            return Err(NativePeerError::UserMismatch);
        }
        Ok(())
    }
    pub(super) fn expect_current() -> Result<NativePeerExpectation, NativePeerError> {
        let process = Process::current()?;
        let identity = process.identity()?;
        Ok(NativePeerExpectation { process, identity })
    }
    pub(super) fn expect_current_image() -> Result<NativeImagePeerPolicy, NativePeerError> {
        let identity = Process::current()?.identity()?;
        Ok(NativeImagePeerPolicy {
            image: identity.image,
            user: identity.user,
        })
    }
    pub(super) fn expect_child(
        child: &Child,
        expected_image: &Path,
    ) -> Result<NativePeerExpectation, NativePeerError> {
        let process = Process(duplicate(child.as_handle())?);
        let identity = process.identity()?;
        if identity.pid != child.id() {
            return Err(NativePeerError::ProcessMismatch);
        }
        if identity.image
            != expected_image
                .canonicalize()
                .map_err(|_| NativePeerError::ImageMismatch)?
        {
            return Err(NativePeerError::ImageMismatch);
        }
        if identity.user != Process::current()?.identity()?.user {
            return Err(NativePeerError::UserMismatch);
        }
        Ok(NativePeerExpectation { process, identity })
    }
    pub(super) fn pipe_pid(pipe: BorrowedHandle<'_>, side: Side) -> Result<u32, NativePeerError> {
        // These PID APIs accept either end. Reject a wrongly selected end so
        // server_of(server_handle) cannot accidentally authenticate ourselves.
        let mut flags = 0;
        if unsafe {
            GetNamedPipeInfo(
                pipe.as_raw_handle(),
                &mut flags,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
            || (flags & PIPE_SERVER_END != 0) != matches!(side, Side::Client)
        {
            return Err(NativePeerError::InvalidPipe);
        }
        let mut pid = 0;
        let ok = unsafe {
            match side {
                Side::Client => GetNamedPipeClientProcessId(pipe.as_raw_handle(), &mut pid),
                Side::Server => GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid),
            }
        };
        if ok == 0 || pid == 0 {
            return Err(NativePeerError::InvalidPipe);
        }
        Ok(pid)
    }
    pub(super) fn verify(
        pipe: BorrowedHandle<'_>,
        side: Side,
        expected: &NativePeerExpectation,
    ) -> Result<VerifiedNativePeer, NativePeerError> {
        compare(&expected.identity, &expected.process.identity()?)?;
        let pipe = duplicate(pipe)?;
        let pid = pipe_pid(pipe.as_handle(), side)?;
        let process = Process::open(pid)?;
        let identity = process.identity()?;
        compare(&expected.identity, &identity)?;
        if identity.user != Process::current()?.identity()?.user {
            return Err(NativePeerError::UserMismatch);
        }
        let verified = VerifiedNativePeer {
            process,
            identity,
            pipe,
            side,
        };
        verified.revalidate()?;
        Ok(verified)
    }

    pub(super) fn verify_current_image(
        pipe: BorrowedHandle<'_>,
        side: Side,
        expected: &NativeImagePeerPolicy,
    ) -> Result<VerifiedNativePeer, NativePeerError> {
        let pipe = duplicate(pipe)?;
        let pid = pipe_pid(pipe.as_handle(), side)?;
        let process = Process::open(pid)?;
        let identity = process.identity()?;
        if identity.image != expected.image {
            return Err(NativePeerError::ImageMismatch);
        }
        if identity.user != expected.user {
            return Err(NativePeerError::UserMismatch);
        }
        let verified = VerifiedNativePeer {
            process,
            identity,
            pipe,
            side,
        };
        verified.revalidate()?;
        Ok(verified)
    }
}

#[cfg(all(test, not(windows)))]
mod unsupported_tests {
    use super::*;
    #[test]
    fn unsupported_platform_never_qualifies_a_process() {
        assert!(matches!(
            NativePeerExpectation::current_process(),
            Err(NativePeerError::Unsupported)
        ));
    }
}

#[cfg(all(test, windows))]
#[path = "native_authority_peer_tests.rs"]
mod tests;
