//! Native, physical-webview ownership for open conversation tabs.
use crate::control::receipts::{capture, WindowIssuer};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::WebviewWindow;

#[derive(Clone)]
struct Claim {
    issuer: Arc<WindowIssuer>,
    label: String,
    token: String,
    spawn_only: bool,
    release_requested: bool,
}
#[derive(Default)]
struct Registry {
    claims: HashMap<String, Claim>,
    pending: HashMap<String, usize>,
    active: HashMap<String, std::collections::HashSet<String>>,
}
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ClaimResult {
    Owned {
        tokens: HashMap<String, String>,
    },
    Other {
        session_id: String,
        owner_window_label: String,
    },
}
impl Registry {
    fn claim(
        &mut self,
        issuer: &Arc<WindowIssuer>,
        label: &str,
        ids: &[String],
    ) -> Result<ClaimResult, String> {
        if ids.is_empty() || ids.len() > 128 || ids.iter().any(|id| id.is_empty() || id.len() > 512)
        {
            return Err("Invalid conversation ownership request".into());
        }
        for id in ids {
            if let Some(claim) = self.claims.get(id) {
                if !claim.issuer.is_live() {
                    return Err("Conversation owner is unavailable. Retry after recovery.".into());
                }
                if !Arc::ptr_eq(&claim.issuer, issuer) {
                    return Ok(ClaimResult::Other {
                        session_id: id.clone(),
                        owner_window_label: claim.label.clone(),
                    });
                }
            }
        }
        let mut tokens = HashMap::new();
        for id in ids {
            let claim = self.claims.entry(id.clone()).or_insert_with(|| Claim {
                issuer: issuer.clone(),
                label: label.to_owned(),
                token: uuid::Uuid::new_v4().to_string(),
                spawn_only: false,
                release_requested: false,
            });
            claim.spawn_only = false;
            claim.release_requested = false;
            tokens.insert(id.clone(), claim.token.clone());
        }
        Ok(ClaimResult::Owned { tokens })
    }
    fn transfer(
        &mut self,
        source: &Arc<WindowIssuer>,
        destination: &Arc<WindowIssuer>,
        label: &str,
        tokens: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>, String> {
        if tokens.is_empty() || !source.is_live() || !destination.is_live() {
            return Err("Conversation transfer owner is unavailable".into());
        }
        for (id, token) in tokens {
            if self.pending.get(id).copied().unwrap_or(0) > 0 {
                return Err("Conversation is starting; retry the transfer".into());
            }
            if !self
                .claims
                .get(id)
                .is_some_and(|claim| Arc::ptr_eq(&claim.issuer, source) && claim.token == *token)
            {
                return Err("Conversation transfer ownership changed".into());
            }
        }
        let mut new_tokens = HashMap::new();
        for id in tokens.keys() {
            let token = uuid::Uuid::new_v4().to_string();
            self.claims.insert(
                id.clone(),
                Claim {
                    issuer: destination.clone(),
                    label: label.to_owned(),
                    token: token.clone(),
                    spawn_only: false,
                    release_requested: false,
                },
            );
            new_tokens.insert(id.clone(), token);
        }
        Ok(new_tokens)
    }
    fn release(
        &mut self,
        issuer: &Arc<WindowIssuer>,
        tokens: &HashMap<String, String>,
    ) -> Result<(), String> {
        for (id, token) in tokens {
            let busy = self.pending.get(id).copied().unwrap_or(0) > 0
                || self.active.get(id).is_some_and(|active| !active.is_empty());
            if let Some(claim) = self.claims.get_mut(id) {
                if Arc::ptr_eq(&claim.issuer, issuer) && claim.token == *token {
                    if busy {
                        claim.release_requested = true;
                    } else {
                        self.claims.remove(id);
                    }
                }
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn claim_session_windows(
    window: WebviewWindow,
    session_ids: Vec<String>,
) -> Result<ClaimResult, String> {
    let issuer = capture(&window)?;
    issuer.with_live(|| {
        registry()
            .lock()
            .map_err(|_| "Conversation ownership unavailable".to_string())?
            .claim(&issuer, window.label(), &session_ids)
    })
}
#[tauri::command]
pub(crate) fn verify_session_window_owner(
    window: WebviewWindow,
    session_id: String,
) -> Result<bool, String> {
    let issuer = capture(&window)?;
    issuer.with_live(|| {
        let registry = registry()
            .lock()
            .map_err(|_| "Conversation ownership unavailable".to_string())?;
        Ok(registry
            .claims
            .get(&session_id)
            .is_some_and(|claim| Arc::ptr_eq(&claim.issuer, &issuer) && claim.issuer.is_live()))
    })
}

/// Keep the captured page and exact session ownership live through a local effect.
pub(crate) fn with_session_window_owner<T>(
    issuer: &Arc<WindowIssuer>,
    session_id: &str,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    issuer.with_live(|| {
        let registry = registry()
            .lock()
            .map_err(|_| "Conversation ownership unavailable".to_string())?;
        if !registry
            .claims
            .get(session_id)
            .is_some_and(|claim| Arc::ptr_eq(&claim.issuer, issuer))
        {
            return Err("Conversation ownership changed".into());
        }
        work()
    })
}

#[tauri::command]
pub(crate) fn release_session_windows(
    window: WebviewWindow,
    tokens: HashMap<String, String>,
) -> Result<(), String> {
    let issuer = capture(&window)?;
    issuer.with_live(|| {
        registry()
            .lock()
            .map_err(|_| "Conversation ownership unavailable".to_string())?
            .release(&issuer, &tokens)?;
        Ok(())
    })
}
pub(crate) fn prepare_transfer(
    source: &Arc<WindowIssuer>,
    ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let registry = registry()
        .lock()
        .map_err(|_| "Conversation ownership unavailable".to_string())?;
    let mut tokens = HashMap::new();
    for id in ids {
        let claim = registry
            .claims
            .get(id)
            .ok_or("Conversation ownership is not established")?;
        if !Arc::ptr_eq(&claim.issuer, source) || !source.is_live() {
            return Err("Conversation transfer ownership changed".into());
        }
        tokens.insert(id.clone(), claim.token.clone());
    }
    Ok(tokens)
}

pub(crate) fn transfer_source_label(
    source: &Arc<WindowIssuer>,
    tokens: &HashMap<String, String>,
) -> Result<String, String> {
    if tokens.is_empty() {
        return Ok(String::new());
    }
    let registry = registry()
        .lock()
        .map_err(|_| "Conversation ownership unavailable".to_string())?;
    let (id, token) = tokens
        .iter()
        .next()
        .ok_or("Conversation ownership unavailable")?;
    let claim = registry
        .claims
        .get(id)
        .ok_or("Conversation ownership unavailable")?;
    if !Arc::ptr_eq(&claim.issuer, source) || claim.token != *token {
        return Err("Conversation transfer ownership changed".into());
    }
    Ok(claim.label.clone())
}

pub(crate) fn transfer_claims(
    source: &Arc<WindowIssuer>,
    destination: &Arc<WindowIssuer>,
    label: &str,
    tokens: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    if tokens.is_empty() {
        return Ok(HashMap::new());
    }
    let result = registry()
        .lock()
        .map_err(|_| "Conversation ownership unavailable".to_string())?
        .transfer(source, destination, label, tokens)?;
    Ok(result)
}

pub(crate) fn rollback_transfer(
    destination: &Arc<WindowIssuer>,
    source: &Arc<WindowIssuer>,
    label: &str,
    moved: &HashMap<String, String>,
    original: &HashMap<String, String>,
) -> Result<(), String> {
    let mut registry = registry()
        .lock()
        .map_err(|_| "Conversation ownership unavailable".to_string())?;
    if !source.is_live() || moved.len() != original.len() {
        return Err("Conversation transfer rollback unavailable".into());
    }
    for (id, token) in moved {
        if !original.contains_key(id)
            || !registry.claims.get(id).is_some_and(|claim| {
                Arc::ptr_eq(&claim.issuer, destination) && claim.token == *token
            })
        {
            return Err("Conversation transfer rollback ownership changed".into());
        }
    }
    for (id, token) in original {
        registry.claims.insert(
            id.clone(),
            Claim {
                issuer: source.clone(),
                label: label.to_string(),
                token: token.clone(),
                spawn_only: false,
                release_requested: false,
            },
        );
    }
    Ok(())
}

pub(crate) fn release_issuer(issuer: &Arc<WindowIssuer>) {
    if let Ok(mut registry) = registry().lock() {
        let ids: Vec<_> = registry
            .claims
            .iter()
            .filter_map(|(id, claim)| Arc::ptr_eq(&claim.issuer, issuer).then_some(id.clone()))
            .collect();
        for id in ids {
            let busy = registry.pending.get(&id).copied().unwrap_or(0) > 0
                || registry
                    .active
                    .get(&id)
                    .is_some_and(|active| !active.is_empty());
            if busy {
                if let Some(claim) = registry.claims.get_mut(&id) {
                    claim.release_requested = true;
                }
            } else {
                registry.claims.remove(&id);
            }
        }
    }
}
/// Keeps ownership reserved throughout a native process start.
pub(crate) struct SpawnReservation {
    session_id: String,
    token: String,
    committed: bool,
}
pub(crate) struct SpawnLifetime {
    session_id: String,
    token: String,
    generation: String,
}
impl SpawnLifetime {
    /// Call only once native process exit is confirmed.
    pub(crate) fn finish(self) {
        if let Ok(mut registry) = registry().lock() {
            if let Some(active) = registry.active.get_mut(&self.session_id) {
                active.remove(&self.generation);
                if active.is_empty() {
                    registry.active.remove(&self.session_id);
                }
            }
            if !registry.pending.contains_key(&self.session_id)
                && !registry.active.contains_key(&self.session_id)
                && registry.claims.get(&self.session_id).is_some_and(|claim| {
                    (claim.spawn_only || claim.release_requested) && claim.token == self.token
                })
            {
                registry.claims.remove(&self.session_id);
            }
        }
    }
}
impl SpawnReservation {
    pub(crate) fn commit(&mut self) -> Result<SpawnLifetime, String> {
        let generation = uuid::Uuid::new_v4().to_string();
        let mut registry = registry()
            .lock()
            .map_err(|_| "Conversation ownership unavailable".to_string())?;
        registry
            .active
            .entry(self.session_id.clone())
            .or_default()
            .insert(generation.clone());
        self.committed = true;
        Ok(SpawnLifetime {
            session_id: self.session_id.clone(),
            token: self.token.clone(),
            generation,
        })
    }
}
impl Drop for SpawnReservation {
    fn drop(&mut self) {
        if let Ok(mut registry) = registry().lock() {
            if let Some(count) = registry.pending.get_mut(&self.session_id) {
                *count -= 1;
                if *count == 0 {
                    registry.pending.remove(&self.session_id);
                }
            }
            if !registry.pending.contains_key(&self.session_id)
                && !registry.active.contains_key(&self.session_id)
                && registry.claims.get(&self.session_id).is_some_and(|claim| {
                    ((!self.committed && claim.spawn_only) || claim.release_requested)
                        && claim.token == self.token
                })
            {
                registry.claims.remove(&self.session_id);
            }
        }
    }
}
pub(crate) fn reserve_spawn(
    session_id: &str,
    issuer: &Arc<WindowIssuer>,
    label: &str,
) -> Result<SpawnReservation, String> {
    if session_id.is_empty() || session_id.len() > 512 {
        return Err("Invalid conversation ownership request".into());
    }
    let mut registry = registry()
        .lock()
        .map_err(|_| "Conversation ownership unavailable".to_string())?;
    if let Some(claim) = registry.claims.get(session_id) {
        if !claim.issuer.is_live() {
            return Err("Conversation owner is unavailable. Retry after recovery.".into());
        }
        if !Arc::ptr_eq(&claim.issuer, issuer) {
            return Err("Conversation is owned by another window".into());
        }
    }
    let claim = registry
        .claims
        .entry(session_id.to_string())
        .or_insert_with(|| Claim {
            issuer: issuer.clone(),
            label: label.to_string(),
            token: uuid::Uuid::new_v4().to_string(),
            spawn_only: true,
            release_requested: false,
        });
    let token = claim.token.clone();
    *registry.pending.entry(session_id.to_string()).or_default() += 1;
    Ok(SpawnReservation {
        session_id: session_id.to_string(),
        token,
        committed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmed_exit_releases_only_unadopted_current_generations() {
        let owner = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        let mut first = reserve_spawn(&id, &owner, "owner").unwrap();
        let first_lifetime = first.commit().unwrap();
        drop(first);
        let mut second = reserve_spawn(&id, &owner, "owner").unwrap();
        let second_lifetime = second.commit().unwrap();
        drop(second);
        first_lifetime.finish();
        assert!(registry().lock().unwrap().claims.contains_key(&id));
        second_lifetime.finish();
        assert!(!registry().lock().unwrap().claims.contains_key(&id));

        let mut adopted = reserve_spawn(&id, &owner, "owner").unwrap();
        let lifetime = adopted.commit().unwrap();
        registry()
            .lock()
            .unwrap()
            .claim(&owner, "owner", std::slice::from_ref(&id))
            .unwrap();
        drop(adopted);
        lifetime.finish();
        assert!(registry().lock().unwrap().claims.contains_key(&id));
        release_issuer(&owner);
    }

    #[test]
    fn closing_active_tab_defers_release_and_reopen_cancels_it() {
        let owner = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        let tokens = match registry()
            .lock()
            .unwrap()
            .claim(&owner, "owner", std::slice::from_ref(&id))
            .unwrap()
        {
            ClaimResult::Owned { tokens } => tokens,
            _ => panic!(),
        };
        let mut reservation = reserve_spawn(&id, &owner, "owner").unwrap();
        let lifetime = reservation.commit().unwrap();
        drop(reservation);
        registry().lock().unwrap().release(&owner, &tokens).unwrap();
        assert!(registry().lock().unwrap().claims.contains_key(&id));
        registry()
            .lock()
            .unwrap()
            .claim(&owner, "owner", std::slice::from_ref(&id))
            .unwrap();
        lifetime.finish();
        assert!(registry().lock().unwrap().claims.contains_key(&id));
        registry()
            .lock()
            .unwrap()
            .release(&owner, &HashMap::from([(id.clone(), "stale".into())]))
            .unwrap();
        assert!(registry().lock().unwrap().claims.contains_key(&id));
        registry().lock().unwrap().release(&owner, &tokens).unwrap();
        assert!(!registry().lock().unwrap().claims.contains_key(&id));
    }
    #[test]
    fn retiring_window_preserves_claim_until_process_exit() {
        let owner = Arc::new(WindowIssuer::default());
        let other = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        let mut reservation = reserve_spawn(&id, &owner, "owner").unwrap();
        let lifetime = reservation.commit().unwrap();
        drop(reservation);
        release_issuer(&owner);
        assert!(matches!(
            registry()
                .lock()
                .unwrap()
                .claim(&other, "other", std::slice::from_ref(&id))
                .unwrap(),
            ClaimResult::Other { .. }
        ));
        lifetime.finish();
        assert!(matches!(
            registry()
                .lock()
                .unwrap()
                .claim(&other, "other", std::slice::from_ref(&id))
                .unwrap(),
            ClaimResult::Owned { .. }
        ));
        release_issuer(&other);
    }

    #[test]
    fn closing_active_tab_releases_after_confirmed_exit() {
        let owner = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        let tokens = match registry()
            .lock()
            .unwrap()
            .claim(&owner, "owner", std::slice::from_ref(&id))
            .unwrap()
        {
            ClaimResult::Owned { tokens } => tokens,
            _ => panic!(),
        };
        let mut reservation = reserve_spawn(&id, &owner, "owner").unwrap();
        let lifetime = reservation.commit().unwrap();
        drop(reservation);
        registry().lock().unwrap().release(&owner, &tokens).unwrap();
        lifetime.finish();
        assert!(!registry().lock().unwrap().claims.contains_key(&id));
    }

    #[test]
    fn failed_start_rolls_back_only_unadopted_claim() {
        let owner = Arc::new(WindowIssuer::default());
        let id = uuid::Uuid::new_v4().to_string();
        drop(reserve_spawn(&id, &owner, "owner").unwrap());
        assert!(!registry().lock().unwrap().claims.contains_key(&id));
        let reservation = reserve_spawn(&id, &owner, "owner").unwrap();
        registry()
            .lock()
            .unwrap()
            .claim(&owner, "owner", std::slice::from_ref(&id))
            .unwrap();
        drop(reservation);
        assert!(registry().lock().unwrap().claims.contains_key(&id));
        release_issuer(&owner);
    }

    #[test]
    fn concurrent_windows_cannot_claim_the_same_conversation() {
        let registry = Arc::new(Mutex::new(Registry::default()));
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let mut threads = Vec::new();
        for label in ["a", "b"] {
            let registry = registry.clone();
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                let issuer = Arc::new(WindowIssuer::default());
                barrier.wait();
                let outcome = registry
                    .lock()
                    .unwrap()
                    .claim(&issuer, label, &["one".into()])
                    .unwrap();
                outcome
            }));
        }
        let outcomes: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| matches!(result, ClaimResult::Owned { .. }))
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| matches!(result, ClaimResult::Other { .. }))
                .count(),
            1
        );
    }
    #[test]
    fn transfer_is_atomic_and_rejects_stale_source_tokens() {
        let mut registry = Registry::default();
        let source = Arc::new(WindowIssuer::default());
        let destination = Arc::new(WindowIssuer::default());
        let ids = vec!["one".into(), "two".into()];
        let ClaimResult::Owned { tokens } = registry.claim(&source, "source", &ids).unwrap() else {
            panic!()
        };
        registry.pending.insert("one".into(), 1);
        assert!(registry
            .transfer(&source, &destination, "destination", &tokens)
            .is_err());
        registry.pending.clear();
        let mut stale = tokens.clone();
        stale.insert("two".into(), "stale".into());
        assert!(registry
            .transfer(&source, &destination, "destination", &stale)
            .is_err());
        assert!(registry
            .claims
            .values()
            .all(|claim| Arc::ptr_eq(&claim.issuer, &source)));
        let moved = registry
            .transfer(&source, &destination, "destination", &tokens)
            .unwrap();
        registry.release(&source, &tokens).unwrap();
        assert_eq!(registry.claims.len(), 2);
        registry.release(&destination, &moved).unwrap();
        assert!(registry.claims.is_empty());
    }
    #[test]
    fn claims_are_atomic_retryable_and_release_requires_exact_owner_and_token() {
        let mut registry = Registry::default();
        let a = Arc::new(WindowIssuer::default());
        let b = Arc::new(WindowIssuer::default());
        let ids = vec!["one".into(), "two".into()];
        let ClaimResult::Owned { tokens } = registry.claim(&a, "a", &ids).unwrap() else {
            panic!()
        };
        let ClaimResult::Owned { tokens: retried } = registry.claim(&a, "a", &ids).unwrap() else {
            panic!()
        };
        assert_eq!(tokens, retried);
        assert!(matches!(
            registry
                .claim(&b, "b", &["free".into(), "one".into()])
                .unwrap(),
            ClaimResult::Other { .. }
        ));
        assert!(!registry.claims.contains_key("free"));
        registry.release(&b, &tokens).unwrap();
        assert_eq!(registry.claims.len(), 2);
        registry
            .release(&a, &HashMap::from([("one".into(), "stale".into())]))
            .unwrap();
        assert_eq!(registry.claims.len(), 2);
        registry.release(&a, &tokens).unwrap();
        assert!(registry.claims.is_empty());
    }
}
