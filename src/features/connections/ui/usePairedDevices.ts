import { useEffect, useEffectEvent, useRef, useState } from "react";
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
import { shareStructure } from "../../../shared/lib/shareStructure";
import { wallClockNow } from "../../../shared/lib/time/wallClock";

/** The entry key of a computer: its saved id and the Host identity it answers as. */
export const entryKey = (machine: RemoteMachine) => `${machine.id}:${machine.environmentId}`;

/** The device list is re-read this often while the tab is visible. */
export const PAIRED_DEVICES_REFRESH_MS = 30_000;

export type PairedDevicesEntry =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | ({
      phase: "ready";
      list: PairedDeviceList;
      canRevoke: boolean;
    } & (
      | { stale?: false }
      /** The list shown is stale; updatedAt is its latest successful confirmation. */
      | { stale: true; updatedAt: number }
    ));

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
export function usePairedDevices(
  machines: RemoteMachine[],
  active: boolean,
  accountId: string | null,
) {
  const [snapshot, setSnapshot] = useState<{
    accountId: string | null;
    entries: Record<string, PairedDevicesEntry>;
  }>({ accountId, entries: {} });
  const latestRead = useRef<symbol | null>(null);
  const lastSuccessful = useRef(new Map<string, number>());
  const hostReads = useRef(new Map<string, Promise<[PairedDeviceList, boolean]>>());
  const scope = JSON.stringify([active, accountId, ...machines.map(entryKey)]);

  const read = async (periodic: boolean, afterChange = false) => {
    if (!active || (periodic && latestRead.current)) return;
    const request = Symbol();
    latestRead.current = request;
    const keep = new Set(machines.map(entryKey));
    // Entries of computers that were removed are dropped with the next write.
    const write = (
      id: string,
      next: (entry: PairedDevicesEntry | undefined) => PairedDevicesEntry,
    ) => {
      if (latestRead.current !== request) return;
      for (const removed of lastSuccessful.current.keys())
        if (!keep.has(removed)) lastSuccessful.current.delete(removed);
      setSnapshot((previous) => {
        const current = previous.accountId === accountId ? previous.entries : {};
        const entry = next(current[id]);
        if (entry === current[id] && Object.keys(current).every((key) => keep.has(key)))
          return previous;
        return {
          accountId,
          entries: {
            ...Object.fromEntries(Object.entries(current).filter(([entry]) => keep.has(entry))),
            [id]: entry,
          },
        };
      });
    };
    await Promise.all(
      machines.map(async (machine) => {
        if (periodic && isIdleMachine(machine)) return;
        // Keyed by Host identity too: a connection rebound to another Host never shows the old list.
        const id = entryKey(machine);
        try {
          let pending = afterChange ? undefined : hostReads.current.get(id);
          if (!pending) {
            const next = Promise.all([
              loadPairedDevices(machine),
              canRevokePairedDevices(machine),
            ]).finally(() => {
              if (hostReads.current.get(id) === next) hostReads.current.delete(id);
            });
            hostReads.current.set(id, next);
            pending = next;
          }
          const [list, canRevoke] = await pending;
          if (latestRead.current !== request) return;
          const updatedAt = wallClockNow();
          lastSuccessful.current.set(id, updatedAt);
          const permitted =
            canRevoke &&
            (list.state !== "ready" ||
              list.devices.find((device) => device.isCurrent)?.canManageDevices !== false);
          write(id, (entry) => {
            const previous = entry?.phase === "ready" ? entry : undefined;
            const shared = shareStructure(previous?.list, list);
            if (
              previous &&
              !previous.stale &&
              previous.canRevoke === permitted &&
              shared === previous.list
            )
              return previous;
            return { phase: "ready", list: shared, canRevoke: permitted };
          });
        } catch (reason) {
          const updatedAt = lastSuccessful.current.get(id);
          write(id, (entry) =>
            entry?.phase === "ready" && updatedAt !== undefined
              ? { ...entry, stale: true, updatedAt }
              : { phase: "error", error: errorText(reason) },
          );
        }
      }),
    );
    if (latestRead.current === request) latestRead.current = null;
  };
  const poll = useEffectEvent(read);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- A polling timer against the Hosts while the tab shows; a hidden tab or changed machine list stops the old loop.
  useEffect(() => {
    if (!active) return;
    const reads = hostReads.current;
    void poll(false).catch((reason) => console.warn("Could not read paired devices", reason));
    const timer = setInterval(() => {
      if (!document.hidden)
        void poll(true).catch((reason) => console.warn("Could not read paired devices", reason));
    }, PAIRED_DEVICES_REFRESH_MS);
    return () => {
      latestRead.current = null;
      reads.clear();
      clearInterval(timer);
    };
  }, [active, scope]);

  return {
    entries: snapshot.accountId === accountId ? snapshot.entries : {},
    scope,
    retry: () => read(false),
    // A successful pairing or revoke must supersede a read started before the change.
    refreshAfterChange: () => read(false, true),
  };
}
