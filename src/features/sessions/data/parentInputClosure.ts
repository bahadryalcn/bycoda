import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  copyNativeCaptureData,
  isNativeCaptureObject,
  NativeCaptureJsonError,
  NATIVE_CAPTURE_JSON_LIMITS,
} from "../../../shared/lib/native-capture-json";

export type ParentInputKind =
  | "approval-decision"
  | "question-draft"
  | "session-parent"
  | "composer-parent"
  | "queue-edit"
  | "btw-parent";
export type ParentInputAdapter = {
  kind: ParentInputKind;
  sessionId?: string;
  /** Explicit shared-profile data; an absent session alone never selects this scope. */
  scope?: "profile";
  snapshot(): Record<string, unknown>;
  composing?(): boolean;
  ownsCurrent?(): boolean;
  externalIdentity?: readonly unknown[];
  missingCoverage?: readonly string[];
};
export type ParentInputSnapshot = Readonly<{
  id: number;
  revision: number;
  kind: ParentInputKind;
  sessionId?: string;
  snapshot: Readonly<Record<string, unknown>>;
}>;
export type ParentAdmission = {
  apply<T>(operation: () => T): T;
  run<T>(operation: () => T | Promise<T>): Promise<T>;
  finish(): void;
  readonly settled: boolean;
  resume(): ParentAdmission | null;
};
export type ParentInputHandle = (() => void) & {
  canMutate(): boolean;
  admit(): ParentAdmission | null;
  continue<T>(admission: ParentAdmission, operation: () => T): T | false;
  composing(): boolean;
  identity(): object | null;
};
export type ParentInputClosure = {
  capture(): Promise<ParentInputCapture>;
  current(): boolean;
  release(): void;
};
type Close = {
  sessionId: string;
  owner: object;
  deadline: number;
  invalid: boolean;
  gated: boolean;
  released: boolean;
  capture?: Promise<ParentInputCapture>;
  lease?: ParentInputCapture;
  wake: Set<() => void>;
};
type Binding = {
  adapter: ParentInputAdapter;
  revision: number;
  retired: boolean;
  applying: number;
  observed?: Record<string, unknown>;
  observedCharge?: number;
  observationFailed?: boolean;
};
type InputScope = Pick<ParentInputAdapter, "sessionId" | "scope">;
function includesTarget(source: InputScope, sessionId: string): boolean {
  return source.scope === "profile" || source.sessionId === sessionId;
}
function sameInputScope(a: InputScope, b: InputScope): boolean {
  return a.scope === b.scope && a.sessionId === b.sessionId;
}
export type ParentInputCapture = Readonly<{
  registryEpoch: number;
  snapshots: readonly ParentInputSnapshot[];
  missingCoverage: readonly string[];
  current(): boolean;
  release(): void;
}>;

export const PARENT_INPUT_LIMITS = Object.freeze({
  records: 256,
  leases: 4,
  bytes: 64 * 1024 * 1024,
});
const capacity = (): never => {
  throw new NativeCaptureJsonError("capacity");
};

/** Conservative retained-data charge, not a physical RSS measurement. Validate
 * descriptors and bound traversal BEFORE allocating another immutable copy. */
function chargeFor(value: unknown): number {
  let nodes = 0;
  let charge = 0;
  const visiting = new Set<object>();
  const add = (bytes: number) => {
    charge += bytes;
    if (charge > PARENT_INPUT_LIMITS.bytes) capacity();
  };
  const invalid = (): never => {
    throw new NativeCaptureJsonError("invalid");
  };
  const walk = (input: unknown, depth = 0): void => {
    if (++nodes > NATIVE_CAPTURE_JSON_LIMITS.nodes || depth > NATIVE_CAPTURE_JSON_LIMITS.depth)
      capacity();
    add(64);
    if (typeof input === "string") {
      add(input.length * 2);
      return;
    }
    if (input === undefined || input === null || typeof input === "boolean") return;
    if (typeof input === "number") {
      if (!Number.isFinite(input) || Object.is(input, -0)) invalid();
      return;
    }
    if (!input || typeof input !== "object" || visiting.has(input)) invalid();
    const array = Array.isArray(input);
    if (array ? Object.getPrototypeOf(input) !== Array.prototype : !isNativeCaptureObject(input))
      invalid();
    const keys = Reflect.ownKeys(input);
    if (keys.length > NATIVE_CAPTURE_JSON_LIMITS.nodes + 1) capacity();
    if (array && keys.length !== input.length + 1) invalid();
    visiting.add(input);
    try {
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string") return invalid();
        const property = Object.getOwnPropertyDescriptor(input, key)!;
        if (!property.enumerable || !("value" in property)) invalid();
        if (array && (property.value === undefined || !/^(0|[1-9][0-9]*)$/.test(key))) invalid();
        add(key.length * 2);
        walk(property.value, depth + 1);
      }
    } finally {
      visiting.delete(input);
    }
  };
  walk(value);
  return charge;
}

