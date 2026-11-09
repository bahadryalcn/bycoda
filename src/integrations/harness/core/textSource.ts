import { associateChildHostRun, type ChildProcessHandle } from "./child";
import type { HarnessOperationContext } from "./types";
import type { HostRunHandle } from "./hostRun";
import {
  assertProviderOperation,
  beginProviderOperation,
  finishProviderOperation,
} from "../providers/turnWriter";

/** Capture the actual background job before queues/transport awaits. No current-run lookup. */
export function captureTextInput<T extends { operationContext?: HarnessOperationContext }>(
  input: T,
): T {
  const context = input.operationContext;
  if (!context) return { ...input };
  const captured = { ...context };
  if (captured.originalProcesses)
    captured.originalProcesses = Object.freeze([...captured.originalProcesses]);
  textControlRun(captured);
  return { ...input, operationContext: Object.freeze(captured) };
}

/** Naming never borrows normal admission for cleanup after that admission closes. */
export function textControlRun(context?: HarnessOperationContext): HostRunHandle | undefined {
  if (!context?.hostRun) {
    if (context?.hostControlRun) throw new Error("Original normal Host naming run is required");
    return undefined;
  }
  const control = context.hostControlRun;
  if (!control || control === context.hostRun)
    throw new Error("Original Host naming cleanup run is required");
  return control;
}

/** Fresh birth association precedes clients/watch/spawn. Warm owners are never re-associated. */
export function prepareTextProcess(
  handle: ChildProcessHandle,
  context?: HarnessOperationContext,
  fresh = false,
): void {
  assertProviderOperation(context);
  const originals =
    context?.originalProcesses ??
    (context?.originalProcess ? [context.originalProcess] : undefined);
  if (originals && !originals.includes(handle))
    throw new Error("Text operation does not own this original process");
  if (fresh && context?.hostRun) associateChildHostRun(handle, context.hostRun);
  beginProviderOperation(context, handle);
}

/** The caller's actual prompt and original cleanup settle before its local operation closes. */
export async function runTextOperation<T>(
  context: HarnessOperationContext | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const utility = Object.freeze({});
  context?.onUtilityStarted?.(utility);
  try {
    assertProviderOperation(context);
    let result: T;
    try {
      result = await run();
    } finally {
      finishProviderOperation(context);
    }
    context?.onUtilityCompleted?.(utility);
    return result;
  } catch (error) {
    context?.onUtilityFailed?.(utility);
    throw error;
  }
}
