import { copyNativeCaptureData, isNativeCaptureObject } from "./native-capture-json";
import type {
  NativeInputControls,
  NativeInputRead,
  NativeInputRegistration,
  NativeInputWork,
} from "./native-input-observer";

export type NativeInputErrorCode = "busy" | "capacity" | "invalid-snapshot" | "invalid-scope";
export type NativeInputLease<Kind extends string> = Readonly<{
  registryEpoch: number;
  snapshots: readonly Readonly<{
    id: number;
    revision: number;
    kind: Kind;
    snapshot: Record<string, unknown>;
  }>[];
  missingCoverage: readonly string[];
  current(): boolean;
  release(): void;
}>;
export type NativeInputClosure<Kind extends string> = Readonly<{
  capture(): Promise<NativeInputLease<Kind>>;
  current(): boolean;
  release(): void;
}>;
export type NativeInputRegistryOptions<Kind extends string> = {
  kind: Kind;
  coveragePrefix: string;
  subject: string;
  noun: string;
  Error: new (
    code: NativeInputErrorCode,
    message?: string,
  ) => Error & { readonly code: NativeInputErrorCode };
  /** Existing feature keepers retain the exact old gates, entries and jobs. */
  globalKey?: string;
};

type Controls = NativeInputControls;
type Work = { entry: Entry; done: boolean; root: number };
type Gate = {
  owner: object;
  roster: readonly Entry[];
  boundary: number;
  invalid: boolean;
  released: boolean;
  deadline: number;
  signal?: AbortSignal;
  wake: Set<() => void>;
};
type Entry = {
  id: number;
  revision: number;
  generation: number;
  read(): NativeInputRead;
  controls?: Controls;
};
type State = {
  version: 1;
  epoch: number;
  nextId: number;
  generation: number;
  entries: Map<number, Entry>;
  overflow: number;
  overflowControls: Set<Controls>;
  exhausted: boolean;
  leases: number;
  retainedBytes: number;
  gate?: Gate;
  works: Set<Work>;
  tickets: WeakMap<NativeInputWork, Work>;
  workSequence: number;
  applying?: Work;
  external?: Entry;
};
const MAX_MOUNTS = 256;
const MAX_LEASES = 32;
const MAX_BYTES = 64 * 1024 * 1024;
/** Grace after a closure's own deadline before admission is force-reopened. */
export const NATIVE_INPUT_CLOSURE_WATCHDOG_MS = 10_000;
/** Longest extra wait while a write admitted before the closure is still running. */
const NATIVE_INPUT_CLOSURE_WRITE_EXTENSION_MS = 60_000;
export const NATIVE_INPUT_WORK_LIMITS = Object.freeze({ global: 64, owner: 16 });
const encoder = new TextEncoder();
function fresh(): State {
  return {
    version: 1,
    epoch: 0,
    nextId: 0,
    generation: 0,
    entries: new Map(),
    overflow: 0,
    overflowControls: new Set(),
    exhausted: false,
    leases: 0,
    retainedBytes: 0,
    works: new Set(),
    tickets: new WeakMap(),
    workSequence: 0,
  };
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
function implement<Kind extends string>(
  state: State,
  configuration: NativeInputRegistryOptions<Kind>,
) {
  const ClosureError = configuration.Error;
  state.works ??= new Set();
  state.tickets ??= new WeakMap();
  state.workSequence ??= 0;
  state.overflowControls ??= new Set();
  const invalidate = () => {
    if (state.gate) {
      state.gate.invalid = true;
      for (const wake of state.gate.wake) wake();
    }
  };
  const bump = () => {
    if (state.epoch >= Number.MAX_SAFE_INTEGER) state.exhausted = true;
    else state.epoch++;
  };
  if (state.generation >= Number.MAX_SAFE_INTEGER) state.exhausted = true;
  else state.generation++;
  bump();
  const generation = state.generation;
  function observe(entry: Entry): NativeInputRead {
    if (entry.generation !== generation)
      throw new ClosureError("busy", `${configuration.subject} implementation changed`);
    try {
      const value = copyNativeCaptureData(entry.read());
      if (
        !isNativeCaptureObject(value.snapshot) ||
        (value.busy !== undefined && typeof value.busy !== "string") ||
        (value.missingCoverage !== undefined && !Array.isArray(value.missingCoverage))
      )
        throw new ClosureError("invalid-snapshot");
      return value;
    } catch (error) {
      if (error instanceof ClosureError) throw error;
      throw new ClosureError("invalid-snapshot");
    }
  }
  function changed(entry: Entry) {
    if (state.entries.get(entry.id) !== entry) return;
    if (entry.revision >= Number.MAX_SAFE_INTEGER) state.exhausted = true;
    else entry.revision++;
    bump();
  }
  return {
    register(read: () => NativeInputRead, controls?: Controls): NativeInputRegistration {
      bump();
      invalidate();
      if (state.entries.size >= MAX_MOUNTS || state.nextId >= Number.MAX_SAFE_INTEGER) {
        state.overflow++;
        if (controls) {
          state.overflowControls.add(controls);
          controls.close(!!state.gate);
        }
        let retired = false;
        return {
          changed: bump,
          refresh: bump,
          closed: () => !!state.gate,
          allowed: () => !state.gate,
          external: (apply) => {
            invalidate();
            return apply();
          },
          // An omitted mount has no owned work record; do not fabricate a permit.
          operation: () => null,
          unregister() {
            if (!retired) {
              retired = true;
              state.overflow--;
              if (controls) state.overflowControls.delete(controls);
              bump();
            }
          },
        };
      }
      const entry: Entry = { id: ++state.nextId, revision: 0, generation, read, controls };
      state.entries.set(entry.id, entry);
      if (state.gate) controls?.close(true);
      const allowed = () =>
        !state.gate ||
        state.external === entry ||
        (!!state.applying &&
          !state.applying.done &&
          state.applying.entry === entry &&
          state.applying.root <= state.gate.boundary);
      return {
        changed: () => changed(entry),
        // No extra full-document cache between leases. A committed adapter
        // render invalidates conservatively, including readiness transitions.
        refresh: () => {
          if (!state.gate) changed(entry);
        },
        unregister: () => {
          if (state.entries.get(entry.id) === entry) {
            invalidate();
            state.entries.delete(entry.id);
            bump();
          }
        },
        closed: () => !!state.gate,
        allowed,
        external(apply) {
          invalidate();
          const previous = state.external;
          state.external = entry;
          try {
            return apply();
          } finally {
            state.external = previous;
            changed(entry);
          }
        },
        operation(_kind, parent) {
          const inherited = parent ? state.tickets.get(parent) : state.applying;
          const validParent = inherited && !inherited.done && inherited.entry === entry;
          if (
            state.gate &&
            state.external !== entry &&
            (!validParent || inherited.root > state.gate.boundary)
          )
            return null;
          if (
            state.entries.get(entry.id) !== entry ||
            (!validParent && state.workSequence >= Number.MAX_SAFE_INTEGER)
          )
            return null;
          if (
            state.works.size >= NATIVE_INPUT_WORK_LIMITS.global ||
            [...state.works].filter((pending) => pending.entry === entry).length >=
              NATIVE_INPUT_WORK_LIMITS.owner
          )
            return null;
          const work: Work = {
            entry,
            done: false,
            root: validParent ? inherited.root : ++state.workSequence,
          };
          state.works.add(work);
          const ticket: NativeInputWork = Object.assign(
            () => {
              if (work.done) return;
              work.done = true;
              state.works.delete(work);
              for (const wake of state.gate?.wake ?? []) wake();
            },
            {
              apply<T>(callback: () => T): T {
                if (work.done)
                  throw new ClosureError("busy", `${configuration.subject} work already settled`);
                const previous = state.applying;
                state.applying = work;
                try {
                  return callback();
                } finally {
                  state.applying = previous;
                }
              },
            },
          );
          state.tickets.set(ticket, work);
          return Object.freeze(ticket);
        },
      };
    },
    beginInputClosure(
      sessionId: string,
      options: { owner: object; timeoutMs: number; signal?: AbortSignal },
    ): NativeInputClosure<Kind> {
      if (
        !sessionId ||
        !options.owner ||
        typeof options.owner !== "object" ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs < 0
      )
        throw new ClosureError("invalid-scope");
      if (state.gate)
        throw new ClosureError("busy", `Another ${configuration.noun} closure owns admission`);
      const roster = [...state.entries.values()];
      if (
        state.exhausted ||
        state.overflow ||
        roster.some((entry) => !entry.controls || !entry.controls.canClose())
      )
        throw new ClosureError("busy", `${configuration.subject} input cannot be closed safely`);
      const gate: Gate = {
        owner: options.owner,
        roster,
        boundary: state.workSequence,
        invalid: false,
        released: false,
        deadline: Date.now() + options.timeoutMs,
        signal: options.signal,
        wake: new Set(),
      };
      state.gate = gate;
      const captureRaw = this.captureInputs.bind(this);
      let captured: NativeInputLease<Kind> | undefined;
      const valid = () =>
        state.gate === gate &&
        !gate.released &&
        !gate.invalid &&
        !gate.signal?.aborted &&
        Date.now() < gate.deadline &&
        state.entries.size === roster.length &&
        roster.every((entry) => state.entries.get(entry.id) === entry);
      const abort = () => {
        gate.invalid = true;
        for (const wake of gate.wake) wake();
      };
      const timer = setTimeout(abort, Math.max(0, options.timeoutMs));
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        for (const entry of roster) entry.controls!.close(true);
      } catch (error) {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        state.gate = undefined;
        for (const entry of roster) entry.controls?.close(false);
        throw error;
      }
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const closure: NativeInputClosure<Kind> = Object.freeze({
        async capture() {
          if (captured) {
            if (!valid() || !captured.current())
              throw new ClosureError("busy", "Original editor capture changed");
            return captured;
          }
          while (state.works.size) {
            if (!valid())
              throw new ClosureError(
                "busy",
                `${configuration.subject} closure invalidated or expired`,
              );
            await new Promise<void>((resolve) => {
              const wake = () => {
                gate.wake.delete(wake);
                resolve();
              };
              gate.wake.add(wake);
            });
          }
          if (!valid())
            throw new ClosureError(
              "busy",
              `${configuration.subject} closure invalidated or expired`,
            );
          captured = await captureRaw(sessionId);
          if (!valid()) {
            captured.release();
            throw new ClosureError("busy", `${configuration.subject} roster changed`);
          }
          return captured;
        },
        current: () => valid() && (!captured || captured.current()),
        release() {
          if (gate.released) return;
          gate.released = true;
          clearTimeout(timer);
          clearTimeout(watchdog);
          options.signal?.removeEventListener("abort", abort);
          captured?.release();
          if (state.gate === gate) {
            state.gate = undefined;
            for (const entry of state.entries.values()) entry.controls?.close(false);
            for (const controls of state.overflowControls) controls.close(false);
          }
          for (const wake of gate.wake) wake();
          gate.wake.clear();
        },
      });
      // A checkpoint that never releases would leave editors read-only forever.
      // Past its deadline plus a grace, reopen admission instead of waiting on it, but
      // never while a write admitted before the closure is still running: reopening then
      // lets a new edit race the checkpoint. That wait is bounded too.
      const watchdogStart = Date.now();
      const watchdogDelay = Math.max(0, options.timeoutMs) + NATIVE_INPUT_CLOSURE_WATCHDOG_MS;
      const check = () => {
        if (gate.released) return;
        const writing = [...state.works].some((work) => !work.done && work.root <= gate.boundary);
        if (
          writing &&
          Date.now() - watchdogStart < watchdogDelay + NATIVE_INPUT_CLOSURE_WRITE_EXTENSION_MS
        ) {
          watchdog = setTimeout(check, 1_000);
          (watchdog as { unref?: () => void }).unref?.();
          return;
        }
        console.warn(
          `[closure] ${configuration.subject} closure was never released; reopening input`,
        );
        closure.release();
      };
      watchdog = setTimeout(check, watchdogDelay);
      (watchdog as { unref?: () => void }).unref?.();
      return closure;
    },
    async captureInputs(sessionId: string): Promise<NativeInputLease<Kind>> {
      if (
        typeof sessionId !== "string" ||
        !sessionId ||
        sessionId.length > 512 ||
        [...sessionId].some((value) => value.charCodeAt(0) < 32 || value.charCodeAt(0) === 127)
      )
        throw new ClosureError("invalid-scope");
      if (state.exhausted || state.overflow || state.leases >= MAX_LEASES)
        throw new ClosureError("capacity");
      const startedEpoch = state.epoch;
      const roster = [...state.entries.values()];
      const missing = new Set([
        `${configuration.coveragePrefix}-profile-shared`,
        ...(state.gate
          ? [
              `${configuration.coveragePrefix}-known-routes-only`,
              `${configuration.coveragePrefix}-view-aliases`,
              `${configuration.coveragePrefix}-surface-inventory`,
              `${configuration.coveragePrefix}-ime-platform`,
            ]
          : [`${configuration.coveragePrefix}-admission-open`]),
        "buffers",
        "filesystem",
        "actor-inventory",
        "application-through",
      ]);
      let readBytes = 0;
      const reads = roster.map((entry) => {
        const value = observe(entry);
        readBytes += encoder.encode(JSON.stringify(value)).byteLength;
        if (readBytes > MAX_BYTES) throw new ClosureError("capacity");
        if (value.busy) throw new ClosureError("busy", value.busy);
        for (const item of value.missingCoverage ?? []) {
          if (
            typeof item !== "string" ||
            !/^[a-z][a-z0-9-]{0,127}$/.test(item) ||
            (!missing.has(item) && missing.size >= 32)
          )
            throw new ClosureError("capacity");
          missing.add(item);
        }
        return value;
      });
      const snapshots = copyNativeCaptureData(
        roster.map((entry, index) => ({
          id: entry.id,
          revision: entry.revision,
          kind: configuration.kind,
          snapshot: reads[index].snapshot,
        })),
      );
      const bytes = encoder.encode(JSON.stringify(snapshots)).byteLength;
      if (state.epoch !== startedEpoch || state.entries.size !== roster.length)
        throw new ClosureError("busy", `${configuration.subject} roster changed during capture`);
      if (bytes > MAX_BYTES || state.retainedBytes + bytes > MAX_BYTES || state.exhausted)
        throw new ClosureError("capacity");
      const registryEpoch = state.epoch;
      state.leases++;
      state.retainedBytes += bytes;
      let released = false;
      return Object.freeze({
        registryEpoch,
        snapshots,
        missingCoverage: Object.freeze([...missing].sort()),
        current() {
          if (
            released ||
            state.exhausted ||
            state.overflow ||
            state.epoch !== registryEpoch ||
            state.generation !== generation ||
            state.entries.size !== roster.length
          )
            return false;
          try {
            return roster.every(
              (entry, index) =>
                state.entries.get(entry.id) === entry &&
                entry.revision === snapshots[index].revision &&
                equal(observe(entry), reads[index]),
            );
          } catch {
            return false;
          }
        },
        release() {
          if (!released) {
            released = true;
            state.leases--;
            state.retainedBytes -= bytes;
          }
        },
      });
    },
  };
}

/** Shared engine; callers supply their own kind, error identity and keeper. */
export function createNativeInputClosureRegistry<Kind extends string>(
  options: NativeInputRegistryOptions<Kind>,
) {
  const globals = globalThis as unknown as Record<symbol, State | undefined>;
  const state = options.globalKey ? (globals[Symbol.for(options.globalKey)] ??= fresh()) : fresh();
  return implement(state, options);
}
