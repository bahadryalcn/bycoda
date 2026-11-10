import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type BundledHostStatus = {
  state: string;
  message?: string | null;
  bundled?: string | null;
  installed?: string | null;
};

const refreshers = new Set<() => void>();

/**
 * Update this computer's Host now. Call only after the owner confirmed that running
 * sessions and shells are interrupted; resolves with the installer's resulting status.
 */
export async function updateBundledHostNow(): Promise<BundledHostStatus | null> {
  try {
    return await invoke<BundledHostStatus | null>("local_host_bundle_update");
  } finally {
    for (const refresh of refreshers) refresh();
  }
}

/** Observe the installer without starting or interrupting a Host update. */
export function useBundledHostStatus(active = true) {
  const [status, setStatus] = useState<BundledHostStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () =>
      invoke<BundledHostStatus | null>("local_host_bundle_status").then(
        (value) => {
          if (!cancelled) setStatus(value);
        },
        () => {
          if (!cancelled) setStatus(null);
        },
      );
    void load();
    refreshers.add(load);
    const timer = window.setInterval(() => void load(), 15_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      refreshers.delete(load);
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [active]);
  return active ? status : null;
}

export function bundledHostWaitsForSessions(status: BundledHostStatus | null) {
  return (
    status?.state === "deferred" &&
    status.message === "The host update waits until running sessions finish."
  );
}
