//! Application lifetime owner for private source association. It never migrates
//! sessions or certifies native writer coverage. Ordinary work remains available
//! when the selected Host/deployment/bootstrap is unavailable.
#![allow(dead_code)]

use crate::native_authority_bootstrap::{Association, HostBootstrap, Lookup};
use crate::native_authority_channel::CapturedSourceBinding;
use crate::native_authority_pipe::PipeCancellation;
use crate::native_authority_source::{SourceEndpoint, SourceEndpointOptions};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::Manager;

struct Shared {
    stop: AtomicBool,
    endpoint: Mutex<Option<PipeCancellation>>,
    wake: (Mutex<()>, Condvar),
}
impl Shared {
    fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
            endpoint: Mutex::new(None),
            wake: (Mutex::new(()), Condvar::new()),
        }
    }
    fn stopping(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }
    fn cancel(&self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(current) = self.endpoint.lock() {
            if let Some(flag) = current.as_ref() {
                flag.cancel();
            }
        }
        self.wake.1.notify_all();
    }
    fn wait(&self, duration: Duration) {
        if let Ok(guard) = self.wake.0.lock() {
            let _ = self
                .wake
                .1
                .wait_timeout_while(guard, duration, |_| !self.stopping());
        }
    }
}

struct NativeAuthorityRuntime {
    shared: Arc<Shared>,
    worker: Mutex<Option<JoinHandle<()>>>,
    checkpoints: Mutex<Option<Arc<crate::native_authority_checkpoint::NativeRendererCheckpoints>>>,
    projection:
        Mutex<Option<Arc<crate::native_projection_coordinator::NativeProjectionCoordinator>>>,
}
impl NativeAuthorityRuntime {
    fn shutdown(&self) {
        self.shared.cancel();
        if let Ok(projection) = self.projection.lock() {
            if let Some(service) = projection.as_ref() {
                service.shutdown();
            }
        }
        if let Ok(checkpoints) = self.checkpoints.lock() {
            if let Some(service) = checkpoints.as_ref() {
                service.shutdown();
            }
        }
        if let Ok(mut slot) = self.worker.lock() {
            if let Some(worker) = slot.take() {
                // A manager can be last released on the already-settled worker's
                // own return path. It cannot join itself; this grants no proof.
                if worker.thread().id() != std::thread::current().id() {
                    let _ = worker.join();
                }
            }
        }
    }
}
impl Drop for NativeAuthorityRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub(crate) fn start(app: &tauri::AppHandle) {
    #[cfg(windows)]
    {
        let shared = Arc::new(Shared::new());
        if !app.manage(NativeAuthorityRuntime {
            shared: shared.clone(),
            worker: Mutex::new(None),
            checkpoints: Mutex::new(None),
            projection: Mutex::new(None),
        }) {
            return;
        }
        let runtime = app.state::<NativeAuthorityRuntime>();
        let Ok(mut worker) = runtime.worker.lock() else {
            return;
        };
        if shared.stopping() {
            return;
        }
        let app = app.clone();
        if let Ok(thread) = std::thread::Builder::new()
            .name("native-authority-association".into())
            .spawn(move || run(app, shared))
        {
            *worker = Some(thread);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    if let Some(runtime) = app.try_state::<NativeAuthorityRuntime>() {
        runtime.shutdown();
    }
}

/// Only the actual selected-profile association installs this service. Merely
/// having a Tauri Window cannot create a renderer checkpoint round/challenge.
pub(crate) fn renderer_checkpoints(
    app: &tauri::AppHandle,
) -> Result<Arc<crate::native_authority_checkpoint::NativeRendererCheckpoints>, String> {
    let runtime = app
        .try_state::<NativeAuthorityRuntime>()
        .ok_or("NATIVE_CHECKPOINT_SOURCE_UNAVAILABLE")?;
    let checkpoints = runtime
        .checkpoints
        .lock()
        .map_err(|_| "NATIVE_CHECKPOINT_SOURCE_UNAVAILABLE")?;
    checkpoints
        .as_ref()
        .cloned()
        .ok_or_else(|| "NATIVE_CHECKPOINT_SOURCE_UNAVAILABLE".into())
}

pub(crate) fn projection_coordinator(
    app: &tauri::AppHandle,
) -> Result<Arc<crate::native_projection_coordinator::NativeProjectionCoordinator>, String> {
    let runtime = app
        .try_state::<NativeAuthorityRuntime>()
        .ok_or("NATIVE_PROJECTION_SOURCE_UNAVAILABLE")?;
    let projection = runtime
        .projection
        .lock()
        .map_err(|_| "NATIVE_PROJECTION_SOURCE_UNAVAILABLE")?;
    projection
        .as_ref()
        .cloned()
        .ok_or_else(|| "NATIVE_PROJECTION_SOURCE_UNAVAILABLE".into())
}

fn run(app: tauri::AppHandle, shared: Arc<Shared>) {
    let mut retry = Duration::from_secs(5);
    while !shared.stopping() {
        let _ = associate(&app, &shared);
        if shared.stopping() {
            break;
        }
        shared.wait(retry);
        retry = (retry * 2).min(Duration::from_secs(60));
    }
}

fn associate(app: &tauri::AppHandle, shared: &Shared) -> Result<(), ()> {
    let base = crate::bundled_host::native_authority_profile().ok_or(())?;
    let host = HostBootstrap::discover(&base).map_err(|_| ())?;
    if !host.description.source_registration_available || shared.stopping() {
        return Err(());
    }
    let binding =
        CapturedSourceBinding::capture_managed_store(app.clone(), &host.description.environment_id)
            .map_err(|_| ())?;
    let expected = binding.checked_source().map_err(|_| ())?;
    let checkpoints = Arc::new(
        crate::native_authority_checkpoint::NativeRendererCheckpoints::capture_managed(
            app,
            &host.description.environment_id,
        )
        .map_err(|_| ())?,
    );
    let projection = Arc::new(
        crate::native_projection_coordinator::NativeProjectionCoordinator::new(
            app.clone(),
            &host.description.environment_id,
            checkpoints.clone(),
        )
        .map_err(|_| ())?,
    );
    {
        let runtime = app.try_state::<NativeAuthorityRuntime>().ok_or(())?;
        let mut current = runtime.checkpoints.lock().map_err(|_| ())?;
        if shared.stopping() {
            return Err(());
        }
        if let Some(previous) = current.replace(checkpoints.clone()) {
            previous.shutdown();
        }
        if let Some(previous) = runtime
            .projection
            .lock()
            .map_err(|_| ())?
            .replace(projection.clone())
        {
            previous.shutdown();
        };
    }
    let _checkpoint_owner = CurrentCheckpoints {
        app: app.clone(),
        service: checkpoints,
        projection: projection.clone(),
    };
    let profile = app.path().app_data_dir().map_err(|_| ())?;
    let deployment = crate::native_authority_deployment::provision(
        &host,
        &app.config().identifier,
        &profile,
        &expected.identity.source_profile_id,
        &shared.stop,
    )
    .map_err(|_| ())?;
    if shared.stopping() {
        return Err(());
    }
    let cancel = PipeCancellation::default();
    {
        let mut current = shared.endpoint.lock().map_err(|_| ())?;
        if shared.stopping() {
            cancel.cancel();
            return Err(());
        }
        *current = Some(cancel.clone());
    }
    // The guard clears only the flag it owns; the current loop never overlaps
    // another endpoint, and cancellation does not release the endpoint permit.
    let clear = CurrentEndpoint { shared };
    let observer = Arc::new(
        move |session: &str, migration: &str, generation: u64, cancellation: &PipeCancellation| {
            projection.observe(session, migration, generation, cancellation)
        },
    );
    let mut endpoint = SourceEndpoint::start_with_projection(
        binding,
        cancel,
        SourceEndpointOptions::default(),
        observer,
    )
    .map_err(|_| ())?;
    let descriptor = endpoint.descriptor();
    let registered = host.register(
        descriptor.address(),
        descriptor.registration_nonce(),
        &deployment,
    );
    let association = match registered {
        Ok(value) => Some(value),
        Err(_) => recover(
            || host.lookup(descriptor.registration_nonce(), &deployment),
            || shared.stopping(),
            || shared.wait(Duration::from_millis(500)),
            Duration::from_secs(15),
        ),
    };
    let result = if let Some(association) = association.as_ref() {
        if association.environment_id != expected.environment_id
            || association.source_store_id != expected.identity.source_store_id
            || association.source_profile_id != expected.identity.source_profile_id
            || association.source_epoch != endpoint.source_epoch()
        {
            Err(())
        } else {
            observe(&host, association, &endpoint, shared)
        }
    } else {
        Err(())
    };
    // Retire the Host-owned transport through its owner. On a stopped/unreachable
    // Host this is not an ACK; closing the native endpoint still fences its epoch.
    if let Some(association) = association.as_ref() {
        let _ = host.unregister(association);
    }
    let _ = endpoint.shutdown();
    drop(clear);
    result
}

struct CurrentEndpoint<'a> {
    shared: &'a Shared,
}

struct CurrentCheckpoints {
    app: tauri::AppHandle,
    service: Arc<crate::native_authority_checkpoint::NativeRendererCheckpoints>,
    projection: Arc<crate::native_projection_coordinator::NativeProjectionCoordinator>,
}
impl Drop for CurrentCheckpoints {
    fn drop(&mut self) {
        self.projection.shutdown();
        self.service.shutdown();
        if let Some(runtime) = self.app.try_state::<NativeAuthorityRuntime>() {
            if let Ok(mut current) = runtime.checkpoints.lock() {
                if current
                    .as_ref()
                    .is_some_and(|service| Arc::ptr_eq(service, &self.service))
                {
                    *current = None;
                }
            }
            if let Ok(mut current) = runtime.projection.lock() {
                if current
                    .as_ref()
                    .is_some_and(|service| Arc::ptr_eq(service, &self.projection))
                {
                    *current = None;
                }
            }
        }
    }
}
impl Drop for CurrentEndpoint<'_> {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.shared.endpoint.lock() {
            *slot = None;
        }
    }
}

