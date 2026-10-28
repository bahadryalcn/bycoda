//! Actual private source endpoint lifetime. Association is explicitly unqualified:
//! image matching/identity observations do not grant actor, writer or migration
//! authority. No quiesce/fence/apply/provider-stop operation is installed.
#![allow(dead_code)] // Native startup/observations are composed separately; no authority port.

use crate::native_authority_channel::{CapturedSourceBinding, ChannelError, NativeCapturedSource};
use crate::native_authority_pipe::{
    AuthorityPipeConnection, AuthorityPipeListener, PipeBudget, PipeCancellation, PipeError,
};
use crate::session_store::authority::{SourceSnapshot, WRITER_PROTOCOL};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const MAX_ENDPOINTS: usize = 4;
const MAX_REQUEST_ID: u64 = 9_007_199_254_740_991;
const RETAINED_CHUNK_BYTES: usize = 16 * 1024;
const MAX_RETAINED_BYTES: usize = 32 * 1024 * 1024;
const MAX_RETAINED_EXPORTS: usize = 2;
type Worker = Box<dyn FnOnce() -> SourceExit + Send + 'static>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceError {
    Unsupported,
    InvalidOptions,
    Binding(ChannelError),
    Capacity,
    StateUnavailable,
    Bind(PipeError),
    Spawn,
    WorkerPanicked,
}
impl std::fmt::Display for SourceError {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "NATIVE_AUTHORITY_SOURCE_{self:?}")
    }
}
impl std::error::Error for SourceError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceExit {
    Cancelled,
    Deadline,
    PeerClosed,
    PeerRejected,
    PipeFailure,
    Malformed,
    WrongRegistration,
    WrongEnvironment,
    WrongEpoch,
    InvalidRequestId,
    BindingChanged,
    RetainedUnavailable,
    RetainedCapacity,
    InvalidExport,
    InvalidOffset,
}

pub(crate) struct SourceEndpointOptions {
    pub(crate) io_timeout: Duration,
}
impl Default for SourceEndpointOptions {
    fn default() -> Self {
        Self {
            io_timeout: Duration::from_secs(30),
        }
    }
}

/// Cloneable locators only, never a source/actor qualification proof.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceEndpointDescriptor {
    address: String,
    registration_nonce: String,
}
impl SourceEndpointDescriptor {
    pub(crate) fn address(&self) -> &str {
        &self.address
    }
    pub(crate) fn registration_nonce(&self) -> &str {
        &self.registration_nonce
    }
}

fn endpoints() -> &'static Mutex<HashSet<uuid::Uuid>> {
    static ENDPOINTS: OnceLock<Mutex<HashSet<uuid::Uuid>>> = OnceLock::new();
    ENDPOINTS.get_or_init(|| Mutex::new(HashSet::new()))
}
struct EndpointPermit {
    instance: uuid::Uuid,
}
impl EndpointPermit {
    fn reserve(instance: uuid::Uuid) -> Result<Self, SourceError> {
        let mut active = endpoints()
            .lock()
            .map_err(|_| SourceError::StateUnavailable)?;
        if active.len() >= MAX_ENDPOINTS || !active.insert(instance) {
            return Err(SourceError::Capacity);
        }
        Ok(Self { instance })
    }
}
impl Drop for EndpointPermit {
    fn drop(&mut self) {
        if let Ok(mut active) = endpoints().lock() {
            active.remove(&self.instance);
        }
    }
}

// Two fixed 32 MiB source-byte reservations, not a bound on total process heap.
fn retained_exports() -> &'static Mutex<HashSet<uuid::Uuid>> {
    static EXPORTS: OnceLock<Mutex<HashSet<uuid::Uuid>>> = OnceLock::new();
    EXPORTS.get_or_init(|| Mutex::new(HashSet::new()))
}
struct RetainedPermit(uuid::Uuid);
impl RetainedPermit {
    fn reserve() -> Result<Self, SourceExit> {
        let mut exports = retained_exports()
            .lock()
            .map_err(|_| SourceExit::RetainedUnavailable)?;
        if exports.len() >= MAX_RETAINED_EXPORTS {
            return Err(SourceExit::RetainedCapacity);
        }
        let id = uuid::Uuid::new_v4();
        if !exports.insert(id) {
            return Err(SourceExit::RetainedCapacity);
        }
        Ok(Self(id))
    }
}
impl Drop for RetainedPermit {
    fn drop(&mut self) {
        if let Ok(mut exports) = retained_exports().lock() {
            exports.remove(&self.0);
        }
    }
}
struct RetainedExport {
    snapshot: SourceSnapshot,
    permit: RetainedPermit,
    next_offset: usize,
    deadline: Instant,
}

