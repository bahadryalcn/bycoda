//! Source-issued control turns and an exact physical-window issuer. Neither a
//! label nor a renderer-supplied UUID can reconstruct the private issuer.
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Resource, ResourceTable, WebviewWindow};

const ISSUER_NAME: &str = "bycoda.control-window-issuer";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlTurnReceipt {
    pub version: u8,
    pub session_id: String,
    pub turn_id: String,
}

impl ControlTurnReceipt {
    pub(super) fn issue(session_id: String) -> Self {
        Self {
            version: 1,
            session_id,
            turn_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        let id = uuid::Uuid::parse_str(&self.turn_id).map_err(|_| "NATIVE_CONTROL_TURN_INVALID")?;
        if self.version != 1
            || self.session_id.is_empty()
            || self.turn_id.len() != 36
            || id.to_string() != self.turn_id
            || id.as_bytes()[6] >> 4 != 4
            || id.as_bytes()[8] & 0xc0 != 0x80
        {
            return Err("NATIVE_CONTROL_TURN_INVALID".into());
        }
        Ok(())
    }
}

/// One ResourceTable belongs to the actual WebviewWindow. Recreating a label
/// gets another table/Arc. Resource closure serializes with local admission;
/// it cannot turn an old capture into the next window's issuer.
#[derive(Default)]
pub(crate) struct WindowIssuer {
    closed: AtomicBool,
    admission: Mutex<()>,
}

impl Resource for WindowIssuer {
    fn name(&self) -> Cow<'_, str> {
        ISSUER_NAME.into()
    }
    fn close(self: Arc<Self>) {
        let _guard = self.admission.lock().unwrap_or_else(|e| e.into_inner());
        self.closed.store(true, Ordering::Release);
    }
}

impl WindowIssuer {
    /// Queries under ControlHost's lock must not invert the issuer→host
    /// admission order. This snapshot grants no new effect admission.
    pub(crate) fn is_live(&self) -> bool {
        !self.closed.load(Ordering::Acquire) && !self.admission.is_poisoned()
    }
    pub(crate) fn with_live<T>(
        &self,
        work: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = self
            .admission
            .lock()
            .map_err(|_| "NATIVE_CONTROL_WINDOW_UNAVAILABLE")?;
        if !self.is_live() {
            return Err("NATIVE_CONTROL_WINDOW_CLOSED".into());
        }
        work()
    }
}

fn issuer(resources: &ResourceTable) -> Option<Arc<WindowIssuer>> {
    let id = resources
        .names()
        .find_map(|(id, name)| (name == ISSUER_NAME).then_some(id))?;
    resources.get(id).ok()
}

pub(crate) fn capture(window: &WebviewWindow) -> Result<Arc<WindowIssuer>, String> {
    let (owner, created) = {
        let mut resources = window.resources_table();
        let created = issuer(&resources).is_none();
        (capture_resources(&mut resources)?, created)
    };
    if created {
        let original = owner.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                Resource::close(original.clone());
            }
        });
    }
    Ok(owner)
}

fn capture_resources(resources: &mut ResourceTable) -> Result<Arc<WindowIssuer>, String> {
    let owner = match issuer(resources) {
        Some(owner) => owner,
        None => {
            let owner = Arc::new(WindowIssuer::default());
            resources.add_arc(owner.clone());
            owner
        }
    };
    owner.with_live(|| Ok(owner.clone()))
}

/// Reload keeps Tauri's resource table; explicitly retire the previous page.
pub(crate) fn page_reloaded(webview: &tauri::Webview) -> Option<Arc<WindowIssuer>> {
    let mut resources = webview.resources_table();
    let id = resources
        .names()
        .find_map(|(id, name)| (name == ISSUER_NAME).then_some(id))?;
    let original = resources.take::<WindowIssuer>(id).ok()?;
    Resource::close(original.clone());
    Some(original)
}

