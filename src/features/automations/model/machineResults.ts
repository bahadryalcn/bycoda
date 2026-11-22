import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { presentRemoteError } from "../../connections/public/remoteFailure";

/** What one machine gave for one list. On "error", `data` is what the machine
 * last answered successfully (flagged stale), or empty if it never did. */
export type MachineResult<T> = {
  machineId: string;
  machineName: string;
  status: "ok" | "error";
  data: T[];
  /** `data` is a last-known answer, not a current one. */
  stale: boolean;
  error?: string;
  /** Original transport reason, retained so readers can classify before displaying it. */
  failure?: unknown;
};

/** The last successful list of each machine, by machine ID. */
export type LastGoodLists<T> = Map<string, T[]>;

// A saved connection can retain its ID while pointing at a different host.
// Keep last-good data attached to the connection that actually supplied it.
const listIdentities = new WeakMap<object, Map<string, string>>();
const machineIdentity = (machine: RemoteMachine) =>
  JSON.stringify([machine.environmentId, machine.endpoint, isLocalSyncMachine(machine)]);

// Requests for one machine are numbered in the order they start. `landed` is the
// newest request whose list was stored, so an older reply that resolves later
// cannot replace a newer list (overlapping polls, manual refreshes, mutations).
type LoadSequence = { issued: number; landed: number };
const loadSequences = new WeakMap<object, Map<string, LoadSequence>>();

export function machineDisplayName(machine: RemoteMachine): string {
  return isLocalSyncMachine(machine) ? "this computer" : machine.name;
}

/** Loads every machine's list. A machine that fails keeps its last successful
 * list (marked stale by `markStale`) instead of reporting an empty one; a
 * successful empty list replaces it. `down` machines are known to be
 * unreachable and are not asked at all. */
export async function collectMachineResults<T>(
  lastGood: LastGoodLists<T>,
  machines: readonly RemoteMachine[],
  load: (machine: RemoteMachine) => Promise<T[]>,
  markStale: (item: T) => T,
  down: readonly RemoteMachine[] = [],
): Promise<MachineResult<T>[]> {
  let identities = listIdentities.get(lastGood);
  if (!identities) {
    identities = new Map();
    listIdentities.set(lastGood, identities);
  }
  let sequences = loadSequences.get(lastGood);
  if (!sequences) {
    sequences = new Map();
    loadSequences.set(lastGood, sequences);
  }
  const sequenceOf = (machineId: string): LoadSequence => {
    let sequence = sequences.get(machineId);
    if (!sequence) {
      sequence = { issued: 0, landed: 0 };
      sequences.set(machineId, sequence);
    }
    return sequence;
  };
  for (const machine of [...machines, ...down]) {
    const identity = machineIdentity(machine);
    const previous = identities.get(machine.id);
    if (previous !== undefined && previous !== identity) lastGood.delete(machine.id);
    identities.set(machine.id, identity);
  }
  const failed = (machine: RemoteMachine, error: string, failure?: unknown): MachineResult<T> => {
    const previous =
      identities.get(machine.id) === machineIdentity(machine)
        ? lastGood.get(machine.id)
        : undefined;
    return {
      machineId: machine.id,
      machineName: machineDisplayName(machine),
      status: "error",
      data: previous ? previous.map(markStale) : [],
      stale: previous !== undefined && previous.length > 0,
      error,
      failure,
    };
  };
  const asked = await Promise.all(
    machines.map(async (machine): Promise<MachineResult<T>> => {
      const sequence = sequenceOf(machine.id);
      const issued = ++sequence.issued;
      try {
        const data = await load(machine);
        // A late reply from the old endpoint must not repopulate its replacement's cache.
        if (identities.get(machine.id) !== machineIdentity(machine))
          return failed(machine, "The machine connection changed while loading.");
        // A newer list already landed: keep it, and report it instead of this older reply.
        if (issued < sequence.landed)
          return {
            machineId: machine.id,
            machineName: machineDisplayName(machine),
            status: "ok",
            data: lastGood.get(machine.id) ?? [],
            stale: false,
          };
        sequence.landed = issued;
        lastGood.set(machine.id, data);
        return {
          machineId: machine.id,
          machineName: machineDisplayName(machine),
          status: "ok",
          data,
          stale: false,
        };
      } catch (reason: unknown) {
        // A passing outage keeps the last known entries (see `failed`) and shows no raw error.
        return failed(
          machine,
          presentRemoteError(reason) ?? "The machine is not reachable.",
          reason,
        );
      }
    }),
  );
  return [...asked, ...down.map((machine) => failed(machine, "The machine is not reachable."))];
}

/** Names of the machines that did not answer. */
export function failedMachineNames(results: readonly MachineResult<unknown>[]): string[] {
  return results.filter((result) => result.status === "error").map((result) => result.machineName);
}

/** Names of the machines whose shown cards are a last-known answer. */
export function staleMachineNames(results: readonly MachineResult<unknown>[]): string[] {
  return results.filter((result) => result.stale).map((r) => r.machineName);
}
