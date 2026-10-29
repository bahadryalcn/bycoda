import {
  copyNativeCaptureData,
  isNativeCaptureObject,
} from "../../../shared/lib/native-capture-json";

export type MountedEditorRead = Readonly<{
  snapshot: Record<string, unknown>;
  busy?: string;
  missingCoverage?: readonly string[];
}>;
export type MountedEditorInputLease = Readonly<{
  registryEpoch: number;
  snapshots: readonly Readonly<{
    id: number;
    revision: number;
    kind: "file-editor";
    snapshot: Record<string, unknown>;
  }>[];
  missingCoverage: readonly string[];
  current(): boolean;
  release(): void;
}>;
export interface MountedEditorRegistration {
  changed(): void;
  refresh(): void;
  unregister(): void;
  closed(): boolean;
  allowed(): boolean;
  external<T>(apply: () => T): T;
  operation(kind: string, parent?: EditorWorkTicket): EditorWorkTicket | null;
}
export type EditorWorkTicket = (() => void) & { apply<T>(callback: () => T): T };
export type EditorInputClosure = Readonly<{
  capture(): Promise<MountedEditorInputLease>;
  current(): boolean;
  release(): void;
}>;
type Controls = { canClose(): boolean; close(closed: boolean): void };
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
export class MountedEditorClosureError extends Error {
  constructor(
    readonly code: "busy" | "capacity" | "invalid-snapshot" | "invalid-scope",
    message: string = code,
  ) {
    super(message);
    this.name = "MountedEditorClosureError";
  }
}
type Entry = {
  id: number;
  revision: number;
  generation: number;
  read(): MountedEditorRead;
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
  tickets: WeakMap<EditorWorkTicket, Work>;
  workSequence: number;
  applying?: Work;
  external?: Entry;
};
const MAX_MOUNTS = 256;
const MAX_LEASES = 32;
const MAX_BYTES = 64 * 1024 * 1024;
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
function implement(state: State) {
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
  function observe(entry: Entry): MountedEditorRead {
    if (entry.generation !== generation)
      throw new MountedEditorClosureError("busy", "Editor implementation changed");
    try {
      const value = copyNativeCaptureData(entry.read());
      if (
        !isNativeCaptureObject(value.snapshot) ||
        (value.busy !== undefined && typeof value.busy !== "string") ||
        (value.missingCoverage !== undefined && !Array.isArray(value.missingCoverage))
      )
        throw new MountedEditorClosureError("invalid-snapshot");
      return value;
    } catch (error) {
      if (error instanceof MountedEditorClosureError) throw error;
      throw new MountedEditorClosureError("invalid-snapshot");
    }
  }
  function changed(entry: Entry) {
    if (state.entries.get(entry.id) !== entry) return;
    if (entry.revision >= Number.MAX_SAFE_INTEGER) state.exhausted = true;
    else entry.revision++;
    bump();
  }
  return {
    register(read: () => MountedEditorRead, controls?: Controls): MountedEditorRegistration {
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
          operation: () => {
            if (state.gate) return null;
            let done = false;
            return Object.freeze(
              Object.assign(
                () => {
                  done = true;
                },
                {
                  apply<T>(apply: () => T): T {
                    if (done) throw new MountedEditorClosureError("busy");
                    return apply();
                  },
                },
              ),
            );
          },
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
          const work: Work = {
            entry,
            done: false,
            root: validParent ? inherited.root : ++state.workSequence,
          };
          state.works.add(work);
          const ticket: EditorWorkTicket = Object.assign(
            () => {
              if (work.done) return;
              work.done = true;
              state.works.delete(work);
              for (const wake of state.gate?.wake ?? []) wake();
            },
            {
              apply<T>(callback: () => T): T {
                if (work.done)
                  throw new MountedEditorClosureError("busy", "Editor work already settled");
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
    beginEditorInputClosure(
      sessionId: string,
      options: { owner: object; timeoutMs: number; signal?: AbortSignal },
    ): EditorInputClosure {
      if (
        !sessionId ||
        !options.owner ||
        typeof options.owner !== "object" ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs < 0
      )
        throw new MountedEditorClosureError("invalid-scope");
      if (state.gate)
        throw new MountedEditorClosureError("busy", "Another editor closure owns admission");
      const roster = [...state.entries.values()];
      if (
        state.exhausted ||
        state.overflow ||
        roster.some((entry) => !entry.controls || !entry.controls.canClose())
      )
        throw new MountedEditorClosureError("busy", "Editor input cannot be closed safely");
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
      const captureRaw = this.captureEditorInputs.bind(this);
      let captured: MountedEditorInputLease | undefined;
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
      return Object.freeze({
        async capture() {
          if (captured) {
            if (!valid() || !captured.current())
              throw new MountedEditorClosureError("busy", "Original editor capture changed");
            return captured;
          }
          while (state.works.size) {
            if (!valid())
              throw new MountedEditorClosureError("busy", "Editor closure invalidated or expired");
            await new Promise<void>((resolve) => {
              const wake = () => {
                gate.wake.delete(wake);
                resolve();
              };
              gate.wake.add(wake);
            });
          }
          if (!valid())
            throw new MountedEditorClosureError("busy", "Editor closure invalidated or expired");
          captured = await captureRaw(sessionId);
          if (!valid()) {
            captured.release();
            throw new MountedEditorClosureError("busy", "Editor roster changed");
          }
          return captured;
        },
        current: () => valid() && (!captured || captured.current()),
        release() {
          if (gate.released) return;
          gate.released = true;
          clearTimeout(timer);
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
    },
    async captureEditorInputs(sessionId: string): Promise<MountedEditorInputLease> {
      if (
        typeof sessionId !== "string" ||
        !sessionId ||
        sessionId.length > 512 ||
        [...sessionId].some((value) => value.charCodeAt(0) < 32 || value.charCodeAt(0) === 127)
      )
        throw new MountedEditorClosureError("invalid-scope");
      if (state.exhausted || state.overflow || state.leases >= MAX_LEASES)
        throw new MountedEditorClosureError("capacity");
      const startedEpoch = state.epoch;
      const roster = [...state.entries.values()];
      const missing = new Set([
        "editor-profile-shared",
        ...(state.gate
          ? [
              "editor-known-routes-only",
              "editor-view-aliases",
              "editor-surface-inventory",
              "editor-ime-platform",
            ]
          : ["editor-admission-open"]),
        "buffers",
        "filesystem",
        "actor-inventory",
        "application-through",
      ]);
      let readBytes = 0;
      const reads = roster.map((entry) => {
        const value = observe(entry);
        readBytes += encoder.encode(JSON.stringify(value)).byteLength;
        if (readBytes > MAX_BYTES) throw new MountedEditorClosureError("capacity");
        if (value.busy) throw new MountedEditorClosureError("busy", value.busy);
        for (const item of value.missingCoverage ?? []) {
          if (
            typeof item !== "string" ||
            !/^[a-z][a-z0-9-]{0,127}$/.test(item) ||
            (!missing.has(item) && missing.size >= 32)
          )
            throw new MountedEditorClosureError("capacity");
          missing.add(item);
        }
        return value;
      });
      const snapshots = copyNativeCaptureData(
        roster.map((entry, index) => ({
          id: entry.id,
          revision: entry.revision,
          kind: "file-editor" as const,
          snapshot: reads[index].snapshot,
        })),
      );
      const bytes = encoder.encode(JSON.stringify(snapshots)).byteLength;
      if (state.epoch !== startedEpoch || state.entries.size !== roster.length)
        throw new MountedEditorClosureError("busy", "Editor roster changed during capture");
      if (bytes > MAX_BYTES || state.retainedBytes + bytes > MAX_BYTES || state.exhausted)
        throw new MountedEditorClosureError("capacity");
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
export function createMountedEditorClosure() {
  return implement(fresh());
}
const key = Symbol.for("bycoda.mounted-file-editor-closure.v1");
const globals = globalThis as typeof globalThis & { [key]?: State };
const mounted = implement((globals[key] ??= fresh()));
export const registerMountedEditor = mounted.register;
export const captureEditorInputs = mounted.captureEditorInputs;
export const beginEditorInputClosure = mounted.beginEditorInputClosure.bind(mounted);
