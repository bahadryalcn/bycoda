//! Original Native preparation ownership of cooperative Host writer fences.
//! Actual connection handle capture is Windows-only. No DTO/path constructor
//! attests SQL on Unix, and no actor/enrollment/qualification claim is made.
use super::SessionStore;
use bycoda_physical_store_admission::{
    database_registry_root, BusyResource, ClosedFence, ClosingFence, Error, PhysicalStore, Registry,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

const MAX_PROCESS_OWNERS: usize = 64;

#[derive(Default)]
struct ProcessOwners {
    owners: HashMap<FenceGeneration, Arc<HostNotesFenceOwner>>,
}

fn process_owners() -> Result<MutexGuard<'static, ProcessOwners>, String> {
    static OWNERS: OnceLock<Mutex<ProcessOwners>> = OnceLock::new();
    OWNERS
        .get_or_init(|| Mutex::new(ProcessOwners::default()))
        .lock()
        .map_err(|_| "NATIVE_HOST_NOTES_PROCESS_KEEPER_UNAVAILABLE".into())
}

/// Only this actual Store capture can construct the production input. Binding
/// occurs after the short SQL borrow has ended; no closing occurs here.
pub(crate) struct CapturedHostNotesStore {
    store: Option<PhysicalStore>,
}

impl CapturedHostNotesStore {
    pub(crate) fn capture(store: &SessionStore) -> Result<Self, String> {
        let pinned = {
            let connection = store.lock_conn()?;
            connection.pinned_host_notes_file()?
        };
        let store = match pinned {
            Some((canonical, actual)) => {
                let root = database_registry_root(&canonical).map_err(|error| error.to_string())?;
                Some(
                    Registry::open(&root)
                        .and_then(|registry| registry.bind(actual))
                        .map_err(|error| error.to_string())?,
                )
            }
            None => None,
        };
        Ok(Self { store })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct FenceGeneration(uuid::Uuid);

enum Phase {
    Pending,
    Closing(ClosingFence),
    Closed(ClosedFence),
}
struct Entry {
    store: PhysicalStore,
    phase: Phase,
}
struct Set {
    entries: Vec<Entry>,
    cooperative_only: bool,
}
enum Slot {
    Available(Set),
    Working,
    Retired,
}

/// Owned by the issued Preparation, never renderer/window/pipe DTO state.
/// The mutex is used only to move original ownership. Kernel I/O and polling
/// happen in a returned Loan with no SQL/resource/owner mutex held.
pub(crate) struct HostNotesFenceOwner {
    generation: FenceGeneration,
    state: Mutex<Slot>,
}

struct Loan<'a> {
    owner: &'a HostNotesFenceOwner,
    set: Option<Set>,
    retired: bool,
}
impl Drop for Loan<'_> {
    fn drop(&mut self) {
        // Poison is never permission to drop original live fences. Restoring
        // the private slot requires no allocation, callback or kernel call.
        let mut state = self
            .owner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.retired {
            *state = Slot::Retired;
        } else if let Some(set) = self.set.take() {
            *state = Slot::Available(set);
        }
    }
}

impl HostNotesFenceOwner {
    pub(crate) fn new(captures: Vec<CapturedHostNotesStore>) -> Arc<Self> {
        let mut entries: Vec<Entry> = Vec::new();
        let mut cooperative_only = captures.is_empty();
        for capture in captures {
            if let Some(store) = capture.store {
                if !entries
                    .iter()
                    .any(|entry| entry.store.identity() == store.identity())
                {
                    entries.push(Entry {
                        store,
                        phase: Phase::Pending,
                    });
                }
            } else {
                cooperative_only = true;
            }
        }
        Arc::new(Self {
            generation: FenceGeneration(uuid::Uuid::new_v4()),
            state: Mutex::new(Slot::Available(Set {
                entries,
                cooperative_only,
            })),
        })
    }

    pub(crate) fn generation(&self) -> FenceGeneration {
        self.generation
    }

    fn loan(&self, generation: FenceGeneration) -> Result<Loan<'_>, String> {
        if generation != self.generation {
            return Err("NATIVE_HOST_NOTES_FENCE_WRONG_OWNER".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "NATIVE_HOST_NOTES_FENCE_UNAVAILABLE")?;
        if !matches!(*state, Slot::Available(_)) {
            return Err("NATIVE_HOST_NOTES_FENCE_BUSY_OR_RETIRED".into());
        }
        let Slot::Available(set) = std::mem::replace(&mut *state, Slot::Working) else {
            unreachable!()
        };
        drop(state);
        Ok(Loan {
            owner: self,
            set: Some(set),
            retired: false,
        })
    }

