import { errorText } from "../../../shared/lib/errors";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { newRequestId } from "../../../shared/lib/id/requestId";
import { createStore } from "../../../shared/lib/store";

declare const privacyMutationBrand: unique symbol;
export type PrivacyMutationToken = { readonly [privacyMutationBrand]: true };
const activeMutationTokens = new WeakSet<object>();
export function requirePrivacyMutationToken(token: PrivacyMutationToken): void {
  if (!activeMutationTokens.has(token))
    throw new Error("Privacy mutation token is no longer active.");
}
function newPrivacyMutationToken(): PrivacyMutationToken {
  const token = Object.freeze({}) as PrivacyMutationToken;
  activeMutationTokens.add(token);
  return token;
}

type Projection = { revision: number; operationId?: string; snapshot?: unknown };
export type RoomPrivacyStatus = { pending: boolean; error: string | null };
const notReady: RoomPrivacyStatus = { pending: true, error: null };
let status: RoomPrivacyStatus = { pending: false, error: null };
let dirty = false;
let running = false;
let drainCompletion: Promise<void> = Promise.resolve();
let mutationTail: Promise<void> = Promise.resolve();
let queuedMutations = 0;
/** Waits between automatic retries of a Host busy failure: 1s to 16s. */
const TRANSIENT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
/** Host capacity pushback only; a deadline after dispatch or a Host-side unknown failure stays
 * held for an explicit retry. */
const HOST_BUSY =
  /RPC_WS_OVERLOAD|Host read capacity is busy|Host pending (read request|control queue) limit reached/;
/** Whether a held failure is Host capacity pushback rather than a privacy defect. */
export function isRoomPrivacyHostBusy(error: unknown): boolean {
  return HOST_BUSY.test(errorText(error));
}
/** The native Host connection stalled or was replaced before a result arrived. Native commands
 * are idempotent per operation ID, so replaying the same operation is the receipt reconciliation. */
const NATIVE_RESULT_LOST = /RPC_WS_INTERRUPTED/;
/** The native connection settled the request unsent, for example while the Host restarted for an
 * update, so nothing reached the Host and replaying the same operation is safe. */
const NATIVE_NOT_SENT =
  /RPC_WS_(DEADLINE: Host request deadline|UNAVAILABLE: Host connection is unavailable) [^\n]*before dispatch/;
/** Failures the drain retries on its own under the original operation identity. */
function isReconcilable(error: unknown): boolean {
  const text = errorText(error);
  return isRoomPrivacyHostBusy(error) || NATIVE_RESULT_LOST.test(text) || NATIVE_NOT_SENT.test(text);
}
let wakeBackoff: (() => void) | null = null;
let ready = false;
let committedProjectionSeen: number | null = null;
let uncertainBegin: string | null = null;
let operation: {
  expected: number | null;
  operationId: string;
  snapshot: unknown;
  leaseId?: string;
  recoverClosed?: boolean;
  rebaseFrom?: string;
  rebaseApplied?: boolean;
  rebaseSnapshot?: unknown;
  rebaseExpected?: number | null;
} | null = null;
const listeners = createStore({
  snapshot: true,
  onError: (error) => console.error("Room privacy status listener failed", error),
});

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  return value;
}
function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));
}

export function getCommittedProjectionSeen(): number | null {
  return committedProjectionSeen;
}
/** Held failures a plain retry cannot settle: the saved record cannot prove its locks, or
 * this window's live policy diverged from it (a change saved without its commit). */
const REBUILDABLE = [
  "Privacy lock state is unavailable",
  "Privacy policy has not been acknowledged by this window",
];
/** Whether the owner may rebuild protection from this window's live scope after native review. */
export function canRebuildRoomPrivacyProjection(): boolean {
  return (
    !!status.error && (operation?.recoverClosed === true || REBUILDABLE.includes(status.error))
  );
}
export function getRoomPrivacyStatus(): RoomPrivacyStatus {
  return isTauri() && !ready && !status.error ? notReady : status;
}
export function requireRoomPrivacyAdmission(): void {
  const state = getRoomPrivacyStatus();
  if (state.pending || state.error) throw new Error("Room privacy protection is not confirmed.");
}
export function subscribeRoomPrivacyStatus(listener: () => void): () => void {
  return listeners.subscribe(listener);
}
function publish(next: RoomPrivacyStatus) {
  status = next;
  listeners.notify();
}

function startDrain(): void {
  drainCompletion = drain().catch(failRoomPrivacyProjection);
}

/** Drain Host effects before the synchronous local mutation, then qualify it.
 * Unknown outcomes remain held under the original operation identity. */
