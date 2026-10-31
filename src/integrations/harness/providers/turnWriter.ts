import {
  bindChildTurnWriter,
  associateChildHostRun,
  guardChildTurnWriter,
  writeChild,
  type ChildProcessHandle,
} from "../core/child";
import { TurnNotReadyError, type HarnessOperationContext, type HarnessSessionInput } from "../core/types";
import type { ControlTurnHandle } from "../core/controlTurn";
import type { HostRunHandle } from "../core/hostRun";
import type { JsonRpcClient } from "../core/jsonRpc";
import type { AcpClient } from "../core/acp";
import type { PiRpc } from "./pi/piClient";
import { continueAfterFailure, settledTail } from "../../../shared/lib/promiseQueue";

export type { JsonRpcWriterView } from "../core/jsonRpc";
export type { AcpWriterView } from "../core/acp";
export type { PiRpcWriterView } from "./pi/piClient";

/** Keep restart-capable selection behind the same logical session queue even
 * when an operation replaces the physical Live used by its predecessor. */
export function queueProviderOperation<Result>(
  tails: Map<string, Promise<unknown>>,
  sessionId: string,
  context: HarnessOperationContext | undefined,
  operation: () => Promise<Result>,
): Promise<Result> {
  const work = continueAfterFailure(tails.get(sessionId) ?? Promise.resolve(), async () => {
    assertProviderOperation(context);
    return operation();
  });
  tails.set(sessionId, work);
  void settledTail(work).then(() => {
    if (tails.get(sessionId) === work) tails.delete(sessionId);
  });
  return work;
}

/** Each call captures one original process/client/control tuple before binding.
 * A facade shares its transport multiplexer but never changes a current writer. */
function hostRunForMode(context: HarnessOperationContext | undefined, mode: "turn" | "control") {
  if (mode === "turn") return context?.hostRun;
  if (context?.hostRun !== undefined && context.hostControlRun === undefined)
    throw new Error("An original Host cleanup control view is required");
  return context?.hostControlRun;
}

export async function rpcTurnWriter(
  handle: ChildProcessHandle,
  client: JsonRpcClient,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
  mode: "turn" | "control" = "turn",
) {
  return rpcTurnWriterCaptured(
    handle,
    client,
    control,
    context,
    mode,
    hostRunForMode(context, mode),
  );
}
async function rpcTurnWriterCaptured(
  handle: ChildProcessHandle,
  client: JsonRpcClient,
  control: ControlTurnHandle | undefined,
  context: HarnessOperationContext | undefined,
  mode: "turn" | "control",
  hostRun: HostRunHandle | undefined,
) {
  client.assertProcess(handle);
  assertWriterOperation(context, handle, mode);
  const writer = await bindChildTurnWriter(handle, control, hostRun);
  assertWriterOperation(context, handle, mode);
  const guard = () => assertWriterOperation(context, handle, mode);
  return guardView(client.withWriter(guardChildTurnWriter(writer, guard)), guard);
}
export async function acpTurnWriter(
  handle: ChildProcessHandle,
  client: AcpClient,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
  mode: "turn" | "control" = "turn",
) {
  return acpTurnWriterCaptured(
    handle,
    client,
    control,
    context,
    mode,
    hostRunForMode(context, mode),
  );
}
async function acpTurnWriterCaptured(
  handle: ChildProcessHandle,
  client: AcpClient,
  control: ControlTurnHandle | undefined,
  context: HarnessOperationContext | undefined,
  mode: "turn" | "control",
  hostRun: HostRunHandle | undefined,
) {
  client.assertProcess(handle);
  assertWriterOperation(context, handle, mode);
  const writer = await bindChildTurnWriter(handle, control, hostRun);
  assertWriterOperation(context, handle, mode);
  const guard = () => assertWriterOperation(context, handle, mode);
  return guardView(client.withWriter(guardChildTurnWriter(writer, guard)), guard);
}
export async function piTurnWriter(
  handle: ChildProcessHandle,
  client: PiRpc,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
  mode: "turn" | "control" = "turn",
) {
  return piTurnWriterCaptured(
    handle,
    client,
    control,
    context,
    mode,
    hostRunForMode(context, mode),
  );
}
async function piTurnWriterCaptured(
  handle: ChildProcessHandle,
  client: PiRpc,
  control: ControlTurnHandle | undefined,
  context: HarnessOperationContext | undefined,
  mode: "turn" | "control",
  hostRun: HostRunHandle | undefined,
) {
  client.assertProcess(handle);
  assertWriterOperation(context, handle, mode);
  const writer = await bindChildTurnWriter(handle, control, hostRun);
  assertWriterOperation(context, handle, mode);
  const guard = () => assertWriterOperation(context, handle, mode);
  return guardView(client.withWriter(guardChildTurnWriter(writer, guard)), guard);
}

