//! Per-window batching of Host connection events on their way to the webview.
//!
//! Every `emit_to` is a JS eval, and the sink runs on the connection worker. A busy
//! remote stream therefore used to cost one eval per frame on the socket's own worker.
//! The batcher queues events in arrival order and emits one ordered batch per window.
//! It never drops, merges or reorders events: cursors, snapshots and state changes
//! reach the reducer exactly as received. Connection state, `resync-required` and
//! `closed` frames flush the queue at once (still in order), and a batch is also
//! bounded by event count and approximate bytes. The window timer is a task on
//! Tauri's shared async runtime (#503), not a thread or runtime of its own.
use super::{EventSink, NativeEvent};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

/// Same order of magnitude as the PTY coalesce window: one eval per tick at most.
pub(crate) const HOST_EVENT_BATCH_WINDOW: Duration = Duration::from_millis(8);
const MAX_BATCH_EVENTS: usize = 64;
/// Approximate payload bytes after which a batch flushes without waiting.
const MAX_BATCH_BYTES: usize = 256 * 1024;
const STATE_EVENT_BYTES: usize = 128;

pub(crate) type BatchEmit = Arc<dyn Fn(Vec<NativeEvent>) + Send + Sync>;

#[derive(Default)]
struct Queue {
    events: Vec<NativeEvent>,
    bytes: usize,
    /// A window timer is already scheduled for this queue.
    timer: bool,
}

struct Inner {
    queue: Mutex<Queue>,
    /// Held from dequeue through emit so two flushers cannot swap their batches.
    emit_order: Mutex<()>,
    window: Duration,
    emit: BatchEmit,
}

impl Inner {
    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn flush(&self) {
        let _order = self
            .emit_order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let batch = {
            let mut queue = self.queue();
            queue.bytes = 0;
            std::mem::take(&mut queue.events)
        };
        if !batch.is_empty() {
            (self.emit)(batch);
        }
    }
}

/// Owns one window's queue. Dropping it (the sink was replaced or detached) emits
/// whatever is still queued, so a retired sink never silently loses frames.
pub(crate) struct EventBatcher {
    inner: Arc<Inner>,
}

impl EventBatcher {
    pub(crate) fn new(window: Duration, emit: BatchEmit) -> Self {
        Self {
            inner: Arc::new(Inner {
                queue: Mutex::new(Queue::default()),
                emit_order: Mutex::new(()),
                window,
                emit,
            }),
        }
    }

    pub(crate) fn push(&self, event: NativeEvent) {
        let urgent = is_urgent(&event);
        let weight = approximate_bytes(&event);
        let (flush_now, arm_timer) = {
            let mut queue = self.inner.queue();
            queue.bytes = queue.bytes.saturating_add(weight);
            queue.events.push(event);
            let flush_now = urgent
                || queue.events.len() >= MAX_BATCH_EVENTS
                || queue.bytes >= MAX_BATCH_BYTES;
            let arm_timer = !flush_now && !queue.timer;
            if arm_timer {
                queue.timer = true;
            }
            (flush_now, arm_timer)
        };
        if flush_now {
            self.inner.flush();
        } else if arm_timer {
            let inner = self.inner.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(inner.window).await;
                // Cleared first: an event queued after this flush arms a fresh timer.
                inner.queue().timer = false;
                inner.flush();
            });
        }
    }
}

impl Drop for EventBatcher {
    fn drop(&mut self) {
        self.inner.flush();
    }
}

/// The sink a window attaches to a Host route: events are batched per window.
pub(crate) fn batched_sink(emit: BatchEmit) -> EventSink {
    let batcher = EventBatcher::new(HOST_EVENT_BATCH_WINDOW, emit);
    Arc::new(move |event| batcher.push(event))
}

/// One ordered array of `{machineId, event}` envelopes, the shape the webview router
/// accepts for a tick (a single envelope stays accepted).
pub(crate) fn envelope_batch(machine_id: &str, events: Vec<NativeEvent>) -> Value {
    Value::Array(
        events
            .into_iter()
            .map(|event| json!({"machineId": machine_id, "event": event}))
            .collect(),
    )
}

/// Frames the client must see promptly: connection state and stream invalidation.
fn is_urgent(event: &NativeEvent) -> bool {
    match event {
        NativeEvent::State { .. } => true,
        NativeEvent::Subscription { event, .. } => matches!(
            event.pointer("/params/kind").and_then(Value::as_str),
            Some("resync-required" | "closed")
        ),
    }
}

fn approximate_bytes(event: &NativeEvent) -> usize {
    match event {
        NativeEvent::State { .. } => STATE_EVENT_BYTES,
        NativeEvent::Subscription { event, .. } => value_bytes(event, MAX_BATCH_BYTES),
    }
}

/// Rough JSON size without serializing; stops walking once `limit` is reached.
fn value_bytes(value: &Value, limit: usize) -> usize {
    let mut total = 0usize;
    let mut stack = vec![value];
    while let Some(value) = stack.pop() {
        if total >= limit {
            break;
        }
        match value {
            Value::String(text) => total += text.len() + 2,
            Value::Array(items) => {
                total += 2 + items.len();
                stack.extend(items);
            }
            Value::Object(fields) => {
                total += 2;
                for (key, item) in fields {
                    total += key.len() + 4;
                    stack.push(item);
                }
            }
            _ => total += 8,
        }
    }
    total
}

#[cfg(test)]
#[path = "event_batch_tests.rs"]
mod tests;
