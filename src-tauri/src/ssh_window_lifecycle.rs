//! One native window generation for all SSH capabilities. Never exposed as IPC.
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
};

#[derive(Default)]
struct Registry {
    owners: HashMap<String, Arc<AtomicBool>>,
    shutting_down: bool,
}
type Shared = Arc<Mutex<Registry>>;
fn global() -> &'static Shared {
    static REGISTRY: OnceLock<Shared> = OnceLock::new();
    REGISTRY.get_or_init(Default::default)
}

#[derive(Clone)]
pub(crate) struct Lease {
    owner: String,
    alive: Arc<AtomicBool>,
    registry: Weak<Mutex<Registry>>,
}
impl std::fmt::Debug for Lease {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshWindowLease")
            .field("owner", &self.owner)
            .field("alive", &self.is_alive())
            .finish()
    }
}
impl Lease {
    pub(crate) fn owner(&self) -> &str {
        &self.owner
    }
    pub(crate) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire) && self.registry.strong_count() > 0
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        if self.is_alive() {
            Ok(())
        } else {
            Err("SSH native window is closed".into())
        }
    }
    /// Spawn and register the owned child inside this closure. Closing the
    /// window takes the same lock and cannot miss a child registered afterward.
    pub(crate) fn with_live<T>(
        &self,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let shared = self
            .registry
            .upgrade()
            .ok_or("SSH native window registry is closed")?;
        let registry = shared.lock().unwrap_or_else(|e| e.into_inner());
        if registry.shutting_down
            || !self.is_alive()
            || !registry
                .owners
                .get(&self.owner)
                .is_some_and(|current| Arc::ptr_eq(current, &self.alive))
        {
            return Err("SSH native window closed before process launch".into());
        }
        action()
    }
}
fn register_in(shared: &Shared, owner: &str) -> Result<Lease, String> {
    if owner.is_empty() || owner.len() > 200 || owner.chars().any(char::is_control) {
        return Err("Invalid native SSH window owner".into());
    }
    let mut registry = shared.lock().unwrap_or_else(|e| e.into_inner());
    if registry.shutting_down {
        return Err("SSH window lifecycle is shutting down".into());
    }
    if !registry.owners.contains_key(owner) && registry.owners.len() >= 256 {
        return Err("Too many native SSH windows".into());
    }
    let alive = registry
        .owners
        .entry(owner.into())
        .or_insert_with(|| Arc::new(AtomicBool::new(true)))
        .clone();
    Ok(Lease {
        owner: owner.into(),
        alive,
        registry: Arc::downgrade(shared),
    })
}
fn capture_in(shared: &Shared, owner: &str) -> Result<Lease, String> {
    let registry = shared.lock().unwrap_or_else(|e| e.into_inner());
    let alive = registry
        .owners
        .get(owner)
        .filter(|alive| alive.load(Ordering::Acquire) && !registry.shutting_down)
        .ok_or("SSH native window is closed")?
        .clone();
    Ok(Lease {
        owner: owner.into(),
        alive,
        registry: Arc::downgrade(shared),
    })
}
fn close_in(shared: &Shared, owner: &str) {
    let mut registry = shared.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(alive) = registry.owners.remove(owner) {
        alive.store(false, Ordering::Release);
    }
}
fn shutdown_in(shared: &Shared) {
    let mut registry = shared.lock().unwrap_or_else(|e| e.into_inner());
    registry.shutting_down = true;
    for alive in registry.owners.values() {
        alive.store(false, Ordering::Release);
    }
    registry.owners.clear();
}
pub(crate) fn register(owner: &str) -> Result<Lease, String> {
    register_in(global(), owner)
}
pub(crate) fn capture(owner: &str) -> Result<Lease, String> {
    capture_in(global(), owner)
}
pub(crate) fn close(owner: &str) {
    close_in(global(), owner)
}
pub(crate) fn shutdown() {
    shutdown_in(global())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn label_reuse_does_not_revive_old_generations_and_shutdown_is_final() {
        let shared = Shared::default();
        assert!(capture_in(&shared, "main").is_err());
        let old = register_in(&shared, "main").unwrap();
        let same = capture_in(&shared, "main").unwrap();
        assert!(Arc::ptr_eq(&old.alive, &same.alive));
        close_in(&shared, "main");
        assert!(old.check().is_err());
        let new = register_in(&shared, "main").unwrap();
        assert!(new.check().is_ok());
        assert!(!Arc::ptr_eq(&old.alive, &new.alive));
        assert!(old.with_live(|| Ok(())).is_err());
        shutdown_in(&shared);
        assert!(new.check().is_err());
        assert!(register_in(&shared, "main").is_err());
    }
    #[test]
    fn close_serializes_with_spawn_registration_and_late_work_never_runs() {
        let shared = Shared::default();
        let lease = register_in(&shared, "owned").unwrap();
        let (other_tx, other_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let active = lease.clone();
        let worker = std::thread::spawn(move || {
            active.with_live(|| {
                other_tx.send(()).unwrap();
                done_rx.recv().unwrap();
                Ok(())
            })
        });
        other_rx.recv().unwrap();
        let closing = shared.clone();
        let (closed_tx, closed_rx) = std::sync::mpsc::channel();
        let closer = std::thread::spawn(move || {
            close_in(&closing, "owned");
            closed_tx.send(()).unwrap();
        });
        assert!(closed_rx
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        done_tx.send(()).unwrap();
        worker.join().unwrap().unwrap();
        closer.join().unwrap();
        closed_rx.recv().unwrap();
        let called = AtomicBool::new(false);
        assert!(lease
            .with_live(|| {
                called.store(true, Ordering::Relaxed);
                Ok(())
            })
            .is_err());
        assert!(!called.load(Ordering::Relaxed));
    }
}