// Passive capture remains compatible. An explicit owned begin() additionally
// gates known local entry points; neither path saves/restores or grants a
// provider decision, Native authority or complete producer coverage.
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (key, index) =>
        key === bk[index] &&
        equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

/** `equal` against a validated copy, also rejecting shapes copy would refuse. */
function sameAsObserved(observed: unknown, raw: unknown): boolean {
  if (typeof raw === "number") return Object.is(observed, raw) && Number.isFinite(raw);
  if (!observed || !raw || typeof observed !== "object" || typeof raw !== "object")
    return Object.is(observed, raw);
  const array = Array.isArray(observed);
  if (array !== Array.isArray(raw)) return false;
  if (array ? Object.getPrototypeOf(raw) !== Array.prototype : !isNativeCaptureObject(raw))
    return false;
  const keys = Object.keys(observed);
  const rawKeys = Object.keys(raw);
  if (keys.length !== rawKeys.length) return false;
  if (Reflect.ownKeys(raw).length !== keys.length + (array ? 1 : 0)) return false;
  return keys.every(
    (key, index) =>
      key === rawKeys[index] &&
      sameAsObserved(
        (observed as Record<string, unknown>)[key],
        (raw as Record<string, unknown>)[key],
      ),
  );
}

export class ParentInputRegistry {
  private epoch = 0;
  private nextId = 0;
  private bindings = new Map<number, Binding>();
  private closes = new Map<string, Close>();
  private listeners = new Set<() => void>();
  private jobs = new Map<object, InputScope & { done: Promise<void> }>();
  private overflowJobs = 0;
  private implementation = 0;
  // A string remains compatible with an original scoped ticket across module reload.
  private applyingScope?: string | InputScope;
  private lineages?: WeakMap<ParentAdmission, InputScope & { active(): boolean }>;
  private originalLineage(admission: ParentAdmission, sessionId?: string, scope?: "profile") {
    const lineage = this.lineages?.get(admission);
    return (
      !!lineage &&
      (!!sessionId || scope === "profile") &&
      sameInputScope(lineage, { sessionId, scope }) &&
      lineage.active()
    );
  }
  canPublish(sessionId?: string, scope?: "profile") {
    const applying =
      typeof this.applyingScope === "string"
        ? { sessionId: this.applyingScope }
        : this.applyingScope;
    return (
      !this.closed(sessionId, scope) ||
      (!!applying &&
        (!!sessionId || scope === "profile") &&
        sameInputScope(applying, { sessionId, scope }))
    );
  }
  private overflow = 0;
  private exhausted = false;
  private retainedBytes = 0;
  private leaseBytes = 0;
  private observedBytes = 0;
  private leases = 0;
  private failedRecords = 0;
  private readonly limits: Readonly<{
    records: number;
    leases: number;
    bytes: number;
  }>;

  constructor(limits: Partial<{ records: number; leases: number; bytes: number }> = {}) {
    this.limits = Object.freeze({ ...PARENT_INPUT_LIMITS, ...limits });
    for (const key of ["records", "leases", "bytes"] as const) {
      if (
        !Number.isSafeInteger(this.limits[key]) ||
        this.limits[key] <= 0 ||
        this.limits[key] > PARENT_INPUT_LIMITS[key]
      ) {
        throw new Error("Invalid Parent input registry budget");
      }
    }
  }

