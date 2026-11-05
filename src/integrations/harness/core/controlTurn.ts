import { isHarnessConstructionId } from "../../../shared/model/harnessProcess";

/** An application control turn, not physical process retirement or provider ACK. */
export type NativeControlTurnReceipt = Readonly<{
  version: 1;
  sessionId: string;
  turnId: string;
}>;
export type ControlTurnReceipt = NativeControlTurnReceipt;

export type NativeControlInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** Exact native page and durable logical-session claim captured for this turn. */
export type NativeSessionCapability = Readonly<{
  shellId: string;
  operationId: string;
  pageToken: string;
}>;

declare const controlTurnBrand: unique symbol;
export type ControlTurnHandle = Readonly<{
  sessionId: string;
  [controlTurnBrand]: true;
}>;

export const NATIVE_CONTROL_TURN_CAPACITY = 128;
type Phase = "authorizing" | "unknown" | "ready" | "finishing" | "failed" | "finished";
type Original = {
  readonly handle: ControlTurnHandle;
  readonly invoke: NativeControlInvoke;
  readonly nativeSessionCapability?: NativeSessionCapability;
  receipt?: NativeControlTurnReceipt;
  phase: Phase;
  finish?: Promise<void>;
};
type Keeper = {
  version: 1;
  handles: WeakMap<object, Original>;
  active: Set<Original>;
};

// Real HMR preserves actual closures/WeakMap handles, never serialized receipts.
const hot = import.meta.hot;
const previous: unknown = hot?.data.nativeControlTurnOwner;
const keeper = (
  previous === undefined
    ? {
        version: 1,
        handles: new WeakMap<object, Original>(),
        active: new Set<Original>(),
      }
    : previous
) as Keeper;
if (hot && previous === undefined) hot.data.nativeControlTurnOwner = keeper;

function available(): Keeper {
  if (
    keeper === null ||
    typeof keeper !== "object" ||
    Object.keys(keeper).length !== 3 ||
    keeper.version !== 1 ||
    !(keeper.handles instanceof WeakMap) ||
    !(keeper.active instanceof Set)
  )
    throw new Error("Native control turn ownership is unavailable.");
  return keeper;
}

function originalFor(state: Keeper, handle: ControlTurnHandle): Original {
  const original = state.handles.get(handle);
  if (
    !original ||
    original.handle !== handle ||
    !Object.isFrozen(handle) ||
    typeof original.invoke !== "function" ||
    !["authorizing", "unknown", "ready", "finishing", "failed", "finished"].includes(
      original.phase,
    ) ||
    state.active.has(original) !== ["authorizing", "ready", "finishing"].includes(original.phase) ||
    (original.receipt &&
      (!Object.isFrozen(original.receipt) || original.receipt.sessionId !== handle.sessionId))
  )
    throw new Error("Native control turn handle is unavailable.");
  return original;
}

export function nativeSessionCapability(
  handle: ControlTurnHandle,
): NativeSessionCapability | undefined {
  return originalFor(available(), handle).nativeSessionCapability;
}

/** Exact immutable source correlation for a fresh process bind; it grants no currentness. */
export function nativeControlTurnReceipt(handle: ControlTurnHandle): NativeControlTurnReceipt {
  let original: Original;
  try {
    original = originalFor(available(), handle);
  } catch {
    throw new Error("Native control turn identity is unconfirmed.");
  }
  if (!original.receipt) throw new Error("Native control turn identity is unconfirmed.");
  return original.receipt;
}

function requireReceipt(value: unknown, sessionId: string): NativeControlTurnReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Native control turn identity is unconfirmed.");
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields);
  if (
    keys.length !== 3 ||
    !["version", "sessionId", "turnId"].every(
      (key) =>
        Object.prototype.hasOwnProperty.call(fields, key) &&
        Object.prototype.hasOwnProperty.call(fields[key], "value"),
    ) ||
    fields.version.value !== 1 ||
    fields.sessionId.value !== sessionId ||
    !isHarnessConstructionId(fields.turnId.value)
  )
    throw new Error("Native control turn identity is unconfirmed.");
  return Object.freeze({ version: 1, sessionId, turnId: fields.turnId.value as string });
}