fn observe(
    host: &HostBootstrap,
    association: &Association,
    endpoint: &SourceEndpoint,
    shared: &Shared,
) -> Result<(), ()> {
    while !shared.stopping() {
        if endpoint.observation().map_err(|_| ())?.thread_finished {
            return Err(());
        }
        shared.wait(Duration::from_secs(5));
        if shared.stopping() {
            break;
        }
        host.status(association).map_err(|_| ())?;
    }
    Ok(())
}

/// Recovery reads actual accepted registration state. It never re-sends register;
/// absence is not evidence that any source/domain effect was not admitted.
fn recover(
    mut lookup: impl FnMut() -> Result<Lookup, crate::native_authority_bootstrap::BootstrapError>,
    mut stopping: impl FnMut() -> bool,
    mut wait: impl FnMut(),
    budget: Duration,
) -> Option<Association> {
    let deadline = Instant::now() + budget;
    while !stopping() && Instant::now() < deadline {
        match lookup() {
            Ok(Lookup::Associated { association, .. }) => return Some(association),
            Ok(Lookup::Failed { .. }) => return None,
            Ok(Lookup::Pending { .. } | Lookup::Absent { .. }) => {}
            Err(crate::native_authority_bootstrap::BootstrapError::ChangedHost) => return None,
            Err(_) => {}
        }
        wait();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_authority_bootstrap::BootstrapError;
    #[cfg(windows)]
    #[test]
    #[ignore = "owned Node/native source fixture; not a GUI or actor qualification"]
    fn private_source_fixture() {
        use std::io::Write;
        let _serial = crate::native_authority_source::test_lock();
        let base = std::env::temp_dir().canonicalize().unwrap();
        let directory = base.join(format!(
            "bycoda-native-source-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&directory).unwrap();
        let store = Arc::new(
            crate::session_store::SessionStore::open(directory.join("native.db")).unwrap(),
        );
        let environment = std::env::var("BYCODA_NATIVE_SOURCE_FIXTURE_ENVIRONMENT")
            .unwrap_or_else(|_| "native-source-fixture-environment".into());
        let identity = store.authority_identity().unwrap();
        // This explicit isolated qualification is compiled only for the fixture.
        let retained = store
            .authority_test_retained_snapshot_at(
                &environment,
                "fixture-retained-session",
                "fixture-retained-migration",
                &"İstanbul 🦀 𝄞 日本語\n".repeat(4096),
                &crate::fs::path_to_js(&directory),
                true,
            )
            .unwrap();
        let initial_authority =
            serde_json::to_value(store.authority_status("fixture-retained-session").unwrap())
                .unwrap();
        let binding = CapturedSourceBinding::capture(store.clone(), &environment).unwrap();
        let mut endpoint = SourceEndpoint::start(
            binding,
            PipeCancellation::default(),
            SourceEndpointOptions::default(),
        )
        .unwrap();
        let descriptor = endpoint.descriptor();
        {
            let mut output = std::io::stdout().lock();
            writeln!(output, "NATIVE_SOURCE_FIXTURE").unwrap();
            writeln!(output, "{}", serde_json::json!({"version":1,"address":descriptor.address(),
                "registrationNonce":descriptor.registration_nonce(),"sourceEpoch":endpoint.source_epoch(),
                "environmentId":environment,"sourceStoreId":identity.source_store_id,
                "sourceProfileId":identity.source_profile_id,"profileDirectory":crate::fs::path_to_js(&directory),
                "retainedSessionId":"fixture-retained-session","retainedMigrationId":"fixture-retained-migration",
                "retainedBytes":retained.snapshot_json.len(),"retainedDigest":retained.fence.source_digest})).unwrap();
            output.flush().unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline && !endpoint.observation().unwrap().thread_finished {
            std::thread::sleep(Duration::from_millis(10));
        }
        endpoint.shutdown().unwrap();
        drop(endpoint);
        assert_eq!(
            serde_json::to_value(store.authority_status("fixture-retained-session").unwrap())
                .unwrap(),
            initial_authority
        );
        let final_snapshot = store
            .authority_snapshot("fixture-retained-migration")
            .unwrap();
        assert_eq!(final_snapshot.snapshot_json, retained.snapshot_json);
        assert_eq!(final_snapshot.fence, retained.fence);
        drop(store);
        assert_eq!(directory.parent(), Some(base.as_path()));
        assert!(directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("bycoda-native-source-fixture-"));
        std::fs::remove_dir_all(directory).unwrap();
        std::process::exit(0);
    }
    #[test]
    fn lost_registration_ack_recovers_one_actual_association_without_resending() {
        let mut lookups = 0;
        let result = recover(
            || {
                lookups += 1;
                if lookups == 1 {
                    return Ok(Lookup::Pending {
                        version: 1,
                        qualified: false,
                    });
                }
                let association: Association = serde_json::from_value(serde_json::json!({
                "version":1,"associationId":"11111111-1111-4111-8111-111111111111",
                "sourceEpoch":"22222222-2222-4222-8222-222222222222","environmentId":"env",
                "sourceStoreId":"store","sourceProfileId":"profile","writerProtocol":2,"qualified":false
            })).unwrap();
                Ok(Lookup::Associated {
                    version: 1,
                    qualified: false,
                    association,
                })
            },
            || false,
            || {},
            Duration::from_secs(1),
        );
        assert_eq!(lookups, 2);
        assert_eq!(result.unwrap().source_store_id, "store");
    }
    #[test]
    fn failed_or_replaced_host_never_becomes_a_new_registration_attempt() {
        for changed in [true, false] {
            let mut calls = 0;
            let result = recover(
                || {
                    calls += 1;
                    if changed {
                        Err(BootstrapError::ChangedHost)
                    } else {
                        Ok(Lookup::Failed {
                            version: 1,
                            qualified: false,
                        })
                    }
                },
                || false,
                || {},
                Duration::from_secs(1),
            );
            assert!(result.is_none());
            assert_eq!(calls, 1);
        }
    }
    #[test]
    fn shutdown_cancels_wait_and_prevents_recovery_io() {
        let shared = Shared::new();
        shared.cancel();
        let started = Instant::now();
        shared.wait(Duration::from_secs(60));
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(recover(
            || panic!("cancelled owner cannot start another lookup"),
            || shared.stopping(),
            || {},
            Duration::from_secs(1)
        )
        .is_none());
    }
}