  inspect() {
    return Object.freeze({
      records: this.bindings.size,
      overflow: this.overflow,
      retainedBytes: this.retainedBytes,
      leaseBytes: this.leaseBytes,
      observedBytes: this.observedBytes ?? 0,
      leases: this.leases,
      failedRecords: this.failedRecords,
      incomplete: this.exhausted || this.overflow > 0 || this.failedRecords > 0,
      pendingJobs: this.jobs.size,
      overflowJobs: this.overflowJobs,
    });
  }

  private changed() {
    if (!Number.isSafeInteger(this.epoch + 1)) this.exhausted = true;
    else this.epoch++;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  closed = (sessionId?: string, scope?: "profile") =>
    scope === "profile"
      ? [...this.closes.values()].some((close) => close.gated && !close.released)
      : !!sessionId && this.closes.get(sessionId)?.gated === true;
  private notify() {
    const listeners = Array.from(this.listeners);
    for (const listener of listeners) listener();
    for (const close of this.closes.values()) {
      const waking = Array.from(close.wake);
      for (const wake of waking) wake();
    }
  }
  private invalidate(sessionId?: string, scope?: "profile") {
    for (const close of this.closes.values())
      if (includesTarget({ sessionId, scope }, close.sessionId)) close.invalid = true;
    this.notify();
  }
  invalidateForModuleReload() {
    this.implementation++;
    this.changed();
    for (const close of this.closes.values()) close.invalid = true;
    this.notify();
  }
  private overflowAdmission(
    sessionId: string | undefined,
    owns: () => boolean,
    scope?: "profile",
  ): ParentAdmission | null {
    if (this.closed(sessionId, scope)) return null;
    this.overflowJobs++;
    let finished = false;
    let running = false;
    let resumed = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        this.overflowJobs--;
        this.notify();
      }
    };
    return {
      get settled() {
        return finished;
      },
      resume: () => {
        if (!finished || resumed || !owns()) return null;
        resumed = true;
        return this.overflowAdmission(sessionId, owns, scope);
      },
      apply: <T>(operation: () => T) => {
        if (finished || !owns()) throw new Error("Parent admission owner changed");
        const previous = this.applyingScope;
        this.applyingScope = { sessionId, scope };
        try {
          return operation();
        } finally {
          this.applyingScope = previous;
        }
      },
      run: async <T>(operation: () => T | Promise<T>) => {
        if (finished || running) throw new Error("Parent admission already running");
        running = true;
        try {
          return await operation();
        } finally {
          running = false;
          finish();
        }
      },
      finish: () => {
        if (!running) finish();
      },
    };
  }

  begin(
    sessionId: string,
    options: { owner: object; timeoutMs: number; signal?: AbortSignal },
  ): ParentInputClosure {
    if (
      !sessionId ||
      !options.owner ||
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0
    )
      throw new Error("Invalid Parent closure scope");
    if (this.closes.has(sessionId)) throw new Error("Parent input closure busy");
    if (this.closes.size >= PARENT_INPUT_LIMITS.leases) capacity();
    const composing = [...this.bindings.values()].some(
      (entry) => includesTarget(entry.adapter, sessionId) && entry.adapter.composing?.(),
    );
    const close: Close = {
      sessionId,
      owner: options.owner,
      deadline: performance.now() + options.timeoutMs,
      invalid: composing,
      gated: !composing,
      released: false,
      wake: new Set(),
    };
    this.closes.set(sessionId, close);
    const invalidate = () => {
      close.invalid = true;
      this.notify();
    };
    const timer = setTimeout(invalidate, options.timeoutMs);
    options.signal?.addEventListener("abort", invalidate, { once: true });
    if (options.signal?.aborted) invalidate();
    this.notify();
    const current = () =>
      !close.released &&
      !close.invalid &&
      performance.now() < close.deadline &&
      this.closes.get(sessionId) === close &&
      ![...this.bindings.values()].some(
        (entry) =>
          includesTarget(entry.adapter, sessionId) && entry.adapter.ownsCurrent?.() === false,
      ) &&
      (!close.lease || close.lease.current());
    const assert = () => {
      if (!current()) throw new Error("Parent input closure changed or cancelled");
    };
    return {
      current,
      capture: () =>
        (close.capture ??= (async () => {
          assert();
          while (
            this.overflowJobs ||
            [...this.jobs.values()].some((job) => includesTarget(job, sessionId))
          ) {
            await new Promise<void>((resolve) => {
              close.wake.add(resolve);
              queueMicrotask(() => {
                if (
                  !current() ||
                  (!this.overflowJobs &&
                    ![...this.jobs.values()].some((job) => includesTarget(job, sessionId)))
                )
                  resolve();
              });
            });
            close.wake.clear();
            assert();
          }
          for (const entry of this.bindings.values())
            if (includesTarget(entry.adapter, sessionId) && entry.adapter.composing?.()) {
              close.invalid = true;
              throw new Error("Parent input closure composing");
            }
          const captured = await this.capture(sessionId);
          if (!current()) {
            captured.release();
            assert();
          }
          close.lease = captured;
          assert();
          return close.lease;
        })()),
      release: () => {
        if (close.released) return;
        close.released = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", invalidate);
        if (this.closes.get(sessionId) === close) this.closes.delete(sessionId);
        close.lease?.release();
        for (const wake of close.wake) wake();
        close.wake.clear();
        this.notify();
      },
    };
  }

  private copy<T>(input: T, kind: "retainedBytes" | "leaseBytes" | "observedBytes") {
    this.observedBytes ??= 0;
    const charge = chargeFor(input);
    if (charge > this.limits.bytes - this.retainedBytes - this.leaseBytes - this.observedBytes)
      capacity();
    this[kind] += charge;
    try {
      return { data: copyNativeCaptureData(input), charge };
    } catch (error) {
      this[kind] -= charge;
      throw error;
    }
  }

  register(adapter: ParentInputAdapter) {
    const original = adapter;
    const sessionId = adapter.sessionId;
    const scope = adapter.scope;
    const validScope = scope === undefined || (scope === "profile" && sessionId === undefined);
    const kind = adapter.kind;
    adapter = {
      sessionId,
      scope,
      kind,
      snapshot: () => original.snapshot(),
      composing: () => !!original.composing?.(),
      ownsCurrent: () =>
        original.sessionId === sessionId &&
        original.scope === scope &&
        validScope &&
        original.kind === kind &&
        original.ownsCurrent?.() !== false,
      get missingCoverage() {
        return original.missingCoverage;
      },
    };
    if (
      !validScope ||
      this.bindings.size >= this.limits.records ||
      this.exhausted ||
      !Number.isSafeInteger(this.nextId + 1)
    ) {
      // Keep a bounded failure marker, never evict an unknown original or throw
      // into a normal mount/send/paste merely because its observer is full.
      if (Number.isSafeInteger(this.overflow + 1)) this.overflow++;
      else this.exhausted = true;
      this.changed();
      this.invalidate(adapter.sessionId, adapter.scope);
      let retired = false;
      let applying = 0;
      const wrapOverflow = (admitted: ParentAdmission): ParentAdmission => {
        let active = 0;
        const wrapped: ParentAdmission = {
          get settled() {
            return admitted.settled;
          },
          finish: admitted.finish,
          run: admitted.run,
          resume: () => {
            const next = admitted.resume();
            return next ? wrapOverflow(next) : null;
          },
          apply: <T>(operation: () => T) => {
            applying++;
            active++;
            try {
              return admitted.apply(operation);
            } finally {
              active--;
              applying--;
            }
          },
        };
        (this.lineages ??= new WeakMap()).set(wrapped, {
          sessionId: adapter.sessionId,
          scope: adapter.scope,
          active: () => active > 0 && !admitted.settled && adapter.ownsCurrent?.() !== false,
        });
        return wrapped;
      };
      const admitOverflow = (): ParentAdmission | null => {
        if (retired) return null;
        const admitted = this.overflowAdmission(
          adapter.sessionId,
          () => adapter.ownsCurrent?.() !== false,
          adapter.scope,
        );
        if (!admitted) return null;
        return wrapOverflow(admitted);
      };
      return {
        recorded: false,
        observe: (_notified = false) => {},
        canMutate: () =>
          applying > 0 || (!retired && !this.closed(adapter.sessionId, adapter.scope)),
        committed: () => {
          if (!retired) this.invalidate(adapter.sessionId, adapter.scope);
        },
        admit: admitOverflow,
        continue: <T>(admission: ParentAdmission, operation: () => T): T | false => {
          if (
            retired ||
            adapter.ownsCurrent?.() === false ||
            !this.originalLineage(admission, adapter.sessionId, adapter.scope)
          )
            return false;
          applying++;
          try {
            return operation();
          } finally {
            applying--;
            this.invalidate(adapter.sessionId, adapter.scope);
          }
        },
        changed: () => {
          if (!retired) {
            this.changed();
            this.invalidate(adapter.sessionId, adapter.scope);
          }
        },
        release: () => {
          if (!retired) {
            retired = true;
            this.overflow--;
            this.changed();
            this.invalidate(adapter.sessionId, adapter.scope);
          }
        },
      };
    }
    const id = ++this.nextId;
    const entry: Binding = {
      adapter,
      revision: 0,
      retired: false,
      applying: 0,
    };
    this.bindings.set(id, entry);
    this.changed();
    this.invalidate(adapter.sessionId, adapter.scope);
    let retired = false;
    const mutate = (accepted: boolean) => {
      if (!Number.isSafeInteger(entry.revision + 1)) this.exhausted = true;
      else entry.revision++;
      this.changed();
      if (!accepted) this.invalidate(adapter.sessionId, adapter.scope);
    };
    const observe = (notified = false) => {
      if (retired) return;
      try {
        // Share the registry's aggregate byte/node bounds. Never retain a live
        // mutable alias as the value of an already-notified producer mutation.
        const snapshot = adapter.snapshot();
        if (!isNativeCaptureObject(snapshot)) throw new NativeCaptureJsonError("invalid");
        // Cheap path: raw snapshot already equals the validated copy; skip charge/copy.
        if (entry.observed && !entry.observationFailed && sameAsObserved(entry.observed, snapshot))
          return;
        const copied = this.copy(snapshot, "observedBytes");
        const different = !entry.observed || !equal(entry.observed, copied.data);
        this.observedBytes -= entry.observedCharge ?? 0;
        entry.observed = copied.data;
        entry.observedCharge = copied.charge;
        if (entry.observationFailed) this.failedRecords--;
        entry.observationFailed = false;
        if (different && !notified) mutate(entry.applying > 0);
      } catch {
        if (!entry.observationFailed) this.failedRecords++;
        entry.observationFailed = true;
        // Observation must never throw into ordinary edits. This exact record
        // is held until a later bounded observation succeeds or it retires.
        this.invalidate(adapter.sessionId, adapter.scope);
      }
    };
    const admit = (resuming = false): ParentAdmission | null => {
      if (
        resuming
          ? adapter.ownsCurrent?.() === false
          : retired || this.closed(adapter.sessionId, adapter.scope)
      )
        return null;
      // Recovery is an old lineage, not permission to keep an already captured
      // observation current while another actual attempt is being admitted.
      if (resuming) {
        for (const close of this.closes.values())
          if (close.lease && includesTarget(adapter, close.sessionId)) close.invalid = true;
        this.notify();
      }
      const key = {};
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const tracked = this.jobs.size < 64;
      if (tracked)
        this.jobs.set(key, {
          sessionId: adapter.sessionId,
          scope: adapter.scope,
          done,
        });
      else this.overflowJobs++;
      let settled = false;
      let running = false;
      let resumed = false;
      let active = 0;
      const complete = () => {
        if (settled) return;
        settled = true;
        if (tracked) this.jobs.delete(key);
        else this.overflowJobs--;
        finish();
        this.notify();
      };
      const admission: ParentAdmission = {
        get settled() {
          return settled;
        },
        resume: () => {
          if (!settled || resumed) return null;
          resumed = true;
          return admit(true);
        },
        apply: <T>(operation: () => T): T => {
          if (settled || adapter.ownsCurrent?.() === false)
            throw new Error("Parent admission owner changed");
          entry.applying++;
          active++;
          const previousScope = this.applyingScope;
          this.applyingScope = {
            sessionId: adapter.sessionId,
            scope: adapter.scope,
          };
          try {
            const result = operation();
            mutate(true);
            return result;
          } finally {
            entry.applying--;
            active--;
            this.applyingScope = previousScope;
          }
        },
        run: async <T>(operation: () => T | Promise<T>) => {
          if (settled || running) throw new Error("Parent admission already running");
          running = true;
          try {
            return await operation();
          } finally {
            running = false;
            complete();
          }
        },
        finish: () => {
          if (!running) complete();
        },
      };
      (this.lineages ??= new WeakMap()).set(admission, {
        sessionId: adapter.sessionId,
        scope: adapter.scope,
        active: () => active > 0 && !settled && adapter.ownsCurrent?.() !== false,
      });
      return admission;
    };
    return {
      recorded: true,
      observe,
      canMutate: () =>
        entry.applying > 0 || (!retired && !this.closed(adapter.sessionId, adapter.scope)),
      admit: () => admit(),
      continue: <T>(admission: ParentAdmission, operation: () => T): T | false => {
        if (
          retired ||
          adapter.ownsCurrent?.() === false ||
          !this.originalLineage(admission, adapter.sessionId, adapter.scope)
        )
          return false;
        entry.applying++;
        try {
          const result = operation();
          mutate(true);
          return result;
        } finally {
          entry.applying--;
        }
      },
      committed: () => {
        if (!retired) mutate(entry.applying > 0);
      },
      changed: () => {
        if (retired) return;
        mutate(entry.applying > 0);
      },
      release: () => {
        if (retired) return;
        retired = true;
        entry.retired = true;
        this.observedBytes -= entry.observedCharge ?? 0;
        if (entry.observationFailed) this.failedRecords--;
        this.bindings.delete(id);
        this.changed();
        this.invalidate(adapter.sessionId, adapter.scope);
      },
    };
  }

  retain(adapter: ParentInputAdapter) {
    let data: Record<string, unknown> | undefined;
    let failure: unknown = new NativeCaptureJsonError("capacity");
    let charge = 0;
    let retired = false;
    let markedFailure = true;
    const owner = this.register({
      ...adapter,
      snapshot: () => {
        if (markedFailure) throw failure ?? new NativeCaptureJsonError("invalid");
        return data!;
      },
    });
    markedFailure = owner.recorded;
    if (markedFailure) this.failedRecords++;
    const update = (next: Record<string, unknown>) => {
      if (retired || !owner.recorded) return;
      try {
        if (!isNativeCaptureObject(next)) throw new NativeCaptureJsonError("invalid");
        // Reserve the new copy while the original is still retained. Failed
        // updates keep that original and hold capture, rather than evict it.
        const copied = this.copy(next, "retainedBytes");
        this.retainedBytes -= charge;
        charge = copied.charge;
        data = copied.data;
        failure = undefined;
        if (markedFailure) {
          markedFailure = false;
          this.failedRecords--;
        }
      } catch (error) {
        failure = error;
        if (!markedFailure) {
          markedFailure = true;
          this.failedRecords++;
        }
      }
      owner.changed();
    };
    if (owner.recorded) {
      try {
        update(adapter.snapshot());
      } catch (error) {
        failure = error;
        owner.changed();
      }
    }
    return {
      update,
      release: () => {
        if (retired) return;
        retired = true;
        this.retainedBytes -= charge;
        charge = 0;
        data = undefined;
        if (markedFailure) {
          markedFailure = false;
          this.failedRecords--;
        }
        owner.release();
      },
    };
  }

  async capture(sessionId: string): Promise<ParentInputCapture> {
    if (!sessionId) throw new Error("Parent input capture requires a logical session");
    if (this.exhausted || this.overflow || this.leases >= this.limits.leases) capacity();
    const epoch = this.epoch;
    const implementation = this.implementation;
    const roster = [...this.bindings].filter(([, entry]) =>
      includesTarget(entry.adapter, sessionId),
    );
    if (roster.length > 256) throw new Error("Parent input capture capacity exceeded");
    const read = () => {
      const missing = new Set(["parent-producer-admission-closure", "decision-conservation"]);
      if (
        [...this.bindings.values()].some(
          ({ adapter }) => !adapter.sessionId && adapter.scope !== "profile",
        )
      )
        missing.add("unassigned-parent-input-scope");
      const snapshots = roster.map(([id, entry]) => {
        if (entry.observationFailed) capacity();
        if (entry.adapter.ownsCurrent?.() === false) throw new Error("Parent input owner changed");
        if (entry.adapter.composing?.()) throw new Error("Parent input capture is composing");
        const coverage = entry.adapter.missingCoverage ?? [];
        if (coverage.length > 32) capacity();
        for (const item of coverage) {
          if (typeof item !== "string" || !/^[a-z][a-z0-9-]{0,127}$/.test(item))
            throw new NativeCaptureJsonError("invalid");
          missing.add(item);
          if (missing.size > 32) capacity();
        }
        const input = entry.adapter.snapshot();
        if (!isNativeCaptureObject(input))
          throw new Error("Parent input snapshot is not plain data");
        return {
          id,
          revision: entry.revision,
          kind: entry.adapter.kind,
          ...(entry.adapter.sessionId === undefined ? {} : { sessionId: entry.adapter.sessionId }),
          snapshot: input,
        };
      });
      return { snapshots, missingCoverage: [...missing] };
    };
    // One aggregate JSON node/byte budget spans every entry and its metadata.
    const copied = this.copy(read(), "leaseBytes");
    const snapshots = copied.data.snapshots;
    this.leases++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.leases--;
      this.leaseBytes -= copied.charge;
    };
    const current = () => {
      if (released || this.exhausted || this.overflow || implementation !== this.implementation)
        return false;
      try {
        const currentRoster = [...this.bindings].filter(([, entry]) =>
          includesTarget(entry.adapter, sessionId),
        );
        if (
          currentRoster.length !== roster.length ||
          currentRoster.some(
            ([id, entry], index) => roster[index][0] !== id || roster[index][1] !== entry,
          )
        )
          return false;
        const latest = read();
        chargeFor(latest);
        return (
          roster.every(
            ([id, entry], index) =>
              this.bindings.get(id) === entry &&
              entry.revision === snapshots[index].revision &&
              !entry.adapter.composing?.(),
          ) && equal(latest, copied.data)
        );
      } catch {
        return false;
      }
    };
    if (!current()) {
      release();
      throw new Error("Parent inputs changed during capture");
    }
    return Object.freeze({
      registryEpoch: epoch,
      snapshots: Object.freeze(snapshots),
      missingCoverage: copied.data.missingCoverage,
      current,
      release,
    });
  }
}