type OperationRecord = {
  owner: object;
  handle?: ChildProcessHandle;
  operation: object;
  claim: number;
  phase: "queued" | "starting" | "active" | "closed";
  cancelled: boolean;
};
type ProcessOperations = {
  highWater: number;
  enteredHighWater: number;
  records: Map<object, OperationRecord>;
};
const operationsByProcess = new WeakMap<object, ProcessOperations>();
const recordsByOperation = new WeakMap<object, Set<OperationRecord>>();
const MAX_PROCESS_OPERATIONS = 512;
const cancelledOperations = new WeakSet<object>();
// An authorization removed from a bounded per-process census must never be
// admitted again under a higher claim, including on a newly observed alias.
const finishedOperations = new WeakSet<object>();
function recordSourceOperation(
  owner: object,
  context?: HarnessOperationContext,
  phase: OperationRecord["phase"] = "queued",
  handle?: ChildProcessHandle,
): OperationRecord | undefined {
  const operation = context?.operation;
  if (!operation) return undefined;
  assertProviderOperation(context);
  let process = operationsByProcess.get(owner);
  if (!process) {
    process = { highWater: 0, enteredHighWater: 0, records: new Map() };
    operationsByProcess.set(owner, process);
  }
  const existing = process.records.get(operation);
  if (existing) return existing;
  // Removing a closed, superseded authorization cannot grant it a raw fallback:
  // missing scoped records always refuse. Actual IO/retirement lives elsewhere.
  for (const [key, record] of process.records)
    if (record.phase === "closed" && record.claim < process.highWater) process.records.delete(key);
  if (
    process.records.size >= MAX_PROCESS_OPERATIONS ||
    process.highWater >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("Provider operation owner capacity exhausted");
  const record: OperationRecord = {
    owner,
    handle,
    operation,
    claim: ++process.highWater,
    phase,
    cancelled: false,
  };
  process.records.set(operation, record);
  let records = recordsByOperation.get(operation);
  if (!records) {
    records = new Set();
    recordsByOperation.set(operation, records);
  }
  records.add(record);
  return record;
}
function recordOperation(
  handle: ChildProcessHandle,
  context?: HarnessOperationContext,
  phase: OperationRecord["phase"] = "queued",
) {
  return recordSourceOperation(handle, context, phase, handle);
}
export function captureHttpOperation(
  owner: object,
  context?: HarnessOperationContext,
  phase: OperationRecord["phase"] = "queued",
) {
  const record = recordSourceOperation(owner, context, phase);
  return {
    begin() {
      if (!record) return;
      assertProviderOperation(context);
      if (record.cancelled || record.phase === "closed")
        throw new Error("Provider operation cancelled");
      record.phase = "active";
      const source = operationsByProcess.get(owner)!;
      source.enteredHighWater = Math.max(source.enteredHighWater, record.claim);
    },
  };
}
export function ownsHttpOperation(
  context: HarnessOperationContext | undefined,
  owner: object,
): boolean {
  if (!context) return true;
  if (!context.operation) return false;
  const source = operationsByProcess.get(owner),
    record = source?.records.get(context.operation);
  if (!source || !record || record.cancelled || record.phase === "queued") return false;
  if (record.phase !== "closed") return record.claim >= source.enteredHighWater;
  return (
    record.claim === source.highWater &&
    ![...source.records.values()].some(
      (other) => other !== record && other.phase !== "closed" && !other.cancelled,
    )
  );
}

export function observeProviderProcess(
  input: HarnessSessionInput,
  handle: ChildProcessHandle,
  phase: "queued" | "starting" = "queued",
): void {
  const hostRun = input.operationContext?.hostRun;
  recordOperation(handle, input.operationContext, phase);
  if (phase === "starting" && hostRun !== undefined) associateChildHostRun(handle, hostRun);
  input.onOriginalProcess?.(handle);
}
export function beginProviderOperation(
  context: HarnessOperationContext | undefined,
  handle: ChildProcessHandle,
): void {
  const record = recordOperation(handle, context);
  if (!record) return;
  if (record.cancelled || record.phase === "closed")
    throw new Error("Provider operation cancelled");
  record.phase = "active";
  const source = operationsByProcess.get(handle)!;
  source.enteredHighWater = Math.max(source.enteredHighWater, record.claim);
}
export function finishProviderOperation(context?: HarnessOperationContext): void {
  if (!context?.operation) return;
  finishedOperations.add(context.operation);
  for (const record of recordsByOperation.get(context.operation) ?? []) record.phase = "closed";
}
export function cancelQueuedOperation(context?: HarnessOperationContext): boolean {
  if (!context?.operation) return false;
  cancelledOperations.add(context.operation);
  const records = [...(recordsByOperation.get(context.operation) ?? [])].filter(
    (record) => record.phase !== "closed",
  );
  for (const record of records) if (record.phase === "queued") record.cancelled = true;
  return records.length > 0 && records.every((record) => record.phase === "queued");
}
/** Capture now; bind only when the queued operation actually begins. */
export function captureRpcTurnWriter(
  handle: ChildProcessHandle,
  client: JsonRpcClient,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
) {
  const hostRun = context?.hostRun;
  recordOperation(handle, context);
  return async () => {
    beginProviderOperation(context, handle);
    return rpcTurnWriterCaptured(handle, client, control, context, "turn", hostRun);
  };
}
export function captureAcpTurnWriter(
  handle: ChildProcessHandle,
  client: AcpClient,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
) {
  const hostRun = context?.hostRun;
  recordOperation(handle, context);
  return async () => {
    beginProviderOperation(context, handle);
    return acpTurnWriterCaptured(handle, client, control, context, "turn", hostRun);
  };
}
export function capturePiTurnWriter(
  handle: ChildProcessHandle,
  client: PiRpc,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
) {
  const hostRun = context?.hostRun;
  recordOperation(handle, context);
  return async () => {
    beginProviderOperation(context, handle);
    return piTurnWriterCaptured(handle, client, control, context, "turn", hostRun);
  };
}
/** Internal source matching is separate from Native permission/Host run proof. */
export function ownsOperation(
  context: HarnessOperationContext | undefined,
  handle?: ChildProcessHandle,
  preconstructionOperation?: object,
): boolean {
  if (!context) return true;
  const originals =
    context.originalProcesses ?? (context.originalProcess ? [context.originalProcess] : []);
  if (originals.length && (!handle || !originals.includes(handle))) return false;
  if (!context.operation) return originals.length > 0 && handle !== undefined;
  if (!handle) return context.operation === preconstructionOperation;
  const process = operationsByProcess.get(handle),
    record = process?.records.get(context.operation);
  if (!process || !record || record.cancelled || record.phase === "queued") return false;
  if (record.phase !== "closed") return record.claim >= process.enteredHighWater;
  return (
    record.claim === process.highWater &&
    ![...process.records.values()].some(
      (other) => other !== record && other.phase !== "closed" && !other.cancelled,
    )
  );
}
export function processTarget(
  value?: ChildProcessHandle | HarnessOperationContext,
): ChildProcessHandle | undefined {
  return value && "sessionId" in value ? value : value?.originalProcess;
}
export function operationContext(
  value?: ChildProcessHandle | HarnessOperationContext,
): HarnessOperationContext | undefined {
  return value && !("sessionId" in value) ? value : undefined;
}

export type { HarnessOperationContext } from "../core/types";
export function assertProviderOperation(context?: HarnessOperationContext): void {
  if (context?.operation && cancelledOperations.has(context.operation))
    throw new Error("Provider operation cancelled");
  if (context?.operation && finishedOperations.has(context.operation))
    throw new TurnNotReadyError("The previous turn has finished. Send this follow-up as a new message.");
}
function assertWriterOperation(
  context: HarnessOperationContext | undefined,
  handle: ChildProcessHandle,
  mode: "turn" | "control",
): void {
  if (mode === "turn") {
    assertProviderOperation(context);
    const record = context?.operation
      ? operationsByProcess.get(handle)?.records.get(context.operation)
      : undefined;
    if (context?.operation && (!record || record.phase === "closed" || record.phase === "queued"))
      throw new TurnNotReadyError("The previous turn has finished. Send this follow-up as a new message.");
  }
  if (!ownsOperation(context, handle)) throw new Error("Provider operation replaced before write");
}
function guardView<T extends object>(view: T, guard: () => void): T {
  const guarded: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(view)) {
    const value: unknown = Reflect.get(view, key);
    Object.defineProperty(
      guarded,
      key,
      typeof value === "function"
        ? {
            enumerable: true,
            // This view's cancellation removes only its exact original pending
            // request. It emits no bytes and must remain synchronous in finally.
            value:
              key === "cancelRequest"
                ? (...args: unknown[]) => Reflect.apply(value, view, args)
                : async (...args: unknown[]) => {
                    guard();
                    return await Reflect.apply(value, view, args);
                  },
          }
        : { enumerable: true, get: () => Reflect.get(view, key) },
    );
  }
  return Object.freeze(guarded) as T;
}
export type ByteTurnWriter = (line: string) => Promise<void>;
export function captureByteTurnWriter(
  handle: ChildProcessHandle | undefined,
  control?: ControlTurnHandle,
  context?: HarnessOperationContext,
  mode: "turn" | "control" = "turn",
) {
  const hostRun = hostRunForMode(context, mode);
  if (handle && mode === "turn") recordOperation(handle, context);
  return async (): Promise<ByteTurnWriter> => {
    if (!handle) throw new Error("An original provider process is required");
    if (mode === "turn") beginProviderOperation(context, handle);
    assertWriterOperation(context, handle, mode);
    const writer = guardChildTurnWriter(await bindChildTurnWriter(handle, control, hostRun), () =>
      assertWriterOperation(context, handle, mode),
    );
    assertWriterOperation(context, handle, mode);
    return (line) => {
      assertWriterOperation(context, handle, mode);
      return writeChild(writer, line);
    };
  };
}
