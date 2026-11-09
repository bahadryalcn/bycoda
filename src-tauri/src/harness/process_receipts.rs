//! Bounded, private original construction ownership after route removal. Public
//! epochs only select a retained record; they cannot manufacture its drain proof.
use super::{LiveChild, ManagedProviderExit};
use std::collections::VecDeque;
use std::sync::Arc;

const MAX_CONSTRUCTIONS: usize = 512;

struct Retained {
    route: String,
    exit: Arc<ManagedProviderExit>,
    live: Option<Arc<LiveChild>>,
}

#[derive(Default)]
pub(super) struct ProcessReceipts {
    records: VecDeque<Retained>,
}

impl ProcessReceipts {
    /// Called under HarnessInner before lease admission or OS process creation.
    /// Any settled original (succeeded or failed) may make room; only still-pending
    /// owners are kept, so failed cleanups cannot exhaust capacity and block spawns.
    pub(super) fn capacity(&mut self) -> Result<(), String> {
        self.records.retain(|record| !record.exit.succeeded());
        if self.records.len() >= MAX_CONSTRUCTIONS {
            let settled = self
                .records
                .iter()
                .position(|record| record.exit.settled())
                .ok_or("NATIVE_PROCESS_RECEIPT_CAPACITY")?;
            self.records.remove(settled);
        }
        Ok(())
    }

    /// Reservation precedes route retirement and process creation.
    pub(super) fn reserve(&mut self, route: &str, exit: Arc<ManagedProviderExit>) {
        self.records.push_back(Retained {
            route: route.into(),
            exit,
            live: None,
        });
    }

    pub(super) fn reserved(&self, route: &str, exit: &Arc<ManagedProviderExit>) -> bool {
        self.records.iter().any(|record| {
            record.route == route && Arc::ptr_eq(&record.exit, exit) && record.live.is_none()
        })
    }

    pub(super) fn release_unstarted(&mut self, exit: &Arc<ManagedProviderExit>) {
        self.records
            .retain(|record| !Arc::ptr_eq(&record.exit, exit));
    }

    pub(super) fn bind(&mut self, route: &str, live: &Arc<LiveChild>) -> Result<(), String> {
        let exit = live
            .exit
            .as_ref()
            .ok_or("NATIVE_PROCESS_SETTLEMENT_MISSING")?;
        if let Some(record) = self
            .records
            .iter_mut()
            .find(|record| Arc::ptr_eq(&record.exit, exit))
        {
            if record.route != route
                || record
                    .live
                    .as_ref()
                    .is_some_and(|old| !Arc::ptr_eq(old, live))
            {
                return Err("NATIVE_PROCESS_RECEIPT_CONFLICT".into());
            }
            record.live = Some(live.clone());
            return Ok(());
        }
        // Native production always reserves at physical spawn. Test fixtures may
        // publish an already owned real child; they obey the same retention cap.
        self.capacity()?;
        self.records.push_back(Retained {
            route: route.into(),
            exit: exit.clone(),
            live: Some(live.clone()),
        });
        Ok(())
    }

    pub(super) fn original(&self, route: &str, construction: &str) -> Option<Arc<LiveChild>> {
        self.records
            .iter()
            .filter(|record| record.route == route)
            .filter_map(|record| record.live.as_ref())
            .find(|live| live.construction_id == construction)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_capacity_cannot_evict_or_admit_another_physical_owner() {
        let mut receipts = ProcessReceipts::default();
        let held = Arc::new(ManagedProviderExit::default());
        for _ in 0..MAX_CONSTRUCTIONS {
            receipts.capacity().unwrap();
            receipts.reserve("same-route", held.clone());
        }
        assert_eq!(
            receipts.capacity().unwrap_err(),
            "NATIVE_PROCESS_RECEIPT_CAPACITY"
        );
        assert_eq!(receipts.records.len(), MAX_CONSTRUCTIONS);
        held.finish(Err("actual original drain unknown".into()));
        receipts.capacity().unwrap();
        assert_eq!(receipts.records.len(), MAX_CONSTRUCTIONS - 1);
        let pending = Arc::new(ManagedProviderExit::default());
        receipts.reserve("new-route", pending.clone());
        receipts.capacity().unwrap();
        assert!(receipts
            .records
            .iter()
            .any(|r| Arc::ptr_eq(&r.exit, &pending)));
        assert_eq!(receipts.records.len(), MAX_CONSTRUCTIONS - 1);
    }
}