// Keep original gates/jobs/data across compatible module reloads. Reload changes
// invalidate observations; only their original release can reopen an old gate.
// A keeper schema change requires a full renderer reload, not draft reset.
const keeperKey = Symbol.for("bycoda.parent-input-registry.v1");
const keepers = globalThis as unknown as Record<symbol, unknown>;
const previous = keepers[keeperKey] as { version: 1; registry: ParentInputRegistry } | undefined;
const registry = previous?.registry ?? new ParentInputRegistry();
if (previous) {
  Object.setPrototypeOf(registry, ParentInputRegistry.prototype);
  registry.invalidateForModuleReload();
} else keepers[keeperKey] = { version: 1, registry };
export const registerParentInput = (adapter: ParentInputAdapter) => registry.register(adapter);
export const captureParentInputs = (sessionId: string) => registry.capture(sessionId);
export const beginParentInputClosure = (
  sessionId: string,
  options: { owner: object; timeoutMs: number; signal?: AbortSignal },
) => registry.begin(sessionId, options);
export const canMutateParentInputs = (sessionId?: string, scope?: "profile") =>
  !registry.closed(sessionId, scope);
/** Only explicit draft/cache data sinks use this synchronous original-work lineage. */
export const canPublishParentInput = (sessionId?: string, scope?: "profile") =>
  registry.canPublish(sessionId, scope);
