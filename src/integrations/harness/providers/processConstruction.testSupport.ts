import { vi } from "vitest";
import type { ChildProcessHandle, ChildTurnWriter } from "../core/child";
import type { HostRunHandle } from "../core/hostRun";
import { retireProviderProcess } from "../core/providerRetirement";

export type FixtureProcessOperation = {
  kind:
    | "spawn"
    | "write"
    | "kill"
    | "watch"
    | "unwatch"
    | "client"
    | "invalidate"
    | "bind"
    | "writer";
  writer?: ChildTurnWriter;
  hostRun?: HostRunHandle;
  handle: ChildProcessHandle;
  args: readonly unknown[];
};

const recognized = new WeakSet<object>();
const writerStates = new WeakMap<
  object,
  {
    handle: ChildProcessHandle;
    control: unknown;
    hostRun?: HostRunHandle;
    guards: readonly (() => void)[];
    original: ChildTurnWriter;
  }
>();
const writerPairs = new WeakMap<object, Map<unknown, Promise<ChildTurnWriter>>>();
const retired = new WeakSet<object>();
const spawned = new WeakSet<object>();
const hostRuns = new WeakMap<ChildProcessHandle, HostRunHandle>();
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
  bind(
    handle: ChildProcessHandle,
    control?: unknown,
    hostRun?: HostRunHandle,
  ): Promise<ChildTurnWriter> {
    requireOriginal(handle);
    if (hostRun && control) throw new Error("Native and Host turn sources cannot be combined");
    if (hostRun && !hostRuns.has(handle))
      throw new Error("Original process birth Host run is required");
    let pairs = writerPairs.get(handle);
    if (!pairs) {
      pairs = new Map();
      writerPairs.set(handle, pairs);
    }
    const source = hostRun ?? control;
    const existing = pairs.get(source);
    if (existing) return existing;
    const writer = Object.freeze({}) as ChildTurnWriter;
    writerStates.set(writer, { handle, control, hostRun, guards: [], original: writer });
    const work = Promise.resolve(writer);
    pairs.set(source, work);
    operations.push({
      kind: "bind",
      handle,
      writer,
      ...(hostRun ? { hostRun } : {}),
      args: hostRun ? [control, hostRun] : [control],
    });
    return work;
  },
  assertWriter(handle: ChildProcessHandle, writer: ChildTurnWriter): void {
    requireOriginal(handle);
    if (writerStates.get(writer)?.handle !== handle)
      throw new Error("Protocol fixture writer belongs to another original construction");
  },
  guard(writer: ChildTurnWriter, beforeWrite: () => void): ChildTurnWriter {
    const source = writerStates.get(writer);
    if (!source) throw new Error("Protocol fixture requires its original opaque writer");
    const guarded = Object.freeze({}) as ChildTurnWriter;
    writerStates.set(guarded, { ...source, guards: [...source.guards, beforeWrite] });
    return guarded;
  },
  originalWriter(writer: ChildTurnWriter): ChildTurnWriter {
    const source = writerStates.get(writer);
    if (!source) throw new Error("Protocol fixture requires its original opaque writer");
    return source.original;
  },
  view<T extends Record<string, unknown>>(
    handle: ChildProcessHandle,
    writer: ChildTurnWriter,
    methods: T,
  ): Readonly<T> {
    processConstructions.assertWriter(handle, writer);
    return Object.freeze(
      Object.fromEntries(
        Object.entries(methods).map(([name, method]) => [
          name,
          typeof method !== "function"
            ? method
            : (...args: unknown[]) => {
                if (name !== "cancelRequest")
                  for (const guard of writerStates.get(writer)!.guards) guard();
                operations.push({ kind: "writer", handle, writer, args: [name, ...args] });
                return Reflect.apply(method, undefined, args);
              },
        ]),
      ) as T,
    );
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
      associateChildHostRun: (handle: ChildProcessHandle, hostRun: HostRunHandle) => {
        requireOriginal(handle);
        if (hostRuns.get(handle) === hostRun) return;
        if (spawned.has(handle) || hostRuns.has(handle))
          throw new Error("A process birth Host run cannot be replaced");
        hostRuns.set(handle, hostRun);
      },
      captureChildProcess: (sessionId: string) => processConstructions.capture(sessionId),
      captureChildControlTurn: (handle: ChildProcessHandle): undefined => {
        requireOriginal(handle);
        // These protocol owners are explicitly uncontrolled. Do not synthesize
        // Native authority from a fixture object, control argument or locator.
        return undefined;
      },
      bindChildTurnWriter: (
        handle: ChildProcessHandle,
        control?: unknown,
        hostRun?: HostRunHandle,
      ) => processConstructions.bind(handle, control, hostRun),
      assertChildTurnWriter: (handle: ChildProcessHandle, writer: ChildTurnWriter) =>
        processConstructions.assertWriter(handle, writer),
      guardChildTurnWriter: (writer: ChildTurnWriter, beforeWrite: () => void) =>
        processConstructions.guard(writer, beforeWrite),
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
      result[name] = vi.fn((target: ChildProcessHandle | ChildTurnWriter, ...args: unknown[]) => {
        const writer =
          kind === "write" && writerStates.has(target) ? (target as ChildTurnWriter) : undefined;
        const handle = writer ? writerStates.get(writer)!.handle : (target as ChildProcessHandle);
        const sessionId = requireOriginal(handle);
        if (writer) for (const guard of writerStates.get(writer)!.guards) guard();
        operations.push({
          kind,
          handle,
          args,
          ...(writer ? { writer } : {}),
          ...(hostRuns.has(handle) ? { hostRun: hostRuns.get(handle) } : {}),
        });
        if (kind === "spawn") spawned.add(handle);
        if (kind === "kill" || kind === "unwatch") {
          retired.add(handle);
          if (current.get(sessionId) === handle) current.delete(sessionId);
        }
        // The real child API shares one kill result for an original handle.
        // A second cleanup call is still recorded above; it does not become a
        // second fake physical effect or consume a newer owner's kill latch.
        if (kind === "kill" && kills.has(handle)) return kills.get(handle);
        const adapted = [...args];
        if (kind === "watch" && typeof args[1] === "function") {
          const onExit = args[1];
          adapted[1] = (...exit: unknown[]) => {
            const result: unknown = Reflect.apply(onExit, undefined, exit);
            // Model Core's original-exit ledger notification after the actual
            // fixture handler. This is still a protocol fake, not Native proof.
            void Promise.resolve(result)
              .then(
                () => retireProviderProcess(handle),
                () => retireProviderProcess(handle),
              )
              .catch(() => {});
            return result;
          };
        }
        const value: unknown = Reflect.apply(original, undefined, [sessionId, ...adapted]);
        if (kind === "kill") {
          kills.set(handle, value);
          void Promise.resolve(value).catch(() => {
            if (kills.get(handle) === value) kills.delete(handle);
          });
        }
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
      captureChildControlTurn(handle: ChildProcessHandle): undefined;
      associateChildHostRun(handle: ChildProcessHandle, hostRun: HostRunHandle): void;
      bindChildTurnWriter(
        handle: ChildProcessHandle,
        control?: unknown,
        hostRun?: HostRunHandle,
      ): Promise<ChildTurnWriter>;
      assertChildTurnWriter(handle: ChildProcessHandle, writer: ChildTurnWriter): void;
      guardChildTurnWriter(writer: ChildTurnWriter, beforeWrite: () => void): ChildTurnWriter;
      invalidateChildOutput(handle: ChildProcessHandle, reason: string): void;
    };
  },
};
