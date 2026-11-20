import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type BundledHostStatus = {
  state: string;
  /** Display text only; branch on `reason`, never on this. */
  message?: string | null;
  /** Machine-readable cause of a deferred state, set by the native installer. */
  reason?: string | null;
  bundled?: string | null;
  installed?: string | null;
};

const POLL_MS = 15_000;

type BundledHostListener = (status: BundledHostStatus | null) => void;

// One poller serves every consumer. It runs only while the document is visible and
// refreshes at once when it becomes visible again or the window gains focus.
const bundledHostListeners = new Set<BundledHostListener>();
let bundledHostCurrent: BundledHostStatus | null = null;
let bundledHostTimer: number | undefined;
let bundledHostSession = 0;
// Only the newest request may publish, so a slow older answer cannot overwrite a fresher one.
let bundledHostLatestRequest = 0;

function publishBundledHost(next: BundledHostStatus | null) {
  bundledHostCurrent = next;
  for (const listener of bundledHostListeners) listener(next);
}

function loadBundledHost(): Promise<void> {
  const session = bundledHostSession;
  const request = ++bundledHostLatestRequest;
  const current = () => session === bundledHostSession && request === bundledHostLatestRequest;
  return invoke<BundledHostStatus | null>("local_host_bundle_status").then(
    (value) => {
      if (current()) publishBundledHost(value);
    },
    () => {
      if (current()) publishBundledHost(null);
    },
  );
}

function syncBundledHostPolling() {
  if (!bundledHostListeners.size) return;
  if (document.hidden) {
    window.clearInterval(bundledHostTimer);
    bundledHostTimer = undefined;
    return;
  }
  if (bundledHostTimer !== undefined) return;
  const load = () =>
    void loadBundledHost().catch((error: unknown) =>
      console.warn("Bundled host status poll failed", error),
    );
  load();
  bundledHostTimer = window.setInterval(load, POLL_MS);
}

function refreshBundledHostOnFocus() {
  if (!document.hidden) void loadBundledHost();
}

function subscribeBundledHost(listener: BundledHostListener): () => void {
  if (!bundledHostListeners.size) {
    document.addEventListener("visibilitychange", syncBundledHostPolling);
    window.addEventListener("focus", refreshBundledHostOnFocus);
  }
  bundledHostListeners.add(listener);
  // Always hand over the shared value, so a consumer that re-activates after the poller
  // stopped never keeps a status from an ended session.
  listener(bundledHostCurrent);
  syncBundledHostPolling();
  return () => {
    if (!bundledHostListeners.delete(listener) || bundledHostListeners.size) return;
    document.removeEventListener("visibilitychange", syncBundledHostPolling);
    window.removeEventListener("focus", refreshBundledHostOnFocus);
    window.clearInterval(bundledHostTimer);
    bundledHostTimer = undefined;
    // Results still in flight belong to the ended session and are ignored.
    bundledHostSession++;
    bundledHostCurrent = null;
  };
}

/**
 * Update this computer's Host now. Call only after the owner confirmed that running
 * sessions and shells are interrupted; resolves with the installer's resulting status.
 */
export async function updateBundledHostNow(): Promise<BundledHostStatus | null> {
  try {
    return await invoke<BundledHostStatus | null>("local_host_bundle_update");
  } finally {
    if (bundledHostListeners.size) void loadBundledHost();
  }
}

/** Observe the installer without starting or interrupting a Host update. */
export function useBundledHostStatus(active = true) {
  const [status, setStatus] = useState<BundledHostStatus | null>(null);
  useEffect(() => {
    // Subscribes to the shared poller so consumers share one native call per tick.
    if (!active) return;
    return subscribeBundledHost(setStatus);
  }, [active]);
  return active ? status : null;
}

export function bundledHostWaitsForSessions(status: BundledHostStatus | null) {
  return status?.state === "deferred" && status.reason === "waiting-for-sessions";
}