function actualResult(value: unknown): Promise<unknown> {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    typeof (value as { then?: unknown }).then !== "function"
  )
    throw new Error("Native control turn command completion is unconfirmed.");
  return Promise.resolve(value);
}

/** Invoke must already belong to the original Native source, not a latest-backend facade. */
export async function beginNativeControlTurn(
  sessionId: string,
  cwd: string,
  appAccess: boolean,
  invokeFn: NativeControlInvoke,
  nativeSessionCapability?: NativeSessionCapability,
): Promise<ControlTurnHandle> {
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.includes("\0") ||
    new TextEncoder().encode(sessionId).length > 512 ||
    typeof cwd !== "string" ||
    !cwd ||
    cwd.includes("\0") ||
    cwd.length > 32_768 ||
    typeof appAccess !== "boolean" ||
    typeof invokeFn !== "function"
  )
    throw new Error("Native control turn input is invalid.");
  const state = available();
  for (const entry of state.active)
    if (["unknown", "failed", "finished"].includes(entry.phase)) state.active.delete(entry);
  if (state.active.size >= NATIVE_CONTROL_TURN_CAPACITY)
    throw new Error("Native control turn capacity is held by unfinished or unconfirmed work.");
  const handle = Object.freeze({ sessionId }) as ControlTurnHandle;
  if (nativeSessionCapability && nativeSessionCapability.shellId !== sessionId)
    throw new Error("Native session capability belongs to another session.");
  const original: Original = {
    handle,
    invoke: invokeFn,
    nativeSessionCapability,
    phase: "authorizing",
  };
  // Reserve before any effect; terminal failures release the local slot.
  state.handles.set(handle, original);
  state.active.add(original);
  const args = Object.freeze({ sessionId, cwd, appAccess });
  try {
    const response = await actualResult(original.invoke<unknown>("control_authorize_turn", args));
    original.receipt = requireReceipt(response, sessionId);
    original.phase = "ready";
    return handle;
  } catch (error) {
    original.phase = "unknown";
    state.active.delete(original);
    throw error;
  }
}

function finishOriginal(state: Keeper, original: Original): Promise<void> {
  const receipt = original.receipt;
  if (!receipt) return Promise.reject(new Error("Native control turn identity is unconfirmed."));
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Install the exact result before dispatch, including synchronous reentrant callers.
  original.finish = result;
  original.phase = "finishing";
  state.active.add(original);
  const failed = (error: unknown) => {
    original.phase = "failed";
    state.active.delete(original);
    reject(error);
  };
  try {
    const actual = actualResult(
      original.invoke<unknown>("control_turn_finished", Object.freeze({ receipt })),
    );
    void actual.then((value) => {
      if (value !== undefined && value !== null) {
        failed(new Error("Native control turn completion is unconfirmed."));
        return;
      }
      original.phase = "finished";
      state.active.delete(original);
      resolve();
    }, failed);
  } catch (error) {
    failed(error);
  }
  return result;
}

/** Repeated calls observe the exact same attempt; there is no implicit retry or timeout ACK. */
export function finishNativeControlTurn(handle: ControlTurnHandle): Promise<void> {
  try {
    const state = available();
    const original = originalFor(state, handle);
    return original.finish ?? finishOriginal(state, original);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** An explicit new attempt is allowed only after the original real result rejected. */
export function retryNativeControlTurn(handle: ControlTurnHandle): Promise<void> {
  try {
    const state = available();
    const original = originalFor(state, handle);
    if (original.phase === "failed") return finishOriginal(state, original);
    if (original.finish) return original.finish;
    throw new Error("Native control turn has no rejected finish attempt to retry.");
  } catch (error) {
    return Promise.reject(error);
  }
}
