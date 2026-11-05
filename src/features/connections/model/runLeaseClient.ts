import { invoke } from "@tauri-apps/api/core";
import { getShellSessions, subscribeShell } from "../../sessions/public/sessionsStore";
import {
  isLeaseHeld,
  leaseHeldText,
  RUN_LEASE_CAPABILITY,
  RUN_LEASE_TTL_MS,
  HOST_WRITER_RETIREMENT_CAPABILITY,
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
 * Legacy hosts keep their offline fallback. Hosts advertising writer retirement
 * must acknowledge ownership transfer before this window starts a provider.
 */
export type RunLeaseOutcome =
  | { kind: "granted"; lease: RunLease }
  /** The host does not offer leases, or could not be asked. */
  | { kind: "unavailable" }
  | { kind: "failed"; text: string }
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
/** How long a send waits for the host's answer before it starts without a lease. */
export const RUN_LEASE_ACQUIRE_TIMEOUT_MS = 4_000;
/**
 * A retirement-capable Host waits up to 20 s for the previous provider writer
 * to stop before it answers. Wait past that window so a slow but healthy
 * retirement is granted instead of refused and left uncertain.
 */
export const RUN_LEASE_RETIREMENT_ACQUIRE_TIMEOUT_MS = 25_000;
/**
 * An abandoned grant whose return is uncertain is never renewed by this window,
 * so the Host drops it once its TTL passes. The guard clears after that.
 */
export const RUN_LEASE_UNCERTAIN_GUARD_MS = RUN_LEASE_TTL_MS + 5_000;
/** A lease whose turn never becomes busy here (it failed to start) is given back after this. */
export const RUN_LEASE_IDLE_RELEASE_MS = 30_000;

let machine: { id: string | undefined; checkedAt: number; retirement?: boolean } | undefined;
let probing: Promise<string | undefined> | undefined;
let transport: Transport = (id, method, params) => remoteRequest(id, method, params);

/** Replaces the host transport and forgets what was learned (tests). */
export function configureRunLeaseClient(next?: {
  transport?: Transport;
  machineId?: string;
  retirement?: boolean;
}) {
  transport = next?.transport ?? ((id, method, params) => remoteRequest(id, method, params));
  machine = next?.machineId
    ? { id: next.machineId, checkedAt: Infinity, retirement: next.retirement }
    : undefined;
  probing = undefined;
  pending.clear();
  retirementWaits.clear();
  for (const state of tracked.values()) clearTimeout(state.idleTimer);
  tracked.clear();
}

async function discover(): Promise<string | undefined> {
  try {
    const machines = await invoke<RemoteMachine[]>("remote_machines");
    const found = (Array.isArray(machines) ? machines : []).find(isLocalSyncMachine);
    const capabilities = found && (await loadRemoteCapabilities(found.environmentId));
    if (machine?.retirement && (!found || (found.id === machine.id && !capabilities))) {
      machine = { ...machine, checkedAt: Date.now() };
      return machine.id;
    }
    const id = found && capabilities?.includes(RUN_LEASE_CAPABILITY) ? found.id : undefined;
    machine = {
      id,
      checkedAt: Date.now(),
      retirement: capabilities?.includes(HOST_WRITER_RETIREMENT_CAPABILITY),
    };
    return id;
  } catch {
    if (machine?.retirement) {
      machine = { ...machine, checkedAt: Date.now() };
      return machine.id;
    }
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

/** No ownership decision exists yet; a slow first probe is not offline proof. */
export const isRunLeaseDiscoveryPending = (): boolean => !machine && !!probing;

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
/** Abandoned transfer requests still own their eventual grant until returned. */
const retirementWaits = new Map<string, Promise<unknown>>();
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
    for (const [id, state] of Array.from(tracked)) {
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
  const busy = new Set(
    getShellSessions()
      .filter((session) => session.busy)
      .map((s) => s.id),
  );
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

/** Tracks a granted lease until its turn ends here. */
function trackLease(sessionId: string, lease: RunLease, late = false) {
  clearTimeout(tracked.get(sessionId)?.idleTimer);
  const state: NonNullable<ReturnType<typeof tracked.get>> = {
    epoch: lease.epoch,
    // A late grant may find its turn already running: the heartbeat must renew it.
    sawBusy: late && !!getShellSessions().find((session) => session.id === sessionId)?.busy,
  };
  // A turn that never became busy here (it failed to start) gives the lease back.
  if (!state.sawBusy) {
    state.idleTimer = setTimeout(() => {
      if (tracked.get(sessionId) === state && !state.sawBusy) void releaseRunLease(sessionId);
    }, RUN_LEASE_IDLE_RELEASE_MS);
    state.idleTimer.unref?.();
  }
  tracked.set(sessionId, state);
  watchTurns();
}

/** Asks the home host for the right to start a turn of `sessionId`. */
export async function acquireRunLease(sessionId: string): Promise<RunLeaseOutcome> {
  const id = runLeaseMachine();
  if (!id) return { kind: "unavailable" };
  if (retirementWaits.has(sessionId))
    return {
      kind: "failed",
      text: "Message not sent: the previous ownership transfer is still pending or unknown. Your message is retained. Sending is allowed again within about two minutes; check the Host connection if this persists.",
    };
  const retirement = machine?.retirement === true;
  pending.add(sessionId);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = transport<{ lease: RunLease }>(id, "sessions.runLease", {
    sessionId,
    clientId: holder(),
    action: "acquire",
  });
  try {
    // A slow host (a busy notes worker, a handoff) must not hold a send invisibly:
    // after a moment the turn starts as before, as when the host is unreachable.
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          timedOut = true;
          reject(new Error("Run lease request timed out"));
        },
        retirement ? RUN_LEASE_RETIREMENT_ACQUIRE_TIMEOUT_MS : RUN_LEASE_ACQUIRE_TIMEOUT_MS,
      );
    });
    const { lease } = await Promise.race([request, limit]);
    trackLease(sessionId, lease);
    return { kind: "granted", lease };
  } catch (error) {
    if (timedOut) {
      if (retirement) {
        // No provider started. A late lease belongs to this abandoned request,
        // never to a later send; return only that epoch without tracking it.
        const cleanup = request.then(
          ({ lease }) =>
            transport(id, "sessions.runLease", {
              sessionId,
              clientId: holder(),
              action: "release",
              epoch: lease.epoch,
            }),
          (error: unknown) => {
            // These acquire refusals precede a grant. Retirement may still be
            // pending on the Host, but a fresh query cannot reuse a late lease.
            // Handle only the acquire rejection here: a release failure after
            // a grant must remain guarded even if it carries the same code.
            const text = error instanceof Error ? error.message : String(error);
            if (isLeaseHeld(error) || /\bHOST_WRITER_RETIREMENT_(?:FAILED|PENDING):/.test(text))
              return;
            throw error;
          },
        );
        retirementWaits.set(sessionId, cleanup);
        const clear = () => {
          if (retirementWaits.get(sessionId) === cleanup) retirementWaits.delete(sessionId);
        };
        void cleanup.then(clear, () => {
          // Uncertain grant/release stays guarded until any late lease has
          // expired on the Host, then a fresh acquire may ask again.
          const timer = setTimeout(clear, RUN_LEASE_UNCERTAIN_GUARD_MS);
          timer.unref?.();
        });
        return {
          kind: "failed",
          text: "Message not sent: the previous Host writer's retirement is still unconfirmed. Your message is retained. Check the task or Host connection before continuing.",
        };
      }
      // The grant may still arrive: keep it for the turn that started without it
      // (renewed by the heartbeat while busy, given back if it never runs) rather
      // than leaving it on the host until it runs out.
      void request.then(
        ({ lease }) => {
          if (!tracked.has(sessionId)) trackLease(sessionId, lease, true);
        },
        () => {},
      );
      return { kind: "unavailable" };
    }
    if (isLeaseHeld(error)) return { kind: "held", text: leaseHeldText(error) };
    const text = error instanceof Error ? error.message : String(error);
    // The Host checks existence before any writer retirement. A conversation it
    // does not know (a brand-new one, or one outside its projects) has no Host
    // writer to hand over, so the turn starts as before.
    if (/\bSession not found on this machine\b/.test(text)) return { kind: "unavailable" };
    if (/HOST_WRITER_RETIREMENT_(?:FAILED|PENDING)/.test(text) || retirement)
      return {
        kind: "failed",
        text: `Message not sent: Host writer ownership could not be confirmed. Your message is retained. Check the task repair state or Host connection. ${text}`,
      };
    // The host is unreachable or does not know leases: start the turn as before.
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
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
