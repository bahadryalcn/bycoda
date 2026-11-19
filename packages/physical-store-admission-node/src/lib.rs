//! Private mechanical file/lease bridge plus a separate SQLite identity entry.
//! Neither creates application permission or complete writer enrollment.
//! Live guards belong to a pinned process-native registry, not JavaScript GC.
mod image_pin;
mod process_identity;
pub use process_identity::{
    windows_listeners, windows_process_births, WindowsListener, WindowsProcessBirth,
};
mod guarded_move;
mod rename_no_replace;
pub use guarded_move::{guarded_move, GuardedMoveResult, GuardedMoveTask};
pub use rename_no_replace::rename_no_replace;
mod sqlite_extension;

pub use sqlite_extension::{
    connection_attestation_supported, registry_root_for_database, sqlite_extension_entry_point,
};

use bycoda_physical_store_admission as core;
use napi::bindgen_prelude::BigInt;
use napi_derive::napi;
use std::{
    collections::BTreeMap,
    fs::File,
    path::Path,
    sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, Weak},
    time::Instant,
};

const MAX_OWNER: usize = 64;
const MAX_PROCESS: usize = 256;

#[derive(Default)]
struct StrongRegistry {
    next_owner: u64,
    next_binding: u64,
    next_slot: u64,
    records: BTreeMap<u64, Record>,
    // Slots whose kernel admission runs OUTSIDE the registry mutex (slot -> owner).
    // They count against capacity exactly like live records, so unlocked
    // admission can never exceed the per-owner or per-process bound.
    pending: BTreeMap<u64, u64>,
}

struct Binding {
    owner: u64,
    id: u64,
    file: File,
    store: core::PhysicalStore,
    // Serializes admission per physical file within this process (same as the
    // old global mutex did), so same-process contenders never see each other's
    // short exclusive turnstile as a spurious Busy. Other files and registry
    // bookkeeping (release/statistics) no longer wait behind it.
    admission: Arc<Mutex<()>>,
}

enum Guard {
    Writer(core::WriterReservation),
    Closing(core::ClosingFence),
    Closed(core::ClosedFence),
}

struct Record {
    binding: Arc<Binding>,
    guard: Guard,
    // Diagnostic only; never an identifier or authority.
    created: Instant,
}

fn failure(reason: impl ToString) -> napi::Error {
    napi::Error::from_reason(reason.to_string())
}

fn state() -> &'static Mutex<StrongRegistry> {
    static STATE: OnceLock<Mutex<StrongRegistry>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(StrongRegistry::default()))
}

fn registry() -> napi::Result<MutexGuard<'static, StrongRegistry>> {
    state().lock().map_err(|_| {
        failure("physical admission process registry is poisoned; retained guards remain held")
    })
}

/// Only for re-inserting a guard that already exists (admission commit, upgrade
/// restore) and for pending cleanup: a poisoned map must never drop a live
/// kernel guard, because that would silently reopen ingress.
fn registry_lenient() -> MutexGuard<'static, StrongRegistry> {
    state().lock().unwrap_or_else(PoisonError::into_inner)
}

/// One admission lock per physical file identity. The map holds weak entries
/// so it stays bounded by the files that currently have live bindings.
fn admission_lock(native_format: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<BTreeMap<String, Weak<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(native_format).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(native_format.to_owned(), Arc::downgrade(&lock));
    lock
}

/// A capacity-counted slot whose kernel admission runs without the registry
/// mutex. Dropping it (Busy, error, panic) frees the slot; `commit` turns it
/// into the live record under one short lock.
struct Pending {
    slot: u64,
}

impl Pending {
    fn reserve(owner: u64) -> napi::Result<Self> {
        let mut state = registry()?;
        check_capacity(&state, owner)?;
        let slot = next(state.next_slot)?;
        state.next_slot = slot;
        Ok(Self::adopt(&mut state, slot, owner))
    }

    /// Keep an already-owned slot counted while its record is out of the map.
    fn adopt(state: &mut StrongRegistry, slot: u64, owner: u64) -> Self {
        state.pending.insert(slot, owner);
        Self { slot }
    }

    fn commit(self, record: Record) -> u64 {
        let mut state = registry_lenient();
        state.pending.remove(&self.slot);
        state.records.insert(self.slot, record);
        self.slot
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        registry_lenient().pending.remove(&self.slot);
    }
}

fn next(value: u64) -> napi::Result<u64> {
    value
        .checked_add(1)
        .ok_or_else(|| failure("physical admission opaque identity exhausted"))
}

fn checked_path(value: &str) -> napi::Result<&Path> {
    if value.is_empty() || value.len() > 32_768 || value.contains('\0') {
        Err(failure(
            "physical admission requires a bounded nonempty OS path",
        ))
    } else {
        Ok(Path::new(value))
    }
}

