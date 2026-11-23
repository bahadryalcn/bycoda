use crate::host_ws::HostWsBroker;
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

// '#' cannot occur in a Tauri window label.
pub(super) fn owner(window: &str) -> String {
    format!("#list:{window}")
}

#[derive(Default)]
struct Demand {
    pending: usize,
    stream_detached: bool,
}

#[derive(Default)]
pub(super) struct WindowLists(Mutex<HashMap<(String, String), Demand>>);

pub(super) struct Read<'a> {
    lists: &'a WindowLists,
    broker: &'a HostWsBroker,
    key: (String, String),
    pub owner: String,
}

impl WindowLists {
    pub fn begin<'a>(
        &'a self,
        broker: &'a HostWsBroker,
        machine: &str,
        window: &str,
        method: &str,
    ) -> Option<Read<'a>> {
        if !matches!(method, "projects.list" | "sessions.list") {
            return None;
        }
        let key = (machine.to_owned(), window.to_owned());
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key.clone())
            .or_default()
            .pending += 1;
        Some(Read {
            lists: self,
            broker,
            key,
            owner: owner(window),
        })
    }

    /// A stream release also retires its warm list connection, after independent
    /// reads already admitted by this window have finished disclosing their answers.
    pub fn detach_stream(&self, broker: &HostWsBroker, machine: &str, window: &str) {
        let mut calls = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        broker.detach_machine(machine, window);
        if let Some(demand) = calls.get_mut(&(machine.to_owned(), window.to_owned())) {
            demand.stream_detached = true;
        } else {
            broker.detach_machine(machine, &owner(window));
        }
    }
}

impl Drop for Read<'_> {
    fn drop(&mut self) {
        let mut calls = self.lists.0.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(demand) = calls.get_mut(&self.key) else {
            return;
        };
        demand.pending -= 1;
        if demand.pending == 0 {
            if demand.stream_detached {
                self.broker.detach_machine(&self.key.0, &self.owner);
            }
            calls.remove(&self.key);
        }
    }
}