export function useParentInputsClosed(sessionId?: string, scope?: "profile"): boolean {
  return useSyncExternalStore(
    registry.subscribe,
    () => registry.closed(sessionId, scope),
    () => false,
  );
}
export function mutateParentInput<T>(handle: ParentInputHandle, operation: () => T): T | false {
  const admitted = handle.admit();
  if (!admitted) return false;
  try {
    const result = admitted.apply(operation);
    if (
      result &&
      typeof result === "object" &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      void Promise.resolve(result).then(admitted.finish, admitted.finish);
    } else admitted.finish();
    return result;
  } catch (error) {
    admitted.finish();
    throw error;
  }
}

/** An accepted void callback may outlive/remount its view. Keep its original
 * private input without pretending that the provider decision has settled. */
export function retainParentInput(adapter: ParentInputAdapter) {
  return registry.retain(adapter);
}

/** Construct callbacks without executing them or reading their captured refs. */
function parentInputHandle(
  changed: () => void,
  controls: Pick<ParentInputHandle, keyof ParentInputHandle>,
): ParentInputHandle {
  return Object.assign(() => changed(), controls);
}

/** The adapter belongs to this mount only; retirement never reads reused refs. */
export function useParentInputClosure(
  adapter: ParentInputAdapter,
  element?: RefObject<HTMLElement | null>,
): ParentInputHandle {
  const latest = useRef(adapter);
  useLayoutEffect(() => {
    latest.current = adapter;
  });
  const binding = useRef<ReturnType<typeof registerParentInput> | null>(null);
  const composing = useRef(false);
  const identity = useRef<object | null>(null);
  const changed = useCallback(() => {
    const owner = binding.current;
    if (!owner) return;
    owner.changed();
    owner.observe(true);
  }, []);
  useLayoutEffect(() => {
    const owner = registerParentInput({
      kind: adapter.kind,
      sessionId: adapter.sessionId,
      scope: adapter.scope,
      snapshot: () => latest.current.snapshot(),
      composing: () => composing.current || !!latest.current.composing?.(),
      ownsCurrent: () =>
        binding.current === owner &&
        latest.current.sessionId === adapter.sessionId &&
        latest.current.scope === adapter.scope &&
        latest.current.kind === adapter.kind,
      get missingCoverage() {
        return latest.current.missingCoverage;
      },
    });
    binding.current = owner;
    identity.current = {};
    return () => {
      owner.release();
      // Old admitted callbacks keep this retired handle; a replacement mount
      // replaces it and cannot inherit its apply capability.
    };
  }, [adapter.kind, adapter.sessionId, adapter.scope]);
  // Presentation clocks/streamed transcript renders are not input mutations.
  // Compare explicit producer fields; mutable-ref producers also call changed()
  // synchronously at acceptance/application. Capture/current make bounded copies.
  useLayoutEffect(() => {
    binding.current?.observe();
  });
  // Listeners attach once per node; the element ref may fill after first commit,
  // so a cheap per-render check re-syncs without re-adding listeners.
  const attached = useRef<{ node: HTMLElement; detach: () => void } | null>(null);
  const syncListeners = useCallback(() => {
    const node = element?.current ?? null;
    if (attached.current?.node === node) return;
    attached.current?.detach();
    attached.current = null;
    if (!node) return;
    const start = () => {
      composing.current = true;
      changed();
    };
    const beforeInput = (event: Event) => {
      if (!composing.current && !binding.current?.canMutate()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const end = () => {
      composing.current = false;
      changed();
    };
    node.addEventListener("beforeinput", beforeInput, true);
    node.addEventListener("paste", beforeInput, true);
    node.addEventListener("drop", beforeInput, true);
    node.addEventListener("input", changed, true);
    node.addEventListener("change", changed, true);
    node.addEventListener("compositionstart", start, true);
    node.addEventListener("compositionend", end, true);
    attached.current = {
      node,
      detach: () => {
        node.removeEventListener("beforeinput", beforeInput, true);
        node.removeEventListener("paste", beforeInput, true);
        node.removeEventListener("drop", beforeInput, true);
        node.removeEventListener("input", changed, true);
        node.removeEventListener("change", changed, true);
        node.removeEventListener("compositionstart", start, true);
        node.removeEventListener("compositionend", end, true);
      },
    };
  }, [element, changed]);
  useLayoutEffect(() => {
    syncListeners();
    return () => {
      attached.current?.detach();
      attached.current = null;
    };
  }, [syncListeners]);
  useLayoutEffect(() => {
    syncListeners();
  });
  return useMemo(
    () =>
      parentInputHandle(changed, {
        canMutate: () =>
          binding.current?.canMutate() ??
          !registry.closed(latest.current.sessionId, latest.current.scope),
        admit: () => binding.current?.admit() ?? null,
        continue: (admission, operation) =>
          binding.current ? binding.current.continue(admission, operation) : false,
        composing: () => composing.current,
        identity: () => identity.current,
      }),
    [changed],
  );
}