fn source_budget(
    timeout: Duration,
    cancellation: &PipeCancellation,
    deadline: Option<Instant>,
) -> Result<PipeBudget, SourceExit> {
    let remaining = match deadline {
        Some(deadline) => deadline
            .checked_duration_since(Instant::now())
            .ok_or(SourceExit::Deadline)?
            .min(timeout),
        None => timeout,
    };
    if remaining.is_zero() {
        return Err(SourceExit::Deadline);
    }
    PipeBudget::new(remaining, cancellation.clone()).map_err(|_| SourceExit::PipeFailure)
}

pub(crate) struct SourceEndpointObservation {
    pub(crate) qualified: bool,
    pub(crate) thread_finished: bool,
    pub(crate) joined: bool,
    pub(crate) active_endpoints: usize,
}

/// One actual listener/worker. Explicit shutdown is required when app-managed:
/// the retained managed binding can itself hold an AppHandle/manager reference.
pub(crate) struct SourceEndpoint {
    descriptor: SourceEndpointDescriptor,
    source_epoch: String,
    shutdown: PipeCancellation,
    worker: Option<JoinHandle<SourceExit>>,
    permit: Option<EndpointPermit>,
    outcome: Option<SourceExit>,
}
impl SourceEndpoint {
    /// Supply a fresh endpoint-local cancellation flag. A parent shuts down
    /// independent sources through their owners, not by reusing one local flag.
    pub(crate) fn start(
        binding: CapturedSourceBinding,
        shutdown: PipeCancellation,
        options: SourceEndpointOptions,
    ) -> Result<Self, SourceError> {
        Self::start_using(binding, shutdown, options, |_, work| {
            std::thread::Builder::new()
                .name("native-source-endpoint".into())
                .spawn(work)
        })
    }

    fn start_using(
        binding: CapturedSourceBinding,
        shutdown: PipeCancellation,
        options: SourceEndpointOptions,
        spawn: impl FnOnce(&SourceEndpointDescriptor, Worker) -> std::io::Result<JoinHandle<SourceExit>>,
    ) -> Result<Self, SourceError> {
        PipeBudget::new(options.io_timeout, shutdown.clone())
            .map_err(|_| SourceError::InvalidOptions)?;
        let expected = binding.checked_source().map_err(SourceError::Binding)?;
        let permit = EndpointPermit::reserve(expected.native_instance_id)?;
        let listener = AuthorityPipeListener::bind().map_err(SourceError::Bind)?;
        let descriptor = SourceEndpointDescriptor {
            address: listener.address().as_str().into(),
            registration_nonce: uuid::Uuid::new_v4().to_string(),
        };
        let nonce = descriptor.registration_nonce.clone();
        let epoch = uuid::Uuid::new_v4().to_string();
        let worker_epoch = epoch.clone();
        let cancellation = shutdown.clone();
        let worker = spawn(
            &descriptor,
            Box::new(move || {
                serve(
                    binding,
                    expected,
                    listener,
                    nonce,
                    worker_epoch,
                    cancellation,
                    options.io_timeout,
                )
            }),
        )
        .map_err(|_| SourceError::Spawn)?;
        Ok(Self {
            descriptor,
            source_epoch: epoch,
            shutdown,
            worker: Some(worker),
            permit: Some(permit),
            outcome: None,
        })
    }

    pub(crate) fn descriptor(&self) -> SourceEndpointDescriptor {
        self.descriptor.clone()
    }

    pub(crate) fn source_epoch(&self) -> &str {
        &self.source_epoch
    }

    pub(crate) fn observation(&self) -> Result<SourceEndpointObservation, SourceError> {
        let active = endpoints()
            .lock()
            .map_err(|_| SourceError::StateUnavailable)?
            .len();
        Ok(SourceEndpointObservation {
            qualified: false,
            thread_finished: self
                .worker
                .as_ref()
                .is_none_or(|worker| worker.is_finished()),
            joined: self.worker.is_none(),
            active_endpoints: active,
        })
    }

