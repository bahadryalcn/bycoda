//! Platform-neutral owners used by the real macOS Quick handlers.
//! Window resources and admissions are native-only; serialized UUIDs are hints.

use crate::native_window_lifecycle::NativeWriteAdmission;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Resource, ResourceTable};

/// Streaming validation avoids creating a second unbounded serialized popup
/// copy. IPC deserialization is outside this native operation's byte budget.
pub(crate) fn bounded_json_size(value: &impl Serialize, maximum: usize) -> Result<(), String> {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_sub(bytes.len())
                .ok_or_else(|| std::io::Error::other("Quick payload is too large"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(maximum), value).map_err(|err| err.to_string())
}

#[path = "quick_composer/delivery.rs"]
pub(crate) mod delivery;
pub(crate) mod launch;
#[path = "quick_composer/screenshots.rs"]
pub(crate) mod screenshots;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickLaunch {
    pub(crate) prompt: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) draft: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) intent: Option<String>,
    pub(crate) cwd: String,
    pub(crate) harness: String,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) model_settings: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) runtime_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) workspace_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) worktree_base: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) worktree_cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) attachments: Vec<QuickAttachment>,
    pub(crate) reveal: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickAttachment {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) kind: String,
    pub(crate) size: u64,
    pub(crate) path: String,
}

/// Moved into the actual worker, never owned by the detachable IPC waiter.
pub(crate) struct CaptureWork {
    admission: Option<NativeWriteAdmission>,
    capturing: Arc<AtomicBool>,
}

impl CaptureWork {
    pub(crate) fn claim(
        admission: NativeWriteAdmission,
        capturing: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        if capturing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return admission.finish(Err("A screenshot is already in progress.".into()));
        }
        Ok(Self {
            admission: Some(admission),
            capturing,
        })
    }

    pub(crate) fn finish<T, E>(mut self, result: Result<T, E>) -> Result<T, E> {
        self.admission
            .take()
            .expect("owned capture admission")
            .finish(result)
    }
}

impl Drop for CaptureWork {
    fn drop(&mut self) {
        // An unfinished admission drops as unknown. Clearing only the busy bit
        // never manufactures successful completion or cancels the worker.
        self.capturing.store(false, Ordering::Release);
    }
}

/// Both real physical windows stay busy until the actual popup is retired.
pub(crate) struct PopupWork {
    parent: Option<NativeWriteAdmission>,
    popup: Option<NativeWriteAdmission>,
}
impl PopupWork {
    pub(crate) fn new(parent: NativeWriteAdmission, popup: NativeWriteAdmission) -> Self {
        Self {
            parent: Some(parent),
            popup: Some(popup),
        }
    }
    pub(crate) fn finish<T, E>(mut self, result: Result<T, E>) -> Result<T, E> {
        let outcome = if result.is_ok() { Ok(()) } else { Err(()) };
        let _ = self
            .parent
            .take()
            .expect("owned parent admission")
            .finish(outcome);
        let _ = self
            .popup
            .take()
            .expect("owned popup admission")
            .finish(outcome);
        result
    }
}

const RESOURCE_NAME: &str = "bycoda.quick.native-window.v1";
pub(crate) const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;
struct ScopeCounter {
    store: Option<uuid::Uuid>,
    next: u64,
}
struct WindowResource {
    epoch: uuid::Uuid,
    retired: AtomicBool,
    counter: Mutex<ScopeCounter>,
}
impl Resource for WindowResource {
    fn name(&self) -> Cow<'_, str> {
        RESOURCE_NAME.into()
    }
    fn close(self: Arc<Self>) {
        self.retired.store(true, Ordering::Release);
    }
}

/// Exact native ResourceTable identity. It is not serializable or a renderer grant.
#[derive(Clone)]
pub(crate) struct QuickWindowOwner(Arc<WindowResource>);

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LaunchScope {
    pub(crate) window_epoch: String,
    pub(crate) store_instance: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchScopeView {
    pub(crate) version: u8,
    pub(crate) scope: LaunchScope,
    pub(crate) next_sequence: u64,
    pub(crate) qualified: bool,
}

impl QuickWindowOwner {
    pub(crate) fn install(resources: &mut ResourceTable) -> Result<Self, String> {
        if resources.names().any(|(_, name)| name == RESOURCE_NAME) {
            return Self::get(resources);
        }
        let resource = Arc::new(WindowResource {
            epoch: uuid::Uuid::new_v4(),
            retired: AtomicBool::new(false),
            counter: Mutex::new(ScopeCounter {
                store: None,
                next: 1,
            }),
        });
        resources.add_arc(resource.clone());
        Ok(Self(resource))
    }
    pub(crate) fn get(resources: &ResourceTable) -> Result<Self, String> {
        let id = resources
            .names()
            .find_map(|(id, name)| (name == RESOURCE_NAME).then_some(id))
            .ok_or("QUICK_NATIVE_WINDOW_UNAVAILABLE")?;
        resources
            .get(id)
            .map(Self)
            .map_err(|_| "QUICK_NATIVE_WINDOW_UNAVAILABLE".into())
    }
    pub(crate) fn matches(&self, resources: &ResourceTable) -> bool {
        !self.0.retired.load(Ordering::Acquire)
            && Self::get(resources).is_ok_and(|other| Arc::ptr_eq(&self.0, &other.0))
    }
    pub(crate) fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
    pub(crate) fn retire(&self) {
        self.0.retired.store(true, Ordering::Release);
    }
    pub(crate) fn scope(&self, store: uuid::Uuid) -> Result<LaunchScopeView, String> {
        if self.0.retired.load(Ordering::Acquire) {
            return Err("QUICK_NATIVE_WINDOW_UNAVAILABLE".into());
        }
        let mut counter = self
            .0
            .counter
            .lock()
            .map_err(|_| "QUICK_NATIVE_WINDOW_UNAVAILABLE")?;
        if counter.store != Some(store) {
            counter.store = Some(store);
            // The sequence fence belongs to this physical resource lifetime.
            // Replacing/restoring a Store must never resurrect compacted work.
        }
        Ok(LaunchScopeView {
            version: 1,
            scope: LaunchScope {
                window_epoch: self.0.epoch.to_string(),
                store_instance: store.to_string(),
            },
            next_sequence: counter.next,
            qualified: false,
        })
    }
    pub(crate) fn with_scope<T>(
        &self,
        scope: &LaunchScope,
        store: uuid::Uuid,
        consume: impl FnOnce(&mut u64) -> Result<T, String>,
    ) -> Result<T, String> {
        if self.0.retired.load(Ordering::Acquire)
            || scope.window_epoch != self.0.epoch.to_string()
            || scope.store_instance != store.to_string()
        {
            return Err("QUICK_NATIVE_SCOPE_UNAVAILABLE".into());
        }
        let mut counter = self
            .0
            .counter
            .lock()
            .map_err(|_| "QUICK_NATIVE_SCOPE_UNAVAILABLE")?;
        if counter.store != Some(store) {
            return Err("QUICK_NATIVE_SCOPE_UNAVAILABLE".into());
        }
        consume(&mut counter.next)
    }
}

#[cfg(test)]
#[path = "quick_native_tests.rs"]
mod tests;