    fn reserve_process_owner(self: &Arc<Self>) -> Result<(), String> {
        let mut keeper = process_owners()?;
        if let Some(original) = keeper.owners.get(&self.generation) {
            return if Arc::ptr_eq(original, self) {
                Ok(())
            } else {
                Err("NATIVE_HOST_NOTES_PROCESS_OWNER_CONFLICT".into())
            };
        }
        if keeper.owners.len() >= MAX_PROCESS_OWNERS {
            return Err("NATIVE_HOST_NOTES_PROCESS_OWNER_CAPACITY".into());
        }
        keeper.owners.insert(self.generation, Arc::clone(self));
        Ok(())
    }

    fn remove_process_owner(self: &Arc<Self>) -> Result<Option<Arc<Self>>, String> {
        let mut keeper = process_owners()?;
        if let Some(original) = keeper.owners.get(&self.generation) {
            if !Arc::ptr_eq(original, self) {
                return Err("NATIVE_HOST_NOTES_PROCESS_OWNER_CONFLICT".into());
            }
        }
        Ok(keeper.owners.remove(&self.generation))
    }

    pub(crate) fn close_ingress(
        self: &Arc<Self>,
        generation: FenceGeneration,
    ) -> Result<(), String> {
        let mut loan = self.loan(generation)?;
        // Reserve bounded strong ownership BEFORE the first kernel close. The
        // map mutex ends before kernel/owner/SQL work. Runtime re-association or
        // a hard-error stack unwind cannot make the final observer own Drop.
        self.reserve_process_owner()?;
        for entry in &mut loan.set.as_mut().unwrap().entries {
            if matches!(entry.phase, Phase::Pending) {
                // Publish each actual acquired fence into the original set
                // before attempting another store or checking cancellation.
                entry.phase = Phase::Closing(
                    entry
                        .store
                        .try_begin_close()
                        .map_err(|error| error.to_string())?,
                );
            }
        }
        Ok(())
    }

    fn drain(set: &mut Set) -> Result<bool, String> {
        let mut drained = true;
        for entry in &mut set.entries {
            let phase = std::mem::replace(&mut entry.phase, Phase::Pending);
            entry.phase = match phase {
                Phase::Closing(closing) => match closing.try_upgrade() {
                    Ok(closed) => Phase::Closed(closed),
                    Err(error) => {
                        let (error, same_closing) = error.into_parts();
                        entry.phase = Phase::Closing(same_closing);
                        match error {
                            Error::Busy(BusyResource::Writers) => {
                                drained = false;
                                continue;
                            }
                            error => return Err(error.to_string()),
                        }
                    }
                },
                Phase::Closed(closed) => {
                    if closed.identity() != entry.store.identity() {
                        entry.phase = Phase::Closed(closed);
                        return Err("NATIVE_HOST_NOTES_FENCE_IDENTITY_CHANGED".into());
                    }
                    Phase::Closed(closed)
                }
                Phase::Pending => Phase::Pending,
            };
        }
        Ok(drained)
    }

    /// Pending stores are not owned gates. Every acquired Closing, including a
    /// partial multi-store failure, remains held until its actual writer drain.
    pub(crate) fn try_drained(&self, generation: FenceGeneration) -> Result<bool, String> {
        let mut loan = self.loan(generation)?;
        Self::drain(loan.set.as_mut().unwrap())
    }

    pub(crate) fn cooperative_only(&self, generation: FenceGeneration) -> Result<bool, String> {
        let loan = self.loan(generation)?;
        Ok(loan.set.as_ref().unwrap().cooperative_only)
    }

    /// Called only after the actual matching preparation's SQL jobs and Native
    /// round retire. Busy/error restores the original set; there is no force
    /// release for observer timeout/cancellation or a guessed generation.
    pub(crate) fn retire_if_drained(
        self: &Arc<Self>,
        generation: FenceGeneration,
    ) -> Result<bool, String> {
        let mut loan = self.loan(generation)?;
        if !Self::drain(loan.set.as_mut().unwrap())? {
            return Ok(false);
        }
        // The actual same-generation terminal path is the only record removal.
        // No eviction, Drop registration, Weak keeper, ID recovery or timeout.
        let retained = self.remove_process_owner()?;
        let set = loan.set.take().unwrap();
        loan.retired = true;
        drop(set); // Actual owned handles release outside the owner mutex.
        drop(retained); // Also outside the process keeper mutex.
        Ok(true)
    }
}

#[cfg(test)]
#[path = "host_notes_fence_tests.rs"]
mod tests;
