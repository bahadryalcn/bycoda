type ResizeListener = (entry: ResizeObserverEntry) => void;

interface Subscription {
  readonly listener: ResizeListener;
  active: boolean;
}

interface Target {
  readonly subscriptions: Set<Subscription>;
  last: ResizeObserverEntry | null;
}

let observer: ResizeObserver | null = null;
const targets = new Map<Element, Target>();

function notify(subscription: Subscription, entry: ResizeObserverEntry) {
  if (!subscription.active) return;
  try {
    subscription.listener(entry);
  } catch (error) {
    // One failing listener must not starve the others of this batch.
    queueMicrotask(() => {
      throw error;
    });
  }
}

function deliver(entries: readonly ResizeObserverEntry[]) {
  for (const entry of entries) {
    const target = targets.get(entry.target);
    if (!target) continue;
    target.last = entry;
    for (const subscription of target.subscriptions) notify(subscription, entry);
  }
}

/**
 * Observes an element's size through one ResizeObserver shared by the whole window, so a
 * list of measuring components costs one observer and one callback per frame instead of
 * one each. Like a native observer, the listener gets a first entry right after
 * subscribing. Returns the unsubscribe function. Rule bycoda/shared-resize-observer.
 */
export function observeResize(element: Element, listener: ResizeListener): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const shared = (observer ??= new ResizeObserver(deliver));
  const subscription: Subscription = { listener, active: true };
  const target = targets.get(element);
  if (!target) {
    targets.set(element, { subscriptions: new Set([subscription]), last: null });
    shared.observe(element);
  } else {
    target.subscriptions.add(subscription);
    // The observer already reported this element and stays silent until it resizes again.
    queueMicrotask(() => {
      if (target.last) notify(subscription, target.last);
    });
  }
  return () => {
    if (!subscription.active) return;
    subscription.active = false;
    const current = targets.get(element);
    if (!current?.subscriptions.delete(subscription) || current.subscriptions.size > 0) return;
    targets.delete(element);
    if (targets.size > 0) {
      shared.unobserve(element);
      return;
    }
    shared.disconnect();
    observer = null;
  };
}
