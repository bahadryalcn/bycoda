import { useEffect, useEffectEvent, useState } from "react";
import {
  canRevokePairedDevices,
  loadPairedDevices,
  type PairedDeviceList,
} from "../model/pairedDevices";
import { isMachineEnabled } from "../model/machineEnabled";
import type { RemoteMachine } from "../model/protocol";
import { blocksSending } from "../model/remoteConnection";
import { readRemoteConnection } from "../model/remoteHealth";
import { errorText } from "../../../shared/lib/errors";
import { wallClockNow } from "../../../shared/lib/time/wallClock";

/** The entry key of a computer: its saved id and the Host identity it answers as. */
export const entryKey = (machine: RemoteMachine) => `${machine.id}:${machine.environmentId}`;

/** The device list is re-read this often while the tab is visible. */
export const PAIRED_DEVICES_REFRESH_MS = 30_000;

export type PairedDevicesEntry =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | {
      phase: "ready";
      list: PairedDeviceList;
      canRevoke: boolean;
      /** When this list was last read from the Host. */
      updatedAt: number;
      /** The latest refresh failed, so the list shown is the last good one, not current. */
      stale?: boolean;
    };

/** A computer the periodic refresh leaves alone: turned off here, or known not to answer. */
const isIdleMachine = (machine: RemoteMachine) =>
  !isMachineEnabled(machine.environmentId) ||
  blocksSending(readRemoteConnection(machine.environmentId).status);

/**
 * Each computer's paired devices, read while `active` and refreshed every 30 s. A failed
 * refresh keeps the last good list for that computer, marked stale with when it was read;
 * only a first failure shows the error. The periodic refresh skips computers known to be
 * down; opening the tab, Refresh and Retry still ask every one.
 */
export function usePairedDevices(machines: RemoteMachine[], active: boolean) {
  const [entries, setEntries] = useState<Record<string, PairedDevicesEntry>>({});
  const [generation, setGeneration] = useState(0);
  const key = machines.map(entryKey).join("|");

  const read = useEffectEvent((isCurrent: () => boolean, periodic: boolean) => {
    const keep = new Set(machines.map(entryKey));
    // Entries of computers that were removed are dropped with the next write.
    const write = (
      id: string,
      next: (entry: PairedDevicesEntry | undefined) => PairedDevicesEntry,
    ) =>
      setEntries((current) => ({
        ...Object.fromEntries(Object.entries(current).filter(([entry]) => keep.has(entry))),
        [id]: next(current[id]),
      }));
    for (const machine of machines) {
      if (periodic && isIdleMachine(machine)) continue;
      // Keyed by Host identity too: a connection rebound to another Host never shows the old list.
      const id = entryKey(machine);
      void Promise.all([loadPairedDevices(machine), canRevokePairedDevices(machine)]).then(
        ([list, canRevoke]) => {
          if (isCurrent())
            write(id, () => ({ phase: "ready", list, canRevoke, updatedAt: wallClockNow() }));
        },
        (reason: unknown) => {
          if (!isCurrent()) return;
          write(id, (entry) =>
            entry?.phase === "ready"
              ? { ...entry, stale: true }
              : { phase: "error", error: errorText(reason) },
          );
        },
      );
    }
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- A polling timer against the Hosts while the tab shows; a hidden tab or changed machine list stops the old loop.
  useEffect(() => {
    if (!active) return;
    let current = true;
    read(() => current, false);
    const timer = setInterval(() => {
      if (!document.hidden) read(() => current, true);
    }, PAIRED_DEVICES_REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [active, key, generation]);

  return {
    entries,
    refresh: () => setGeneration((value) => value + 1),
  };
}
