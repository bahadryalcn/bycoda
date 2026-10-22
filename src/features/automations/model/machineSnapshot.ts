import { recordRemoteCapabilities, remoteRequest } from "../../connections/model/connections";
import { subscribeRemoteRecovered } from "../../connections/model/remoteHealth";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";

/** How long one machine's answer is reused. A board refresh, a notification
 * round and an open Tasks view all land inside this window. */
export const MACHINE_SNAPSHOT_TTL_MS = 10_000;

type Entry<T> = { at: number; value?: T; pending?: Promise<T> };

/** A per-machine cache whose concurrent lookups share one request. Failures are
 * never kept, so an unreachable machine is asked again by the next caller. */
function machineCache<T>(load: (machine: RemoteMachine, fresh: boolean) => Promise<T>) {
  const entries = new Map<string, Entry<T>>();
  // Editing a machine (endpoint, environment) changes the key, so its old
  // answer is never reused.
  const keyOf = (machine: RemoteMachine) =>
    `${machine.id}\n${machine.endpoint}\n${machine.environmentId}`;
  return {
    get(machine: RemoteMachine, force = false): Promise<T> {
      const key = keyOf(machine);
      const entry = entries.get(key);
      if (entry?.pending) return entry.pending;
      const now = Date.now();
      if (!force && entry && entry.value !== undefined && now - entry.at < MACHINE_SNAPSHOT_TTL_MS)
        return Promise.resolve(entry.value);
      const fresh: Entry<T> = { at: now };
      // An answer for a lookup that was invalidated meanwhile still goes to
      // the callers waiting on it, but is not kept.
      fresh.pending = load(machine, force).then(
        (value) => {
          if (entries.get(key) === fresh) entries.set(key, { at: Date.now(), value });
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
    invalidate(machineId?: string) {
      if (machineId === undefined) entries.clear();
      else
        for (const key of [...entries.keys()])
          if (key.startsWith(`${machineId}\n`)) entries.delete(key);
    },
  };
}

const capabilities = machineCache(async (machine, fresh) => {
  const host = await remoteRequest<{ capabilities?: unknown }>(
    machine.id,
    "environment.describe",
    {},
    fresh,
  );
  recordRemoteCapabilities(machine.environmentId, host.capabilities);
  return Array.isArray(host.capabilities)
    ? host.capabilities.filter((entry): entry is string => typeof entry === "string")
    : [];
});

const projects = machineCache((machine) =>
  remoteRequest<HostProject[]>(machine.id, "projects.list"),
);

/** What the machine's host advertises in `environment.describe`. At most one
 * request is made per machine per TTL window, however many callers ask. */
export function machineCapabilities(machine: RemoteMachine, fresh = false): Promise<string[]> {
  return capabilities.get(machine, fresh);
}

/** The machine's `projects.list`, shared the same way. */
export function machineProjects(machine: RemoteMachine): Promise<HostProject[]> {
  return projects.get(machine);
}

/** Forgets what was learned about one machine, or about all of them: after the
 * machine was edited or reconnected, or after a project was added to it. */
export function invalidateMachineSnapshot(machineId?: string) {
  capabilities.invalidate(machineId);
  projects.invalidate(machineId);
}

if (typeof window !== "undefined") {
  // Announced when a machine is saved, edited or removed.
  window.addEventListener("bycoda:remote-machines", () => invalidateMachineSnapshot());
  // A reconnected host may have been updated or restarted.
  subscribeRemoteRecovered(() => invalidateMachineSnapshot());
}
