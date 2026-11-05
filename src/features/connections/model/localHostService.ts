import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { RemoteMachine } from "./protocol";
import { notifyRemoteRecovered } from "./remoteHealth";

/** `stopped` requires evidence the host is down; failed health checks are `unknown`. */
export type LocalHostState = "absent" | "running" | "stopped" | "updating" | "unknown";

const POLL_MS = 15_000;

/** Starts this computer's stopped host and lets every view reload from it.
 * Rejects with the host's reason when it could not be started. */
export async function startLocalHost(): Promise<void> {
  const machine = await invoke<RemoteMachine | null>("local_host_start");
  notifyRemoteRecovered(machine?.environmentId);
}

type LocalHostListener = (state: LocalHostState | undefined) => void;

// One poller serves every consumer. It runs only while the document is visible and
// refreshes at once when it becomes visible again.
const localHostListeners = new Set<LocalHostListener>();
let localHostCurrent: LocalHostState | undefined;
let localHostPrevious: LocalHostState | undefined;
let localHostTimer: number | undefined;
let localHostSession = 0;

function publishLocalHost(next: LocalHostState | undefined) {
  localHostCurrent = next;
  for (const listener of localHostListeners) listener(next);
}

function loadLocalHost(): Promise<void> {
  const session = localHostSession;
  return invoke<{ state: LocalHostState } | null>("local_host_status").then(
    (status) => {
      if (session !== localHostSession) return;
      const next = status?.state;
      if (!next) {
        localHostPrevious = undefined;
        publishLocalHost(undefined);
        return;
      }
      if (next !== "stopped" || localHostPrevious === "stopped") publishLocalHost(next);
      localHostPrevious = next;
    },
    () => {
      if (session !== localHostSession) return;
      localHostPrevious = undefined;
      publishLocalHost(undefined);
    },
  );
}

function syncLocalHostPolling() {
  if (!localHostListeners.size) return;
  if (document.hidden) {
    window.clearInterval(localHostTimer);
    localHostTimer = undefined;
    return;
  }
  if (localHostTimer !== undefined) return;
  void loadLocalHost();
  localHostTimer = window.setInterval(() => void loadLocalHost(), POLL_MS);
}

function subscribeLocalHost(listener: LocalHostListener): () => void {
  if (!localHostListeners.size) document.addEventListener("visibilitychange", syncLocalHostPolling);
  localHostListeners.add(listener);
  if (localHostCurrent !== undefined) listener(localHostCurrent);
  syncLocalHostPolling();
  return () => {
    if (!localHostListeners.delete(listener) || localHostListeners.size) return;
    document.removeEventListener("visibilitychange", syncLocalHostPolling);
    window.clearInterval(localHostTimer);
    localHostTimer = undefined;
    // Results still in flight belong to the ended session and are ignored.
    localHostSession++;
    localHostCurrent = undefined;
    localHostPrevious = undefined;
  };
}

/** This computer's host state. A host restarting itself is briefly silent, so
 * `stopped` is reported only after two polls in a row agree. */
export function useLocalHostState(): LocalHostState | undefined {
  const [state, setState] = useState<LocalHostState>();
  useEffect(() => subscribeLocalHost(setState), []);
  return state;
}
