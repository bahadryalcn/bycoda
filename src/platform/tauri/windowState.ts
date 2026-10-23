import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { retainAsyncSubscription } from "../../shared/lib/asyncSubscription";

/** What the native window reports; the one source for every window-state consumer. */
export type NativeWindowState = {
  maximized: boolean;
  fullscreen: boolean;
  visible: boolean;
  minimized: boolean;
  focused: boolean;
};

let state: NativeWindowState | null = null;
/** The latest read that was started, and the read the current state came from. */
let started = 0;
let applied = 0;
/** The read that was current when the last native focus payload arrived. */
let focusPayloadAt = -1;
let inFlight = false;
let pending = false;
let releaseNative: (() => void) | undefined;
const stateListeners = new Set<() => void>();
const focusListeners = new Set<(focused: boolean) => void>();

const report = (error: unknown) => console.warn("Native window state unavailable", error);

function notifyState() {
  for (const listener of stateListeners) listener();
}

function same(a: NativeWindowState | null, b: NativeWindowState) {
  return (
    !!a &&
    a.maximized === b.maximized &&
    a.fullscreen === b.fullscreen &&
    a.visible === b.visible &&
    a.minimized === b.minimized &&
    a.focused === b.focused
  );
}

function settle<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

/**
 * Reads every field once and publishes a change. The latest read wins; a field
 * whose read fails keeps its last value. A native focus payload that arrived after
 * this read started is newer than the focus it read, so it is kept.
 */
export async function refreshWindowState(): Promise<NativeWindowState | null> {
  const sequence = ++started;
  const win = getCurrentWindow();
  // Start each read now; one that throws (an unsupported query) only loses its field.
  const read = (query: () => Promise<boolean>) => {
    try {
      return query();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const results = await Promise.allSettled([
    read(() => win.isMaximized()),
    read(() => win.isFullscreen()),
    read(() => win.isVisible()),
    read(() => win.isMinimized()),
    read(() => win.isFocused()),
  ]);
  if (sequence !== started) return state;
  if (results.every((result) => result.status === "rejected"))
    throw (results[0] as PromiseRejectedResult).reason;
  const previous = state;
  const next: NativeWindowState = {
    maximized: settle(results[0], previous?.maximized ?? false),
    fullscreen: settle(results[1], previous?.fullscreen ?? false),
    visible: settle(results[2], previous?.visible ?? true),
    minimized: settle(results[3], previous?.minimized ?? false),
    focused:
      previous && focusPayloadAt >= sequence
        ? previous.focused
        : settle(results[4], previous?.focused ?? true),
  };
  applied = sequence;
  if (!same(previous, next)) {
    state = next;
    notifyState();
  }
  return state;
}

/** Resize and focus bursts collapse: one read at a time, plus one after it if more
 * events arrived while it ran. */
function scheduleRefresh() {
  if (inFlight) {
    pending = true;
    return;
  }
  inFlight = true;
  void refreshWindowState()
    .catch(report)
    .finally(() => {
      inFlight = false;
      if (pending && releaseNative) {
        pending = false;
        scheduleRefresh();
      }
    });
}

function onFocusChanged(focused: boolean) {
  focusPayloadAt = started;
  for (const listener of focusListeners) listener(focused);
  if (state && state.focused !== focused) {
    state = { ...state, focused };
    notifyState();
  }
  scheduleRefresh();
}

function retain() {
  if (releaseNative) return;
  const win = getCurrentWindow();
  const releases = [
    retainAsyncSubscription(win.onResized(scheduleRefresh), report),
    retainAsyncSubscription(
      win.onFocusChanged(({ payload }) => onFocusChanged(payload)),
      report,
    ),
  ];
  releaseNative = () => releases.forEach((release) => release());
  scheduleRefresh();
}

function releaseIfUnused() {
  if (stateListeners.size || focusListeners.size || !releaseNative) return;
  releaseNative();
  releaseNative = undefined;
  pending = false;
  state = null;
}

/** One onResized and one onFocusChanged listener for the whole window. */
export function subscribeWindowState(listener: () => void): () => void {
  const subscription = () => listener();
  stateListeners.add(subscription);
  retain();
  return () => {
    stateListeners.delete(subscription);
    releaseIfUnused();
  };
}

/** Native focus payloads as they arrive; they are authoritative over a stale read. */
export function subscribeWindowFocus(listener: (focused: boolean) => void): () => void {
  const subscription = (focused: boolean) => listener(focused);
  focusListeners.add(subscription);
  retain();
  return () => {
    focusListeners.delete(subscription);
    releaseIfUnused();
  };
}

export function getWindowState(): NativeWindowState | null {
  return state;
}

/** The read the current state came from, and the latest read started. */
export function windowStateReads(): { applied: number; started: number } {
  return { applied, started };
}

export function useNativeWindowState(): NativeWindowState | null {
  return useSyncExternalStore(subscribeWindowState, getWindowState, () => null);
}
