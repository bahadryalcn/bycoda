import { invoke } from "@tauri-apps/api/core";
import { getShellSessions, subscribeShell } from "../../sessions/model/sessionsStore";
import {
  isLeaseHeld,
  leaseHeldText,
  RUN_LEASE_CAPABILITY,
  type RunLease,
} from "../../sync/model/runLease";
import { loadRemoteCapabilities, remoteRequest } from "./connections";
import { desktopInstanceId } from "./desktopInstance";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";

/**
 * This window's side of the run lease. Just before a turn starts here, the
 * home host is asked for the conversation's lease (a loopback call). If another
 * computer already runs a turn of it, the host answers `LEASE_HELD`: the
 * message is queued, never sent, and the conversation never forks. Everything
 * else (no host, an older host, a failed call) lets the turn start as before:
 * the lease protects a conversation, it never blocks local work.
 */
export type RunLeaseOutcome =
  | { kind: "granted"; lease: RunLease }
  /** The host does not offer leases, or could not be asked. */
  | { kind: "unavailable" }
  | { kind: "held"; text: string };

type Transport = <T>(
  machineId: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

const holder = () => `desktop:${desktopInstanceId()}`;
const MACHINE_RECHECK_MS = 15_000;
/** How long the very first look at the host may hold up the first turn of a run. */
const FIRST_LOOK_MS = 2_000;
/** A lease whose turn never becomes busy here (it failed to start) is given back after this. */
export const RUN_LEASE_IDLE_RELEASE_MS = 30_000;

let machine: { id: string | undefined; checkedAt: number } | undefined;
let probing: Promise<string | undefined> | undefined;
let transport: Transport = (id, method, params) => remoteRequest(id, method, params);

/** Replaces the host transport and forgets what was learned (tests). */
export function configureRunLeaseClient(next?: { transport?: Transport; machineId?: string }) {
  transport = next?.transport ?? ((id, method, params) => remoteRequest(id, method, params));
  machine = next?.machineId ? { id: next.machineId, checkedAt: Infinity } : undefined;
  probing = undefined;
  pending.clear();
  for (const state of tracked.values()) clearTimeout(state.idleTimer);
  tracked.clear();
}

async function discover(): Promise<string | undefined> {
  try {
    const machines = await invoke<RemoteMachine[]>("remote_machines");
    const found = (Array.isArray(machines) ? machines : []).find(isLocalSyncMachine);
    const capabilities = found && (await loadRemoteCapabilities(found.environmentId));
    const id = found && capabilities?.includes(RUN_LEASE_CAPABILITY) ? found.id : undefined;
    machine = { id, checkedAt: Date.now() };
    return id;
  } catch {
    machine = { id: undefined, checkedAt: Date.now() };
    return undefined;
  } finally {
    probing = undefined;
  }
}

/** The local host that grants leases, once it is known; `undefined` means "start
 * the turn as before". A first look is made in the background, so the first
 * turn of a run is never held up by it. */
export function runLeaseMachine(): string | undefined {
  if (machine && Date.now() - machine.checkedAt <= MACHINE_RECHECK_MS) return machine.id;
  probing ??= discover();
  return machine?.id;
}

/**
 * While the very first look at the host is under way (nothing is known yet),
 * a promise that settles when it ends or after a moment, so the first turn of a
 * run takes its lease like every later one. `undefined` once something is known.
 */
export function firstRunLeaseLook(): Promise<void> | undefined {
  if (machine || !probing) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FIRST_LOOK_MS);
  });
  return Promise.race([probing.then(() => undefined), limit]).finally(() => clearTimeout(timer));
}

/** Waits for the first look at the host (tests, and callers that must know). */
export async function probeRunLease(): Promise<string | undefined> {
  if (machine && Date.now() - machine.checkedAt <= MACHINE_RECHECK_MS) return machine.id;
  return (probing ??= discover());
}

/** Conversations whose lease is being asked for: a second submit waits for the first. */
const pending = new Set<string>();
export const isRunLeasePending = (sessionId: string): boolean => pending.has(sessionId);

/** Leases this window took, until their turn ends. */
const tracked = new Map<
  string,
  { epoch: number; sawBusy: boolean; idleTimer?: ReturnType<typeof setTimeout> }
