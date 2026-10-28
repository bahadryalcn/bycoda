use super::QuickLaunch;
use serde::Serialize;
use std::collections::VecDeque;

#[derive(Clone, Serialize)]
pub struct Delivery {
    pub id: String,
    pub request: QuickLaunch,
}

struct Pending {
    delivery: Delivery,
    owner: String,
    source_store: Option<uuid::Uuid>,
}

#[derive(Default)]
pub struct LaunchQueue(VecDeque<Pending>);

impl LaunchQueue {
    pub fn has_capacity(&self) -> bool {
        self.0.len() < 64
    }

    pub fn push(&mut self, request: QuickLaunch, owner: String) {
        self.push_reserved(request, owner, uuid::Uuid::new_v4().to_string(), None);
    }

    pub(crate) fn push_reserved(
        &mut self,
        request: QuickLaunch,
        owner: String,
        id: String,
        source_store: Option<uuid::Uuid>,
    ) {
        self.0.push_back(Pending {
            delivery: Delivery { id, request },
            owner,
            source_store,
        });
    }

    // Claims are repeatable until acknowledged. Only the owning window can
    // accept a delivery; a destroyed owner can be replaced by a live window.
    #[cfg(test)]
    pub fn claim(&mut self, window: &str, exists: impl Fn(&str) -> bool) -> Option<Delivery> {
        self.claim_for_store(window, None, exists)
    }

    pub(crate) fn claim_for_store(
        &mut self,
        window: &str,
        store: Option<uuid::Uuid>,
        exists: impl Fn(&str) -> bool,
    ) -> Option<Delivery> {
        let next = self.0.iter_mut().find(|entry| {
            (entry.source_store.is_none() || entry.source_store == store)
                && (entry.owner == window || !exists(&entry.owner))
        })?;
        next.owner = window.to_owned();
        Some(next.delivery.clone())
    }

    #[cfg(test)]
    pub fn acknowledge(&mut self, window: &str, id: &str) -> bool {
        self.acknowledge_in_store(window, id, None)
    }

    pub(crate) fn acknowledge_in_store(
        &mut self,
        window: &str,
        id: &str,
        store: Option<uuid::Uuid>,
    ) -> bool {
        let before = self.0.len();
        self.0.retain(|entry| {
            !(entry.owner == window
                && entry.delivery.id == id
                && (store.is_none() || entry.source_store.is_none() || entry.source_store == store))
        });
        before != self.0.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(prompt: &str) -> QuickLaunch {
        serde_json::from_value(serde_json::json!({
            "prompt": prompt, "cwd": "/repo", "harness": "codex", "reveal": false
        }))
        .unwrap()
    }
    #[test]
    fn launch_mode_fields_survive_the_bridge() {
        let launch: QuickLaunch = serde_json::from_value(serde_json::json!({
            "prompt": "p", "cwd": "/repo", "harness": "codex", "reveal": false,
            "draft": true, "intent": "plan"
        }))
        .unwrap();
        let value = serde_json::to_value(&launch).unwrap();
        assert_eq!(value["draft"], true);
        assert_eq!(value["intent"], "plan");
        let plain = serde_json::to_value(request("p")).unwrap();
        assert!(plain.get("draft").is_none() && plain.get("intent").is_none());
    }
    #[test]
    fn consecutive_submissions_wait_for_successful_acknowledgement() {
        let mut queue = LaunchQueue::default();
        queue.push(request("first"), "booting".into());
        queue.push(request("second"), "booting".into());
        let first = queue.claim("booting", |_| true).unwrap();
        assert_eq!(first.request.prompt, "first");
        assert_eq!(queue.claim("booting", |_| true).unwrap().id, first.id);
        queue.acknowledge("other", &first.id);
        assert_eq!(queue.claim("booting", |_| true).unwrap().id, first.id);
        queue.acknowledge("booting", &first.id);
        let second = queue.claim("booting", |_| true).unwrap();
        assert_eq!(second.request.prompt, "second");
        assert_ne!(first.id, second.id);
        queue.acknowledge("booting", &first.id); // lost ACK response / retry
        assert_eq!(queue.claim("booting", |_| true).unwrap().id, second.id);
        queue.acknowledge("booting", &second.id);
        assert!(queue.claim("booting", |_| true).is_none());
    }
    #[test]
    fn retains_other_windows_requests_and_reassigns_only_destroyed_owners() {
        let mut queue = LaunchQueue::default();
        queue.push(request("one"), "one".into());
        queue.push(request("two"), "two".into());
        assert!(queue.claim("three", |_| true).is_none());
        let two = queue.claim("two", |_| true).unwrap();
        queue.acknowledge("two", &two.id);
        let recovered = queue.claim("three", |owner| owner != "one").unwrap();
        assert_eq!(recovered.request.prompt, "one");
        assert!(queue.claim("two", |_| true).is_none());
    }
}
