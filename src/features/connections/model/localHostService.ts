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

/** This computer's host state. A host restarting itself is briefly silent, so
 * `stopped` is reported only after two polls in a row agree. */
export function useLocalHostState(): LocalHostState | undefined {
  const [state, setState] = useState<LocalHostState>();
  useEffect(() => {
    let cancelled = false;
    let previous: LocalHostState | undefined;
    const load = () =>
      invoke<{ state: LocalHostState } | null>("local_host_status").then(
        (status) => {
          const next = status?.state;
          if (cancelled) return;
          if (!next) {
            previous = undefined;
            setState(undefined);
            return;
          }
          if (next !== "stopped" || previous === "stopped") setState(next);
          previous = next;
        },
        () => {
          if (cancelled) return;
          previous = undefined;
          setState(undefined);
        },
      );
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return state;
}