    pub(crate) fn shutdown(&mut self) -> Result<SourceExit, SourceError> {
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| !worker.is_finished())
        {
            self.shutdown.cancel();
        }
        self.join_worker()
    }

    pub(crate) fn join(mut self) -> Result<SourceExit, SourceError> {
        self.join_worker()
    }

    fn join_worker(&mut self) -> Result<SourceExit, SourceError> {
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            // Join, not cancellation/a claimed exit, releases source admission.
            self.permit.take();
            self.outcome = Some(result.map_err(|_| SourceError::WorkerPanicked)?);
        }
        self.outcome.ok_or(SourceError::WorkerPanicked)
    }
}
impl Drop for SourceEndpoint {
    fn drop(&mut self) {
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| !worker.is_finished())
        {
            self.shutdown.cancel();
        }
        let _ = self.join_worker();
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
enum SourceRequest {
    #[serde(rename = "source-hello")]
    Hello {
        version: u8,
        registration_nonce: String,
        environment_id: String,
    },
    #[serde(rename = "source-status")]
    Status {
        version: u8,
        request_id: u64,
        source_epoch: String,
    },
    #[serde(rename = "source-retained-open")]
    RetainedOpen {
        version: u8,
        request_id: u64,
        source_epoch: String,
        session_id: String,
        migration_id: String,
    },
    #[serde(rename = "source-retained-chunk")]
    RetainedChunk {
        version: u8,
        request_id: u64,
        source_epoch: String,
        export_id: String,
        offset: u64,
    },
    #[serde(rename = "source-retained-close")]
    RetainedClose {
        version: u8,
        request_id: u64,
        source_epoch: String,
        export_id: String,
    },
}
impl SourceRequest {
    fn sequence(&self) -> Option<(u8, u64, &str)> {
        match self {
            Self::Status {
                version,
                request_id,
                source_epoch,
            }
            | Self::RetainedOpen {
                version,
                request_id,
                source_epoch,
                ..
            }
            | Self::RetainedChunk {
                version,
                request_id,
                source_epoch,
                ..
            }
            | Self::RetainedClose {
                version,
                request_id,
                source_epoch,
                ..
            } => Some((*version, *request_id, source_epoch)),
            Self::Hello { .. } => None,
        }
    }
}

fn serve(
    binding: CapturedSourceBinding,
    expected: NativeCapturedSource,
    listener: AuthorityPipeListener,
    nonce: String,
    epoch: String,
    cancellation: PipeCancellation,
    timeout: Duration,
) -> SourceExit {
    // Kept outside the connection closure: failed I/O drops the connection first,
    // then the retained bytes/permit, before the actual worker settles.
    let mut retained: Option<RetainedExport> = None;
    let mut opening: Option<(RetainedPermit, Instant)> = None;
    let result = (|| -> Result<(), SourceExit> {
        check_binding(&binding, &expected)?;
        let mut connection = listener
            .accept_current_native_image(&source_budget(timeout, &cancellation, None)?)
            .map_err(pipe_exit)?;
        check_binding(&binding, &expected)?;
        let request = read_request(
            &mut connection,
            &source_budget(timeout, &cancellation, None)?,
        )?;
        match request {
            SourceRequest::Hello {
                version: 1,
                registration_nonce,
                environment_id,
            } => {
                if registration_nonce != nonce {
                    return Err(SourceExit::WrongRegistration);
                }
                if environment_id != expected.environment_id {
                    return Err(SourceExit::WrongEnvironment);
                }
            }
            _ => return Err(SourceExit::Malformed),
        }
        let source = check_binding(&binding, &expected)?;
        let mut response = identity_response(&source, &epoch, "source-hello-result");
        response["registrationNonce"] = json!(nonce);
        connection
            .send_json(&response, &source_budget(timeout, &cancellation, None)?)
            .map_err(pipe_exit)?;
        check_binding(&binding, &expected)?;
        let mut last_id = 0;
        loop {
            check_binding(&binding, &expected)?;
            let request = read_request(
                &mut connection,
                &source_budget(
                    timeout,
                    &cancellation,
                    retained.as_ref().map(|export| export.deadline),
                )?,
            )?;
            let (version, request_id, source_epoch) =
                request.sequence().ok_or(SourceExit::Malformed)?;
            if version != 1 {
                return Err(SourceExit::Malformed);
            }
            if request_id == 0 || request_id > MAX_REQUEST_ID || request_id <= last_id {
                return Err(SourceExit::InvalidRequestId);
            }
            if source_epoch != epoch {
                return Err(SourceExit::WrongEpoch);
            }
            last_id = request_id;
            let source = check_binding(&binding, &expected)?;
            let mut retire = false;
            let mut retire_absent = false;
            let response = match request {
                SourceRequest::Status { .. } => {
                    let mut response = identity_response(&source, &epoch, "source-status-result");
                    response["requestId"] = json!(request_id);
                    response
                }
                SourceRequest::RetainedOpen {
                    session_id,
                    migration_id,
                    ..
                } => {
                    if retained.is_some() {
                        return Err(SourceExit::RetainedCapacity);
                    }
                    let deadline = Instant::now() + timeout;
                    // Reserve the complete allowance before any SQL allocation.
                    opening = Some((RetainedPermit::reserve()?, deadline));
                    let snapshot = binding
                        .read_retained_snapshot(&session_id, &migration_id)
                        .map_err(|_| SourceExit::RetainedUnavailable)?;
                    check_binding(&binding, &expected)?;
                    if Instant::now() >= deadline {
                        return Err(SourceExit::Deadline);
                    }
                    match snapshot {
                        None => {
                            retire_absent = true;
                            json!({"version":1,"kind":"source-retained-open-result","requestId":request_id,
                                "sourceEpoch":epoch,"sessionId":session_id,"migrationId":migration_id,"state":"absent","qualified":false})
                        }
                        Some(snapshot) => {
                            let total = snapshot.snapshot_json.len();
                            if total == 0 || total > MAX_RETAINED_BYTES {
                                return Err(SourceExit::RetainedUnavailable);
                            }
                            let (permit, _) =
                                opening.take().ok_or(SourceExit::RetainedUnavailable)?;
                            let response = json!({"version":1,"kind":"source-retained-open-result","requestId":request_id,
                                "sourceEpoch":epoch,"sessionId":session_id,"migrationId":migration_id,"state":"retained",
                                "exportId":permit.0.to_string(),"fence":snapshot.fence,"totalBytes":total,
                                "chunkBytes":RETAINED_CHUNK_BYTES,"qualified":false});
                            retained = Some(RetainedExport {
                                snapshot,
                                permit,
                                next_offset: 0,
                                deadline,
                            });
                            response
                        }
                    }
                }
                SourceRequest::RetainedChunk {
                    export_id, offset, ..
                } => {
                    let export = retained.as_mut().ok_or(SourceExit::InvalidExport)?;
                    if export_id != export.permit.0.to_string() {
                        return Err(SourceExit::InvalidExport);
                    }
                    let bytes = export.snapshot.snapshot_json.as_bytes();
                    if offset != export.next_offset as u64 || export.next_offset >= bytes.len() {
                        return Err(SourceExit::InvalidOffset);
                    }
                    let end = (export.next_offset + RETAINED_CHUNK_BYTES).min(bytes.len());
                    let data = base64::engine::general_purpose::STANDARD
                        .encode(&bytes[export.next_offset..end]);
                    export.next_offset = end;
                    json!({"version":1,"kind":"source-retained-chunk-result","requestId":request_id,"sourceEpoch":epoch,
                        "exportId":export_id,"offset":offset,"data":data,"eof":end==bytes.len(),"qualified":false})
                }
                SourceRequest::RetainedClose { export_id, .. } => {
                    let export = retained.as_ref().ok_or(SourceExit::InvalidExport)?;
                    if export_id != export.permit.0.to_string() {
                        return Err(SourceExit::InvalidExport);
                    }
                    retire = true;
                    json!({"version":1,"kind":"source-retained-close-result","requestId":request_id,"sourceEpoch":epoch,
                        "exportId":export_id,"retired":true,"qualified":false})
                }
                SourceRequest::Hello { .. } => return Err(SourceExit::Malformed),
            };
            check_binding(&binding, &expected)?;
            connection
                .send_json(
                    &response,
                    &source_budget(
                        timeout,
                        &cancellation,
                        retained
                            .as_ref()
                            .map(|export| export.deadline)
                            .or_else(|| opening.as_ref().map(|(_, deadline)| *deadline)),
                    )?,
                )
                .map_err(pipe_exit)?;
            check_binding(&binding, &expected)?;
            if retire {
                retained.take();
            }
            if retire_absent {
                opening.take();
            }
        }
    })();
    // Every return owns/drops the actual connection before the worker settles.
    result.err().unwrap_or(SourceExit::PeerClosed)
}

fn read_request(
    connection: &mut AuthorityPipeConnection,
    budget: &PipeBudget,
) -> Result<SourceRequest, SourceExit> {
    let value = connection.read_json(budget).map_err(pipe_exit)?;
    serde_json::from_value(value).map_err(|_| SourceExit::Malformed)
}

fn check_binding(
    binding: &CapturedSourceBinding,
    expected: &NativeCapturedSource,
) -> Result<NativeCapturedSource, SourceExit> {
    let actual = binding
        .checked_source()
        .map_err(|_| SourceExit::BindingChanged)?;
    if &actual != expected {
        return Err(SourceExit::BindingChanged);
    }
    Ok(actual)
}

fn identity_response(source: &NativeCapturedSource, epoch: &str, kind: &str) -> Value {
    json!({
        "version":1, "kind":kind, "environmentId":source.environment_id,
        "sourceStoreId":source.identity.source_store_id,
        "sourceProfileId":source.identity.source_profile_id,
        "sourceEpoch":epoch, "writerProtocol":WRITER_PROTOCOL, "qualified":false,
    })
}

fn pipe_exit(error: PipeError) -> SourceExit {
    match error {
        PipeError::Cancelled => SourceExit::Cancelled,
        PipeError::Deadline => SourceExit::Deadline,
        PipeError::Truncated | PipeError::Closed => SourceExit::PeerClosed,
        PipeError::Peer(_) => SourceExit::PeerRejected,
        _ => SourceExit::PipeFailure,
    }
}

#[cfg(test)]
pub(crate) fn test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
}

#[cfg(all(test, windows))]
#[path = "native_authority_source_tests.rs"]
mod tests;
