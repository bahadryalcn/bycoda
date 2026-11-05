//! Private mechanical file/lease bridge plus a separate SQLite identity entry.
//! Neither creates application permission or complete writer enrollment.
//! Live guards belong to a pinned process-native registry, not JavaScript GC.
mod image_pin;
mod rename_no_replace;
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
    sync::{Arc, Mutex, MutexGuard, OnceLock},
};

const MAX_OWNER: usize = 64;
const MAX_PROCESS: usize = 256;

#[derive(Default)]
struct StrongRegistry {
    next_owner: u64,
    next_binding: u64,
    next_slot: u64,
    records: BTreeMap<u64, Record>,
}

struct Binding {
    owner: u64,
    id: u64,
    file: File,
    store: core::PhysicalStore,
}

enum Guard {
    Writer(core::WriterReservation),
    Closing(core::ClosingFence),
    Closed(core::ClosedFence),
}

struct Record {
    binding: Arc<Binding>,
    guard: Guard,
}

fn failure(reason: impl ToString) -> napi::Error {
    napi::Error::from_reason(reason.to_string())
}

fn registry() -> napi::Result<MutexGuard<'static, StrongRegistry>> {
    static STATE: OnceLock<Mutex<StrongRegistry>> = OnceLock::new();
    STATE
        .get_or_init(|| Mutex::new(StrongRegistry::default()))
        .lock()
        .map_err(|_| {
            failure("physical admission process registry is poisoned; retained guards remain held")
        })
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
    if state.records.len() >= MAX_PROCESS
        || state
            .records
            .values()
            .filter(|record| record.binding.owner == owner)
            .count()
            >= MAX_OWNER
    {
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
        let mut state = registry()?;
        let id = next(state.next_binding)?;
        state.next_binding = id;
        Ok(BoundStore {
            binding: Arc::new(Binding {
                owner: self.owner,
                id,
                file: metadata_file,
                store,
            }),
        })
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
        let mut state = registry()?;
        check_capacity(&state, self.binding.owner)?;
        let slot = next(state.next_slot)?;
        let guard = match self.binding.store.try_writer() {
            Ok(guard) => guard,
            Err(error) if busy(&error) => return Ok(None),
            Err(error) => return Err(failure(error)),
        };
        state.next_slot = slot;
        state.records.insert(
            slot,
            Record {
                binding: Arc::clone(&self.binding),
                guard: Guard::Writer(guard),
            },
        );
        Ok(Some(WriterHandle { slot }))
    }

    #[napi]
    pub fn try_begin_close(&self) -> napi::Result<Option<ClosingHandle>> {
        let mut state = registry()?;
        check_capacity(&state, self.binding.owner)?;
        let slot = next(state.next_slot)?;
        let guard = match self.binding.store.try_begin_close() {
            Ok(guard) => guard,
            Err(error) if busy(&error) => return Ok(None),
            Err(error) => return Err(failure(error)),
        };
        state.next_slot = slot;
        state.records.insert(
            slot,
            Record {
                binding: Arc::clone(&self.binding),
                guard: Guard::Closing(guard),
            },
        );
        Ok(Some(ClosingHandle { slot }))
    }

    #[napi]
    pub fn try_upgrade(&self, closing: &ClosingHandle) -> napi::Result<Option<ClosedHandle>> {
        let mut state = registry()?;
        owned(&state, &self.binding, closing.slot, 2)?;
        let record = state
            .records
            .remove(&closing.slot)
            .ok_or_else(|| failure("retained closing handle disappeared"))?;
        let fence = match record.guard {
            Guard::Closing(fence) => fence,
            guard => {
                state.records.insert(
                    closing.slot,
                    Record {
                        binding: record.binding,
                        guard,
                    },
                );
                return Err(failure("invalid retained closing state"));
            }
        };
        match fence.try_upgrade() {
            Ok(closed) => {
                state.records.insert(
                    closing.slot,
                    Record {
                        binding: record.binding,
                        guard: Guard::Closed(closed),
                    },
                );
                Ok(Some(ClosedHandle { slot: closing.slot }))
            }
            Err(error) => {
                let (error, fence) = error.into_parts();
                state.records.insert(
                    closing.slot,
                    Record {
                        binding: record.binding,
                        guard: Guard::Closing(fence),
                    },
                );
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