export function withRoomPrivacyMutation<T>(
  mutate: (token: PrivacyMutationToken) => T | Promise<T>,
  workspaceRequestId?: string,
): Promise<T> {
  if (!isTauri()) {
    const token = newPrivacyMutationToken();
    try {
      return Promise.resolve(mutate(token)).finally(() => activeMutationTokens.delete(token));
    } catch (error) {
      activeMutationTokens.delete(token);
      return Promise.reject(error);
    }
  }
  if (status.error) return Promise.reject(new Error(status.error));
  queuedMutations++;
  publish({ pending: true, error: null });
  // The change's own failure (for example an unreachable remote machine) after a committed
  // projection leaves privacy confirmed; only projection failures hold later changes.
  let projectionCommitted = false;
  // A lost native result after the local change ran is reconciled by the drain; Room stays
  // closed (pending) meanwhile, so the applied change is reported as done.
  let mutated = false;
  let reconciling = false;
  let value: T | undefined;
  let mutationError: unknown;
  const work = mutationTail.then(async () => {
    if (!ready && !status.error)
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = subscribeRoomPrivacyStatus(() => {
          if (status.error) {
            unsubscribe();
            reject(new Error(status.error));
          } else if (ready) {
            unsubscribe();
            resolve();
          }
        });
      });
    await drainCompletion;
    if (!ready || status.error)
      throw new Error(status.error ?? "Privacy protection is unavailable.");
    const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
    const operationId = newRequestId();
    running = true;
    try {
      uncertainBegin = operationId;
      await invoke("control_privacy_projection_begin", {
        operationId,
        ...(workspaceRequestId ? { workspaceRequestId } : {}),
      });
      const current = await invoke<Projection | null>("control_privacy_projection_read");
      const token = newPrivacyMutationToken();
      try {
        value = await mutate(token);
      } catch (error) {
        mutationError = error;
      } finally {
        activeMutationTokens.delete(token);
        mutated = true;
      }
      operation = {
        expected: current?.revision ?? null,
        operationId,
        leaseId: operationId,
        snapshot: readRoomPrivacyScope().stableStorageKeys,
      };
      uncertainBegin = null;
      dirty = false;
      const committed = await invoke<Projection>(
        "control_privacy_projection_transition",
        operation,
      );
      if (!Number.isSafeInteger(committed?.revision) || committed.revision < 1)
        throw new Error("Invalid privacy projection acknowledgement.");
      committedProjectionSeen = committed.revision;
      operation = null;
      projectionCommitted = true;
      if (mutationError !== undefined) throw mutationError;
      return value as T;
    } catch (error) {
      if (!projectionCommitted && ready && isReconcilable(error)) {
        // Replay this operation in the background before any later change begins.
        reconciling = true;
        running = false;
        dirty = true;
        startDrain();
      }
      throw error;
    } finally {
      if (!reconciling) running = false;
    }
  });
  mutationTail = work.then(
    () => undefined,
    () => undefined,
  );
  const settled = () => {
    queuedMutations--;
    if (queuedMutations === 0) {
      if (dirty && ready) startDrain();
      else publish({ pending: false, error: null });
    }
  };
  return work.then(
    (value) => {
      settled();
      return value;
    },
    (error: unknown) => {
      if (projectionCommitted) {
        settled();
        throw error;
      }
      queuedMutations--;
      if (reconciling) {
        // The drain owns the status until it settles; it publishes only once no change is queued.
        if (!running && queuedMutations === 0 && !status.error)
          publish({ pending: false, error: null });
        if (!mutated) throw error;
        if (mutationError !== undefined) throw mutationError;
        return value as T;
      }
      publish({ pending: false, error: errorText(error) });
      throw error;
    },
  );
}

/** Queue one native qualification; failures remain held until explicit retry. */
export function queueRoomPrivacyProjection(): void {
  if (!isTauri()) return;
  dirty = true;
  if (status.error) return;
  publish({ pending: true, error: null });
  if (ready && !running && queuedMutations === 0) startDrain();
}
export function activateRoomPrivacyProjection(): void {
  if (!isTauri()) return;
  ready = true;
  queueRoomPrivacyProjection();
}
export function deactivateRoomPrivacyProjection(): void {
  ready = false;
  wakeBackoff?.();
  if (queuedMutations > 0 || running || dirty)
    publish({ pending: false, error: "Room privacy window is unavailable." });
}
export function failRoomPrivacyProjection(error: unknown): void {
  ready = false;
  wakeBackoff?.();
  publish({ pending: false, error: errorText(error) });
}
export function retryRoomPrivacyProjection(): void {
  // An inactive window cannot drain: keep the held error visible rather than showing a spinner
  // that no drain will ever settle.
  if (!isTauri() || !ready) return;
  publish({ pending: true, error: null });
  dirty = true;
  // A drain waiting out a transient failure retries now, under the same operation.
  if (wakeBackoff) wakeBackoff();
  else if (!running && queuedMutations === 0) startDrain();
}
/** Plain retry settles a held failure; closed-state recovery needs the explicit rebuild flow,
 * and an inactive window would leave the retry waiting. */
