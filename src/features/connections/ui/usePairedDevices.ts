import { useEffect, useEffectEvent, useState } from "react";
import {
  canRevokePairedDevices,
  loadPairedDevices,
  type PairedDeviceList,
} from "../model/pairedDevices";
import type { RemoteMachine } from "../model/protocol";

/** The entry key of a computer: its saved id and the Host identity it answers as. */
export const entryKey = (machine: RemoteMachine) => `${machine.id}:${machine.environmentId}`;

/** The device list is re-read this often while the tab is visible. */
export const PAIRED_DEVICES_REFRESH_MS = 30_000;

export type PairedDevicesEntry =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; list: PairedDeviceList; canRevoke: boolean };

/**
 * Each computer's paired devices, read while `active` and refreshed every 30 s. A failed
 * refresh keeps the last good list for that computer; only a first failure shows the error.
 */
export function usePairedDevices(machines: RemoteMachine[], active: boolean) {
  const [entries, setEntries] = useState<Record<string, PairedDevicesEntry>>({});
  const [generation, setGeneration] = useState(0);
  const key = machines.map(entryKey).join("|");

  const read = useEffectEvent((isCurrent: () => boolean) => {
    for (const machine of machines) {
      // Keyed by Host identity too: a connection rebound to another Host never shows the old list.
      const id = entryKey(machine);
      void Promise.all([loadPairedDevices(machine), canRevokePairedDevices(machine)]).then(
        ([list, canRevoke]) => {
          if (isCurrent())
            setEntries((current) => ({
              ...current,
              [id]: { phase: "ready", list, canRevoke },
            }));
        },
        (reason: unknown) => {
          if (!isCurrent()) return;
          setEntries((current) =>
            current[id]?.phase === "ready"
              ? current
              : {
                  ...current,
                  [id]: {
                    phase: "error",
                    error: reason instanceof Error ? reason.message : String(reason),
                  },
                },
          );
        },
      );
    }
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- A polling timer against the Hosts while the tab shows; a hidden tab or changed machine list stops the old loop.
  useEffect(() => {
    if (!active) return;
    let current = true;
    read(() => current);
    const timer = setInterval(() => {
      if (!document.hidden) read(() => current);
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