fn check_capacity(state: &StrongRegistry, owner: u64) -> napi::Result<()> {
    let owned = state
        .records
        .values()
        .filter(|record| record.binding.owner == owner)
        .count()
        + state.pending.values().filter(|&&pending| pending == owner).count();
    if state.records.len() + state.pending.len() >= MAX_PROCESS || owned >= MAX_OWNER {
        Err(failure(
            "physical admission reservation capacity exceeded; existing guards retained",
        ))
    } else {
        Ok(())
    }
}

fn busy(error: &core::Error) -> bool {
    matches!(error, core::Error::Busy(_))
}

fn owned(state: &StrongRegistry, binding: &Binding, slot: u64, kind: u8) -> napi::Result<()> {
    let record = state
        .records
        .get(&slot)
        .ok_or_else(|| failure("physical admission handle is already released or unknown"))?;
    if record.binding.owner != binding.owner || record.binding.id != binding.id {
        return Err(failure(
            "physical admission handle belongs to another owner or binding",
        ));
    }
    let (actual, identity) = match &record.guard {
        Guard::Writer(guard) => (1, guard.identity()),
        Guard::Closing(guard) => (2, guard.identity()),
        Guard::Closed(guard) => (3, guard.identity()),
    };
    if actual != kind || identity != binding.store.identity() {
        return Err(failure(
            "physical admission handle has another lifecycle state",
        ));
    }
    Ok(())
}

#[napi(object)]
pub struct FileIdentityData {
    pub native_format: String,
    pub links: BigInt,
}

#[napi(object)]
pub struct ReservationStatistics {
    pub process_active: u32,
    pub owner_active: u32,
    pub max_process: u32,
    pub max_owner: u32,
}

/// Diagnostic row for one live reservation owned by a registry.
#[napi(object)]
pub struct ReservationInfo {
    /// "writer" | "closing" | "closed"
    pub kind: String,
    pub native_format: String,
    pub age_ms: f64,
}

#[napi]
pub struct PhysicalRegistry {
    owner: u64,
    registry: core::Registry,
}

#[napi]
pub fn mechanical_abi_version() -> u32 {
    2
}

#[napi]
pub fn open_registry(protected_root: String) -> napi::Result<PhysicalRegistry> {
    image_pin::retain().map_err(failure)?;
    let root = core::Registry::open(checked_path(&protected_root)?).map_err(failure)?;
    let mut state = registry()?;
    let owner = next(state.next_owner)?;
    state.next_owner = owner;
    Ok(PhysicalRegistry {
        owner,
        registry: root,
    })
}

#[napi]
impl PhysicalRegistry {
    /// Opens an existing real file. This never opens SQLite or grants path access.
    #[napi]
    pub fn bind_file(&self, existing_path: String) -> napi::Result<BoundStore> {
        let file = File::open(checked_path(&existing_path)?).map_err(failure)?;
        let metadata_file = file.try_clone().map_err(failure)?;
        let store = self.registry.bind(file).map_err(failure)?;
        let admission = admission_lock(store.identity().native_format());
        let mut state = registry()?;
        let id = next(state.next_binding)?;
        state.next_binding = id;
        Ok(BoundStore {
            binding: Arc::new(Binding {
                owner: self.owner,
                id,
                file: metadata_file,
                store,
                admission,
            }),
        })
    }

    /// Diagnostic snapshot of this owner's live reservations, oldest first.
    /// It exposes no slot, handle or other authority and releases nothing: a
    /// lost handle stays held until its owner releases it or the process dies.
    #[napi]
    pub fn list_reservations(&self) -> napi::Result<Vec<ReservationInfo>> {
        let state = registry()?;
        Ok(state
            .records
            .values()
            .filter(|record| record.binding.owner == self.owner)
            .map(|record| ReservationInfo {
                kind: match record.guard {
                    Guard::Writer(_) => "writer",
                    Guard::Closing(_) => "closing",
                    Guard::Closed(_) => "closed",
                }
                .to_owned(),
                native_format: record.binding.store.identity().native_format().to_owned(),
                age_ms: record.created.elapsed().as_millis() as f64,
            })
            .collect())
    }

    #[napi]
    pub fn statistics(&self) -> napi::Result<ReservationStatistics> {
        let state = registry()?;
        Ok(ReservationStatistics {
            process_active: state.records.len() as u32,
            owner_active: state
                .records
                .values()
                .filter(|record| record.binding.owner == self.owner)
                .count() as u32,
            max_process: MAX_PROCESS as u32,
            max_owner: MAX_OWNER as u32,
        })
    }
}

#[napi]
pub struct BoundStore {
    binding: Arc<Binding>,
}