pub(crate) fn existing(window: &WebviewWindow) -> Result<Arc<WindowIssuer>, String> {
    issuer(&window.resources_table()).ok_or_else(|| "NATIVE_CONTROL_WINDOW_UNKNOWN".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::Inner;

    fn activate(
        inner: &mut Inner,
        issuer: &Arc<WindowIssuer>,
        session: &str,
    ) -> ControlTurnReceipt {
        inner
            .install_authorized_turn("same-label", issuer, session.into(), "/repo".into(), true)
            .unwrap()
    }
    #[test]
    fn actual_resource_table_recreation_cannot_reuse_window_issuer() {
        let mut first = ResourceTable::default();
        let mut second = ResourceTable::default();
        let a = capture_resources(&mut first).unwrap();
        assert!(Arc::ptr_eq(&a, &capture_resources(&mut first).unwrap()));
        let b = capture_resources(&mut second).unwrap();
        assert!(!Arc::ptr_eq(&a, &b));
        Resource::close(a.clone());
        assert!(a.with_live(|| Ok(())).is_err());
        assert!(capture_resources(&mut first).is_err());
        assert!(b.with_live(|| Ok(())).is_ok());
    }

    #[test]
    fn delayed_original_finish_cannot_remove_replacement_turn_or_grant() {
        let mut resources = ResourceTable::default();
        let issuer = capture_resources(&mut resources).unwrap();
        let inner = Arc::new(Mutex::new(Inner::default()));
        let a = activate(&mut inner.lock().unwrap(), &issuer, "session");
        let (ready, release) = std::sync::mpsc::channel();
        let callback_inner = inner.clone();
        let callback_issuer = issuer.clone();
        let late = std::thread::spawn(move || {
            release.recv().unwrap();
            callback_issuer.with_live(|| {
                callback_inner
                    .lock()
                    .unwrap()
                    .finish_turn("same-label", &callback_issuer, &a)
            })
        });
        let b = activate(&mut inner.lock().unwrap(), &issuer, "session");
        ready.send(()).unwrap();
        // A's retained original authority can finish after B starts, but the
        // finish is scoped to A and cannot end B's application permission.
        late.join().unwrap().unwrap();
        let mut state = inner.lock().unwrap();
        assert_eq!(state.active["session"].receipt, b);
        assert!(state.active["session"].app_allowed);
        state.finish_turn("same-label", &issuer, &b).unwrap();
        state.finish_turn("same-label", &issuer, &b).unwrap();
    }

    #[test]
    fn same_label_new_physical_window_and_malformed_receipts_have_no_effect() {
        let mut old_resources = ResourceTable::default();
        let mut new_resources = ResourceTable::default();
        let old = capture_resources(&mut old_resources).unwrap();
        let new = capture_resources(&mut new_resources).unwrap();
        let mut inner = Inner::default();
        let a = activate(&mut inner, &old, "session");
        assert!(inner.finish_turn("same-label", &new, &a).is_err());
        assert!(inner.finish_turn("other-label", &old, &a).is_err());
        for malformed in [
            ControlTurnReceipt {
                version: 2,
                ..a.clone()
            },
            ControlTurnReceipt {
                turn_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA".into(),
                ..a.clone()
            },
            ControlTurnReceipt {
                session_id: "other".into(),
                ..a.clone()
            },
        ] {
            assert!(inner.finish_turn("same-label", &old, &malformed).is_err());
        }
        assert_eq!(inner.active["session"].receipt, a);
        assert!(serde_json::from_value::<ControlTurnReceipt>(
            serde_json::json!({"sessionId":"session"})
        )
        .is_err());
        let mut extra = serde_json::to_value(&a).unwrap();
        extra["pid"] = 123.into();
        assert!(serde_json::from_value::<ControlTurnReceipt>(extra).is_err());
        Resource::close(old.clone());
        assert!(old
            .with_live(|| inner.finish_turn("same-label", &old, &a))
            .is_err());
        assert_eq!(inner.active["session"].receipt, a);
    }

    #[test]
    fn known_original_finish_retry_does_not_end_current_turn_or_accept_new_window() {
        let mut resources = ResourceTable::default();
        let mut recreated = ResourceTable::default();
        let issuer = capture_resources(&mut resources).unwrap();
        let other = capture_resources(&mut recreated).unwrap();
        let mut inner = Inner::default();
        let a = activate(&mut inner, &issuer, "session");
        inner.finish_turn("same-label", &issuer, &a).unwrap();
        let b = activate(&mut inner, &issuer, "session");
        inner.finish_turn("same-label", &issuer, &a).unwrap();
        assert_eq!(inner.active["session"].receipt, b);
        assert!(inner.finish_turn("same-label", &other, &a).is_err());
        assert_eq!(inner.active["session"].receipt, b);
        let uncompleted = ControlTurnReceipt::issue("session".into());
        assert!(inner
            .finish_turn("same-label", &issuer, &uncompleted)
            .is_err());
        assert_eq!(inner.turn_writes.completed_count(), 1);
        for _ in 0..512 {
            let completed = activate(&mut inner, &issuer, "another");
            inner
                .finish_turn("same-label", &issuer, &completed)
                .unwrap();
        }
        assert_eq!(inner.turn_writes.completed_count(), 511);
        assert!(inner.finish_turn("same-label", &issuer, &a).is_err());
        assert_eq!(inner.active["session"].receipt, b);
    }

    #[test]
    fn missing_child_receipt_supplies_no_app_grant_and_stale_capture_cannot_spawn() {
        use crate::control::{configure_child_grants, Grant};
        let mut resources = ResourceTable::default();
        let issuer = capture_resources(&mut resources).unwrap();
        let mut inner = Inner::default();
        inner.prepare_app_grant("session", "same-label", "/repo");
        let a = activate(&mut inner, &issuer, "session");
        let source = inner
            .capture_child_source(&issuer, "same-label", "session", "/repo".into(), a.clone())
            .unwrap();
        let mut unbound = std::process::Command::new("unused");
        configure_child_grants(&inner, "loopback", "session", &mut unbound, None);
        assert!(!unbound
            .get_envs()
            .any(|(name, _)| name == "BYCODA_APP_TOKEN" || name == "BYCODA_CONTROL_TOKEN"));
        let mut bound = std::process::Command::new("unused");
        configure_child_grants(&inner, "loopback", "session", &mut bound, Some(&source));
        assert!(bound
            .get_envs()
            .any(|(name, value)| name == "BYCODA_APP_TOKEN" && value.is_some()));
        inner.grants.insert(
            "explicit-admin".into(),
            Grant {
                window: "same-label".into(),
                session: "explicit-admin".into(),
                cwd: "/repo".into(),
                token: "admin-token".into(),
            },
        );
        let mut admin = std::process::Command::new("unused");
        configure_child_grants(&inner, "loopback", "explicit-admin", &mut admin, None);
        assert!(admin
            .get_envs()
            .any(|(name, value)| name == "BYCODA_CONTROL_TOKEN"
                && value == Some(std::ffi::OsStr::new("admin-token"))));
        let b = activate(&mut inner, &issuer, "session");
        let called = std::sync::atomic::AtomicBool::new(false);
        assert!(inner
            .with_child_source(&source, || {
                called.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            })
            .is_err());
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst));
        assert!(inner
            .capture_child_source(&issuer, "same-label", "session", "/repo".into(), a)
            .is_err());
        assert!(inner
            .capture_child_source(
                &issuer,
                "same-label",
                "wrong-target",
                "/repo".into(),
                b.clone()
            )
            .is_err());
        assert!(inner
            .capture_child_source(&issuer, "same-label", "session", "/other".into(), b.clone())
            .is_ok());
        assert_eq!(inner.active["session"].receipt, b);
    }

    #[test]
    fn original_turn_keeps_actual_output_construction_while_late_spawn_is_denied() {
        use crate::harness::process_lifecycle::OwnedChild;
        use crate::native_provider_output::{NativeProviderOutputRegistry, OutputSource};
        use std::process::{Command, Stdio};
        let mut resources = ResourceTable::default();
        let issuer = capture_resources(&mut resources).unwrap();
        let mut inner = Inner::default();
        let a = activate(&mut inner, &issuer, "session");
        let source = inner
            .capture_child_source(&issuer, "same-label", "session", "/repo".into(), a)
            .unwrap();
        let marker = std::env::temp_dir().join(format!(
            "bycoda-control-source-{}.txt",
            uuid::Uuid::new_v4()
        ));
        let blocked_marker = marker.with_extension("blocked");
        let command = |path: &std::path::Path| {
            let mut cmd = Command::new(std::env::current_exe().unwrap());
            cmd.args([
                "--exact",
                "harness::process_construction_tests::owned_stdin_child",
                "--ignored",
                "--nocapture",
            ])
            .env("BYCODA_PROCESS_CONSTRUCTION_CAPTURE", path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                cmd.process_group(0);
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd
        };
        let child = inner
            .with_child_source(&source, || {
                OwnedChild::spawn(&mut command(&marker)).map_err(|e| e.to_string())
            })
            .unwrap();
        let registry = NativeProviderOutputRegistry::new();
        let (output, process) = registry.begin_process(
            OutputSource::fixture("session"),
            child,
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        output.reader(0).finish(true, false);
        output.reader(1).finish(true, false);
        source.bind_output(output.clone()).unwrap();
        let b = activate(&mut inner, &issuer, "session");
        let result = inner.with_child_source(&source, || {
            OwnedChild::spawn(&mut command(&blocked_marker)).map_err(|e| e.to_string())
        });
        assert!(result.is_err());
        assert!(!blocked_marker.exists());
        assert!(Arc::ptr_eq(
            source.output.lock().unwrap().as_ref().unwrap(),
            &output
        ));
        assert_eq!(
            source.output.lock().unwrap().as_ref().unwrap().epoch(),
            output.epoch()
        );
        assert!(source.bind_output(output.clone()).is_err());
        assert_eq!(inner.active["session"].receipt, b);
        process.wait(&output, false).unwrap();
        process.retirement().require_verified().unwrap();
        assert!(marker.exists());
        output.terminal_delivery(false);
        registry.shutdown();
        std::fs::remove_file(marker).unwrap();
    }
}
