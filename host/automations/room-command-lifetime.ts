import { AsyncLocalStorage } from "node:async_hooks";
type Handle = { cancel(): void; done: Promise<{ error?: string }> };
type Lifetime = { signal: AbortSignal; handles: Handle[] };
const lifetimes = new AsyncLocalStorage<Lifetime>();
export class RoomToolRetiredError extends Error {}
export class RoomCommandRetiredError extends RoomToolRetiredError {}

/** Called by the real command-process owner, never from model arguments. */
export function registerRoomCommandHandle(handle: Handle): boolean {
  const lifetime = lifetimes.getStore();
  if (!lifetime) return false;
  lifetime.handles.push(handle);
  if (lifetime.signal.aborted) handle.cancel();
  return true;
}

/** An inline "running" reply cannot retire the parent automation's physical Work slot. */
export async function withRoomCommandLifetime<T>(
  signal: AbortSignal,
  effect: () => Promise<T>,
): Promise<T> {
  const lifetime: Lifetime = { signal, handles: [] };
  const abort = () => {
    for (const handle of lifetime.handles) handle.cancel();
  };
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  try {
    let result: T | undefined;
    let failed = false;
    let failure: unknown;
    try {
      result = await lifetimes.run(lifetime, effect);
    } catch (error) {
      failed = true;
      failure = error;
    }
    for (const handle of lifetime.handles) {
      const proof = await handle.done;
      if (proof.error?.includes("Termination was not confirmed."))
        throw new Error("Room command physical retirement is unproven.");
    }
    if (failed) {
      if (lifetime.handles.length)
        throw new RoomCommandRetiredError(
          failure instanceof Error
            ? failure.message
            : "Room command failed after physical retirement.",
        );
      throw failure;
    }
    if (!lifetime.handles.length)
      throw new Error("Room command original physical owner is unavailable.");
    return result!;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