// These classes have NO JS constructors, public fields, identifiers or Drop
// release. Their only authority is native object identity at the private port.
#[napi]
pub struct WriterHandle {
    slot: u64,
}
#[napi]
pub struct ClosingHandle {
    slot: u64,
}
#[napi]
pub struct ClosedHandle {
    slot: u64,
}

#[napi]
impl BoundStore {
    #[napi]
    pub fn identity(&self) -> napi::Result<FileIdentityData> {
        let (identity, links) =
            core::PhysicalFileId::inspect(&self.binding.file).map_err(failure)?;
        Ok(FileIdentityData {
            native_format: identity.native_format().to_owned(),
            links: BigInt::from(links),
        })
    }

    #[napi]
    pub fn try_writer(&self) -> napi::Result<Option<WriterHandle>> {
        // Filesystem admission runs under the per-file admission lock only; the
        // process registry mutex is held just to reserve and to commit.
        let _admission = self.binding.admission.lock().unwrap_or_else(PoisonError::into_inner);
        let pending = Pending::reserve(self.binding.owner)?;
        let guard = match self.binding.store.try_writer() {
            Ok(guard) => guard,
            Err(error) if busy(&error) => return Ok(None),
            Err(error) => return Err(failure(error)),
        };
        let slot = pending.commit(Record {
            binding: Arc::clone(&self.binding),
            guard: Guard::Writer(guard),
            created: Instant::now(),
        });
        Ok(Some(WriterHandle { slot }))
    }

    #[napi]
    pub fn try_begin_close(&self) -> napi::Result<Option<ClosingHandle>> {
        let _admission = self.binding.admission.lock().unwrap_or_else(PoisonError::into_inner);
        let pending = Pending::reserve(self.binding.owner)?;
        let guard = match self.binding.store.try_begin_close() {
            Ok(guard) => guard,
            Err(error) if busy(&error) => return Ok(None),
            Err(error) => return Err(failure(error)),
        };
        let slot = pending.commit(Record {
            binding: Arc::clone(&self.binding),
            guard: Guard::Closing(guard),
            created: Instant::now(),
        });
        Ok(Some(ClosingHandle { slot }))
    }

    #[napi]
    pub fn try_upgrade(&self, closing: &ClosingHandle) -> napi::Result<Option<ClosedHandle>> {
        let _admission = self.binding.admission.lock().unwrap_or_else(PoisonError::into_inner);
        // The record leaves the map only for the filesystem drain attempt. Its
        // slot stays capacity-counted, and EVERY outcome re-inserts the live
        // guard (never dropped), so there is still no ingress gap. A concurrent
        // use of this same handle meanwhile fails as unknown, not as released.
        let (record, pending) = {
            let mut state = registry()?;
            owned(&state, &self.binding, closing.slot, 2)?;
            let record = state
                .records
                .remove(&closing.slot)
                .ok_or_else(|| failure("retained closing handle disappeared"))?;
            let pending = Pending::adopt(&mut state, closing.slot, record.binding.owner);
            (record, pending)
        };
        let Record {
            binding,
            guard,
            created,
        } = record;
        let fence = match guard {
            Guard::Closing(fence) => fence,
            guard => {
                pending.commit(Record {
                    binding,
                    guard,
                    created,
                });
                return Err(failure("invalid retained closing state"));
            }
        };
        match fence.try_upgrade() {
            Ok(closed) => {
                let slot = pending.commit(Record {
                    binding,
                    guard: Guard::Closed(closed),
                    created,
                });
                Ok(Some(ClosedHandle { slot }))
            }
            Err(error) => {
                let (error, fence) = error.into_parts();
                pending.commit(Record {
                    binding,
                    guard: Guard::Closing(fence),
                    created,
                });
                if busy(&error) {
                    Ok(None)
                } else {
                    Err(failure(error))
                }
            }
        }
    }

    #[napi]
    pub fn release_writer(&self, writer: &WriterHandle) -> napi::Result<()> {
        self.release(writer.slot, 1)
    }

    #[napi]
    pub fn release_closing(&self, closing: &ClosingHandle) -> napi::Result<()> {
        self.release(closing.slot, 2)
    }

    #[napi]
    pub fn release_closed(&self, closed: &ClosedHandle) -> napi::Result<()> {
        self.release(closed.slot, 3)
    }
}

impl BoundStore {
    fn release(&self, slot: u64, kind: u8) -> napi::Result<()> {
        let record = {
            let mut state = registry()?;
            owned(&state, &self.binding, slot, kind)?;
            state
                .records
                .remove(&slot)
                .ok_or_else(|| failure("retained admission handle disappeared"))?
        };
        // Explicit private actual-completion handoff only. Never a GC finalizer.
        drop(record);
        Ok(())
    }
}
