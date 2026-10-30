import { vi } from "vitest";
import type { ChildProcessHandle } from "../core/child";

export type FixtureProcessOperation = {
  kind: "spawn" | "write" | "kill" | "watch" | "unwatch" | "client" | "invalidate";
  handle: ChildProcessHandle;
  args: readonly unknown[];
};

const recognized = new WeakSet<object>();
const retired = new WeakSet<object>();
const kills = new WeakMap<object, unknown>();
const order = new WeakMap<object, number>();
const current = new Map<string, ChildProcessHandle>();
let sequence = 0;
const created: ChildProcessHandle[] = [];
const operations: FixtureProcessOperation[] = [];

function requireOriginal(handle: ChildProcessHandle): string {
  if (!handle || typeof handle !== "object" || !recognized.has(handle))
    throw new Error("Protocol fixture requires its original opaque process handle");
  return handle.sessionId;
}

/**
 * Protocol-unit fake only. It does not bind a Native receipt, emulate physical
 * process fences, or import the real child module's private state. Legacy fake
 * protocol maps retain their string locators; the boundary records the exact
 * opaque object before adapting those callbacks.
 */
export const processConstructions = {
  created,
  operations,
  create(sessionId: string): ChildProcessHandle {
    const handle = Object.freeze({ sessionId }) as ChildProcessHandle;
    recognized.add(handle);
    order.set(handle, ++sequence);
    created.push(handle);
    return handle;
  },
  /** Fresh explicit owner intent only; deferred test actions retain a handle. */
  capture(sessionId: string): ChildProcessHandle | undefined {
    return current.get(sessionId);
  },
  client(handle: ChildProcessHandle): void {
    requireOriginal(handle);
    operations.push({ kind: "client", handle, args: [] });
  },
  reset(): void {
    created.length = 0;
    operations.length = 0;
    current.clear();
    // Recognize already captured originals during afterEach/soak cleanup.
    // Clearing diagnostic metadata must not retarget or invalidate their owner.
  },
  mock<T extends Record<string, unknown>>(legacy: T) {
    const result: Record<string, unknown> = {
      ...legacy,
      createChildProcessHandle: (sessionId: string) => processConstructions.create(sessionId),
      captureChildProcess: (sessionId: string) => processConstructions.capture(sessionId),
      invalidateChildOutput: (handle: ChildProcessHandle, reason: string) => {
        requireOriginal(handle);
        operations.push({ kind: "invalidate", handle, args: [reason] });
      },
    };
    for (const [name, kind] of [
      ["spawnChild", "spawn"],
      ["writeChild", "write"],
      ["killChild", "kill"],
      ["watchChild", "watch"],
      ["unwatchChild", "unwatch"],
    ] as const) {
      const original = legacy[name];
      if (typeof original !== "function") continue;
      result[name] = vi.fn((handle: ChildProcessHandle, ...args: unknown[]) => {
        const sessionId = requireOriginal(handle);
        operations.push({ kind, handle, args });
        if (kind === "kill" || kind === "unwatch") {
          retired.add(handle);
          if (current.get(sessionId) === handle) current.delete(sessionId);
        }
        // The real child API shares one kill result for an original handle.
        // A second cleanup call is still recorded above; it does not become a
        // second fake physical effect or consume a newer owner's kill latch.
        if (kind === "kill" && kills.has(handle)) return kills.get(handle);
        const value: unknown = Reflect.apply(original, undefined, [sessionId, ...args]);
        if (kind === "kill") kills.set(handle, value);
        if (kind !== "spawn") return value;
        return Promise.resolve(value).then((accepted) => {
          const prior = current.get(sessionId);
          if (!retired.has(handle) && (!prior || order.get(prior)! < order.get(handle)!))
            current.set(sessionId, handle);
          return accepted;
        });
      });
    }
    return result as T & {
      createChildProcessHandle(sessionId: string): ChildProcessHandle;
      captureChildProcess(sessionId: string): ChildProcessHandle | undefined;
      invalidateChildOutput(handle: ChildProcessHandle, reason: string): void;
    };
  },
};
