import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import { withTimeout } from "../../../shared/lib/withTimeout";

/** A machine list read that has not answered by now is abandoned and no longer joined. */
export const MACHINE_LIST_READ_TIMEOUT_MS = 20_000;

type Entry<T> = { machineId: string; at?: number; value?: T[]; pending?: Promise<T[]> };

/** One machine's list, read once however many boards, views or notification
 * rounds ask at the same time. Concurrent callers for the same connection share
 * one request; a caller that tolerates `maxAgeMs` of staleness (a background
 * notifier) may reuse a recent answer instead. A view asks with no age, so it
 * is never served from the past. Failures and timeouts are never kept. A
 * connection that changes its endpoint or environment is a different key, so
 * an answer from the old Host is never reused for its replacement. */
export function sharedMachineListReads<T>() {
  const entries = new Map<string, Entry<T>>();
  const keyOf = (machine: RemoteMachine) =>
    JSON.stringify([
      machine.id,
      machine.environmentId,
      machine.endpoint,
      isLocalSyncMachine(machine),
    ]);
  return {
    read(
      machine: RemoteMachine,
      load: (machine: RemoteMachine) => Promise<T[]>,
      maxAgeMs = 0,
    ): Promise<T[]> {
      const key = keyOf(machine);
      const entry = entries.get(key);
      if (entry?.pending) return entry.pending;
      if (
        maxAgeMs > 0 &&
        entry?.value !== undefined &&
        entry.at !== undefined &&
        Date.now() - entry.at < maxAgeMs
      )
        return Promise.resolve(entry.value);
      const fresh: Entry<T> = { machineId: machine.id };
      // A read invalidated while it was in flight still answers its own callers,
      // but is not kept for later ones.
      fresh.pending = withTimeout(
        Promise.resolve().then(() => load(machine)),
        MACHINE_LIST_READ_TIMEOUT_MS,
        "Machine list",
      ).then(
        (value) => {
          if (entries.get(key) === fresh)
            entries.set(key, { machineId: machine.id, at: Date.now(), value });
          return value;
        },
        (error: unknown) => {
          if (entries.get(key) === fresh) entries.delete(key);
          throw error;
        },
      );
      entries.set(key, fresh);
      return fresh.pending;
    },
    /** After this desktop changed the machine's list, so no later caller joins a
     * read that began before the change or reuses an answer from before it. */
    invalidate(machineId: string) {
      for (const [key, entry] of entries) if (entry.machineId === machineId) entries.delete(key);
    },
  };
}