export function canRetryRoomPrivacyProjection(): boolean {
  return isTauri() && ready && !!status.error && !canRebuildRoomPrivacyProjection();
}
/** Reconcile an uncertain native transition before retrying a user action. */
export function recoverRoomPrivacyProjection(): Promise<void> {
  retryRoomPrivacyProjection();
  return new Promise((resolve, reject) => {
    const check = () => {
      const current = getRoomPrivacyStatus();
      if (current.error) {
        unsubscribe();
        reject(new Error(current.error));
      } else if (!current.pending) {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = subscribeRoomPrivacyStatus(check);
    check();
  });
}

/** A password-confirmed owner action is an explicit retry: settle a retryable held failure
 * first, so one stale Host outage does not refuse every later attempt. */
export async function settleHeldRoomPrivacyProjection(): Promise<void> {
  if (status.error && canRetryRoomPrivacyProjection()) await recoverRoomPrivacyProjection();
}

/** Explicit owner request. Native confirms the live scope in a native dialog
 * while Host admission remains closed before replacing old state. */
export async function rebuildClosedRoomPrivacyProjection(): Promise<void> {
  try {
    if (running || queuedMutations || !status.error)
      throw new Error("Privacy recovery is unavailable.");
    const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
    // A change that failed inside its native lease rebases onto a recovery operation that
    // first proves the held one was never applied.
    const held = operation ? operation.leaseId : uncertainBegin;
    if (held) {
      const current = await invoke<Projection | null>("control_privacy_projection_read");
      operation = {
        expected: current?.revision ?? null,
        operationId: newRequestId(),
        snapshot: readRoomPrivacyScope().stableStorageKeys,
        recoverClosed: true,
        rebaseFrom: held,
      };
      uncertainBegin = null;
    } else if (!operation) {
      throw new Error("Privacy recovery is unavailable.");
    } else if (!operation.recoverClosed) {
      operation = {
        ...operation,
        snapshot: readRoomPrivacyScope().stableStorageKeys,
        recoverClosed: true,
      };
    } else {
      const current = await invoke<Projection | null>("control_privacy_projection_read");
      if (
        current?.operationId === operation.operationId &&
        current.revision === (operation.expected ?? 0) + 1 &&
        sameSnapshot(current.snapshot, operation.snapshot)
      ) {
        const prior = operation;
        const live = readRoomPrivacyScope().stableStorageKeys;
        if (!sameSnapshot(live, prior.snapshot)) {
          operation = {
            expected: current.revision,
            operationId: newRequestId(),
            snapshot: live,
            recoverClosed: true,
            rebaseFrom: prior.operationId,
            rebaseApplied: true,
            rebaseSnapshot: prior.snapshot,
            rebaseExpected: prior.expected,
          };
        }
      } else if (
        current?.operationId !== operation.operationId &&
        [
          "Privacy scope changed during recovery",
          "Privacy policy changed before commit",
          "Privacy projection changed during recovery",
        ].includes(status.error)
      ) {
        operation = {
          expected: current?.revision ?? null,
          operationId: newRequestId(),
          snapshot: readRoomPrivacyScope().stableStorageKeys,
          recoverClosed: true,
          rebaseFrom: operation.operationId,
        };
      }
    }
    await recoverRoomPrivacyProjection();
  } catch (error) {
    publish({ pending: false, error: errorText(error) });
    throw error;
  }
}
function backoff(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      wakeBackoff = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    wakeBackoff = done;
  });
}

/** Qualify the projection. Host busy pushback or a lost native result is retried with backoff
 * under the same operation identity while the status stays pending; anything else, or an
 * exhausted budget, is held as an error until explicit retry. */
async function drain(): Promise<void> {
  running = true;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await drainOnce();
        if (queuedMutations === 0) publish({ pending: false, error: null });
        return;
      } catch (error) {
        dirty = true;
        const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !ready || !isReconcilable(error)) {
          publish({
            pending: false,
            error: errorText(error),
          });
          return;
        }
        await backoff(delay);
        if (!ready) {
          publish({ pending: false, error: "Room privacy window is unavailable." });
          return;
        }
      }
    }
  } finally {
    running = false;
  }
}
async function drainOnce(): Promise<void> {
  while (dirty) {
    dirty = false;
    if (!operation) {
      if (uncertainBegin)
        await invoke("control_privacy_projection_begin", { operationId: uncertainBegin });
      const current = await invoke<Projection | null>("control_privacy_projection_read");
      const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
      const operationId = uncertainBegin ?? crypto.randomUUID();
      operation = {
        expected: current?.revision ?? null,
        operationId,
        snapshot: readRoomPrivacyScope().stableStorageKeys,
        ...(uncertainBegin ? { leaseId: uncertainBegin } : {}),
      };
      uncertainBegin = null;
    }
    const committed = await invoke<Projection>("control_privacy_projection_transition", operation);
    if (!Number.isSafeInteger(committed?.revision) || committed.revision < 1)
      throw new Error("Invalid privacy projection acknowledgement.");
    committedProjectionSeen = committed.revision;
    operation = null;
  }
}