>();
let unsubscribe: (() => void) | undefined;

/** The window is closing (its turns end with it): give every lease back so no computer waits for them to run out. */
export function releaseAllRunLeases(): Promise<void> {
  return Promise.all([...tracked.keys()].map((id) => releaseRunLease(id))).then(() => undefined);
}

let unloadWatched = false;
function watchTurns() {
  if (!unloadWatched && typeof window !== "undefined") {
    unloadWatched = true;
    window.addEventListener("pagehide", () => void releaseAllRunLeases());
  }
  unsubscribe ??= subscribeShell(() => {
    if (!tracked.size) return;
    const sessions = new Map(getShellSessions().map((session) => [session.id, session]));
    for (const [id, state] of [...tracked]) {
      if (sessions.get(id)?.busy) {
        state.sawBusy = true;
        clearTimeout(state.idleTimer);
        state.idleTimer = undefined;
      } else if (state.sawBusy || !sessions.has(id)) void releaseRunLease(id);
    }
  });
}

/**
 * The leases of the turns this window runs right now, for its heartbeat: the
 * host keeps them alive and answers which it no longer holds.
 */
export function heldRunLeases(): { sessionId: string; epoch: number }[] {
  return [...tracked]
    .filter(([, state]) => state.sawBusy)
    .slice(0, 256)
    .map(([sessionId, state]) => ({ sessionId, epoch: state.epoch }));
}

/**
 * What the host answered for them. A lease it kept may carry a newer epoch
 * (the window held it again after a gap). `null` is a lease lost: another side
 * runs this conversation now. Those conversations are returned so the caller can
 * stop writing to them; they are no longer tracked. A conversation whose turn
 * already ended here is not returned: there is nothing left to stop.
 */
export function noteRunLeases(answers: Record<string, RunLease | null> | undefined): string[] {
  const lost: string[] = [];
  const busy = new Set(getShellSessions().filter((session) => session.busy).map((s) => s.id));
  for (const [sessionId, lease] of Object.entries(answers ?? {})) {
    const state = tracked.get(sessionId);
    if (!state) continue;
    if (lease) state.epoch = lease.epoch;
    else {
      clearTimeout(state.idleTimer);
      tracked.delete(sessionId);
      if (busy.has(sessionId)) lost.push(sessionId);
    }
  }
  return lost;
}

/** Asks the home host for the right to start a turn of `sessionId`. */
export async function acquireRunLease(sessionId: string): Promise<RunLeaseOutcome> {
  const id = runLeaseMachine();
  if (!id) return { kind: "unavailable" };
  pending.add(sessionId);
  try {
    const { lease } = await transport<{ lease: RunLease }>(id, "sessions.runLease", {
      sessionId,
      clientId: holder(),
      action: "acquire",
    });
    clearTimeout(tracked.get(sessionId)?.idleTimer);
    const state: NonNullable<ReturnType<typeof tracked.get>> = {
      epoch: lease.epoch,
      sawBusy: false,
    };
    // A turn that never became busy here (it failed to start) gives the lease back.
    state.idleTimer = setTimeout(() => {
      if (tracked.get(sessionId) === state && !state.sawBusy) void releaseRunLease(sessionId);
    }, RUN_LEASE_IDLE_RELEASE_MS);
    state.idleTimer.unref?.();
    tracked.set(sessionId, state);
    watchTurns();
    return { kind: "granted", lease };
  } catch (error) {
    if (isLeaseHeld(error)) return { kind: "held", text: leaseHeldText(error) };
    // The host is unreachable or does not know leases: start the turn as before.
    return { kind: "unavailable" };
  } finally {
    pending.delete(sessionId);
  }
}

/** The turn ended (or never started): give the lease back so others may run. */
export async function releaseRunLease(sessionId: string): Promise<void> {
  const state = tracked.get(sessionId);
  const id = machine?.id;
  clearTimeout(state?.idleTimer);
  tracked.delete(sessionId);
  if (!state || !id) return;
  try {
    await transport(id, "sessions.runLease", {
      sessionId,
      clientId: holder(),
      action: "release",
      epoch: state.epoch,
    });
  } catch {
    // It ends on its own: the host stops renewing it with the heartbeat.
  }
}
