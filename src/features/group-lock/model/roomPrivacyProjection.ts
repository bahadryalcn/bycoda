import { invoke, isTauri } from "@tauri-apps/api/core";

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
const listeners = new Set<() => void>();

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
export function isRoomPrivacyRecoveryPending(): boolean {
  return operation?.recoverClosed === true;
}
export function getRoomPrivacyStatus(): RoomPrivacyStatus {
  return isTauri() && !ready && !status.error ? notReady : status;
}
export function requireRoomPrivacyAdmission(): void {
  const state = getRoomPrivacyStatus();
  if (state.pending || state.error) throw new Error("Room privacy protection is not confirmed.");
}
export function subscribeRoomPrivacyStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: RoomPrivacyStatus) {
  status = next;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      console.error("Room privacy status listener failed", error);
    }
  }
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
    const operationId = crypto.randomUUID();
    running = true;
    try {
      uncertainBegin = operationId;
      await invoke("control_privacy_projection_begin", {
        operationId,
        ...(workspaceRequestId ? { workspaceRequestId } : {}),
      });
      const current = await invoke<Projection | null>("control_privacy_projection_read");
      let value: T | undefined;
      let mutationError: unknown;
      const token = newPrivacyMutationToken();
      try {
        value = await mutate(token);
      } catch (error) {
        mutationError = error;
      } finally {
        activeMutationTokens.delete(token);
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
      if (mutationError !== undefined) throw mutationError;
      return value as T;
    } finally {
      running = false;
    }
  });
  mutationTail = work.then(
    () => undefined,
    () => undefined,
  );
  return work.then(
    (value) => {
      queuedMutations--;
      if (queuedMutations === 0) {
        if (dirty && ready) startDrain();
        else publish({ pending: false, error: null });
      }
      return value;
    },
    (error: unknown) => {
      queuedMutations--;
      publish({ pending: false, error: error instanceof Error ? error.message : String(error) });
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
  if (queuedMutations > 0 || running || dirty)
    publish({ pending: false, error: "Room privacy window is unavailable." });
}
export function failRoomPrivacyProjection(error: unknown): void {
  ready = false;
  publish({ pending: false, error: error instanceof Error ? error.message : String(error) });
}
export function retryRoomPrivacyProjection(): void {
  if (!isTauri()) return;
  publish({ pending: true, error: null });
  dirty = true;
  if (ready && !running && queuedMutations === 0) startDrain();
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

/** Explicit owner request. Native confirms the live scope in a native dialog
 * while Host admission remains closed before replacing old state. */
export async function rebuildClosedRoomPrivacyProjection(): Promise<void> {
  try {
    if (!operation || operation.leaseId || running || queuedMutations || !status.error)
      throw new Error("Privacy recovery is unavailable.");
    const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
    if (!operation.recoverClosed) {
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
            operationId: crypto.randomUUID(),
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
          operationId: crypto.randomUUID(),
          snapshot: readRoomPrivacyScope().stableStorageKeys,
          recoverClosed: true,
          rebaseFrom: operation.operationId,
        };
      }
    }
    await recoverRoomPrivacyProjection();
  } catch (error) {
    publish({ pending: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
async function drain(): Promise<void> {
  running = true;
  try {
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
      const committed = await invoke<Projection>(
        "control_privacy_projection_transition",
        operation,
      );
      if (!Number.isSafeInteger(committed?.revision) || committed.revision < 1)
        throw new Error("Invalid privacy projection acknowledgement.");
      committedProjectionSeen = committed.revision;
      operation = null;
    }
    if (queuedMutations === 0) publish({ pending: false, error: null });
  } catch (error) {
    dirty = true;
    publish({ pending: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}
