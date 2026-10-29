import type { ComposerDraft } from "../model/draftPersistence";
import { subscribeComposerDrafts } from "../model/draftCache";
import { persistMountedComposerDraft } from "./composerDraftStore";
import {
  rendererPersistenceDrain,
  type PersistenceDrainRegistry,
  type PersistenceProducer,
  type PersistenceScope,
  type PersistenceWork,
} from "./persistenceDrain";

export class ComposerClosureError extends Error {
  constructor(
    readonly code:
      | "closed"
      | "retired"
      | "capacity"
      | "changed"
      | "deadline"
      | "cancelled"
      | "wrong-owner"
      | "composition"
      | "failed-preparation",
  ) {
    super(`Composer capture unavailable: ${code}`);
    this.name = "ComposerClosureError";
  }
}

export type MountedComposerSnapshot = Readonly<ComposerDraft>;
export interface ComposerPreparation {
  /** Run result application under this still-owned admission, including after view retirement. */
  apply<T>(mutation: () => T): T;
  fail(error: unknown): void;
  /** This original attempt, including the actual draft persistence/Native ACK. */
  whenSettled?(): Promise<void>;
}
/** One original UI action; finishing it never persists or replays its effect. */
export interface MountedComposerAction {
  apply<T>(mutation: () => T): T;
  finish(): void;
}
export interface MountedComposerAdapter {
  sessionId?: string;
  snapshot(): ComposerDraft;
  composing?(): boolean;
  gate?(closed: boolean): void;
}
export interface MountedComposerLease {
  canMutate(): boolean;
  admitAction(): MountedComposerAction | null;
  mutate<T>(mutation: () => T): T;
  /** Preserve an unexpected external mutation, but invalidate a closed observation. */
  changed(): void;
  publishCache(operation: () => void): boolean;
  prepare<T>(operation: (accepted: ComposerPreparation) => Promise<T>): Promise<T>;
  retryFailed(): Promise<void>;
  retire(): Promise<void>;
  readonly retired: boolean;
  readonly pending: boolean;
}
export interface MountedComposerCapture {
  readonly qualified: false;
  readonly snapshots: readonly Readonly<{
    id: number;
    sessionId?: string;
    revision: number;
    snapshot: MountedComposerSnapshot;
  }>[];
  readonly missingCoverage: readonly string[];
}
export interface MountedComposerClosure {
  captureAndFlush(): Promise<MountedComposerCapture>;
  assertCurrent(): void;
  retryFailed(owner: object): Promise<void>;
  /** Caller identity is an in-memory cancellation owner, never Native authority. */
  reopen(owner: object): void;
}
type Job = {
  id: number;
  operation: (accepted: ComposerPreparation) => Promise<unknown>;
  pending?: Promise<unknown>;
  error?: unknown;
  failed: boolean;
  attempt: number;
  settled: boolean;
  applied: boolean;
  result?: unknown;
};
type Binding = {
  id: number;
  adapter: MountedComposerAdapter;
  scope: PersistenceScope;
  revision: number;
  retired: boolean;
  active?: PersistenceWork;
  jobs: Map<number, Job>;
  actions: Set<Action>;
  snapshot?: MountedComposerSnapshot;
  snapshotRevision?: number;
  charge: number;
  retiring?: Promise<void>;
  retirementSettled?: boolean;
  capturing?: Promise<void>;
  retrying?: Promise<void>;
  cacheVersion: number;
};
type Action = {
  pending?: Promise<void>;
  settled: boolean;
  failed: boolean;
  error?: unknown;
};
const hasPending = (binding: Binding) =>
  [...binding.jobs.values()].some((job) => !!job.pending) ||
  [...binding.actions].some((action) => !action.settled);
type Closure = {
  scope: PersistenceScope;
  owner: object;
  roster: Binding[];
  error?: unknown;
  reopened: boolean;
  deadline: number;
  capture?: Promise<MountedComposerCapture>;
  retrying?: Promise<void>;
  completed?: boolean;
  cleanup(): void;
  interrupted: Promise<never>;
  interrupt(error: unknown): void;
};
type State = {
  version: 1;
  next: number;
  active: number;
  bytes: number;
  overflow: boolean;
  implementation: number;
  registry?: PersistenceDrainRegistry;
  bindings: Map<number, Binding>;
  owners: Map<string, Binding>;
  cacheVersions: Map<string, number>;
  cacheOwner?: Binding;
  workOwners: WeakMap<PersistenceWork, Binding>;
  cacheObserver?: (sessionId: string, work?: PersistenceWork) => void;
  stopCacheObserver?: () => void;
  closures: Set<Closure>;
};
type Options = {
  registry?: PersistenceDrainRegistry;
  publish?: (
    sessionId: string,
    snapshot: MountedComposerSnapshot,
    work: PersistenceWork,
  ) => Promise<void>;
};
const overlaps = (a: PersistenceScope, b: PersistenceScope) =>
  a === "profile" || b === "profile" || a.some((id) => b.includes(id));
const scopeOf = (sessionId?: string): PersistenceScope =>
  sessionId ? Object.freeze([sessionId]) : "profile";
const now = () => performance.now();
const fresh = (): State => ({
  version: 1,
  next: 0,
  active: 0,
  bytes: 0,
  overflow: false,
  implementation: 0,
  bindings: new Map(),
  owners: new Map(),
  cacheVersions: new Map(),
  workOwners: new WeakMap(),
  closures: new Set(),
});

/** Copy only plain draft data. Strings remain immutable; preview capabilities stay with their UI owner. */
function immutableSnapshot(input: ComposerDraft): {
  snapshot: MountedComposerSnapshot;
  charge: number;
} {
  let charge = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (value: unknown, depth = 0): unknown => {
    if (++nodes > 8192 || depth > 16) throw new ComposerClosureError("capacity");
    if (typeof value === "string") {
      charge += value.length * 2;
      if (charge > 64 * 1024 * 1024) throw new ComposerClosureError("capacity");
      return value;
    }
    if (value === undefined || value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || seen.has(value)) throw new ComposerClosureError("changed");
    seen.add(value);
    const result = Array.isArray(value)
      ? value.map((item) => copy(item, depth + 1))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, copy(item, depth + 1)]),
        );
    seen.delete(value);
    return Object.freeze(result);
  };
  const attachments = input.attachments.map(
    ({ previewUrl: _url, loadPreview: _load, copyFromPath: _copy, ...file }) => file,
  );
  const snapshot = copy({
    text: input.text,
    mcpTags: input.mcpTags,
    attachments,
    ...(Object.prototype.hasOwnProperty.call(input, "mode") ? { mode: input.mode } : {}),
  }) as MountedComposerSnapshot;
  return { snapshot, charge: charge + nodes * 16 };
}

/** Inputs are the bounded immutable copies above. JSON.stringify erases own
 * undefined members, so it cannot compare the raw presence retained at a lease. */
function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const leftKeys = Object.keys(left),
    rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      sameSnapshot((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

export function createMountedComposerRegistry(options: Options = {}) {
  return implement(options, fresh());
}

function implement(options: Options, state: State) {
  const registry = options.registry ?? rendererPersistenceDrain;
  if (options.registry && options.registry !== rendererPersistenceDrain && !options.publish)
    throw new ComposerClosureError("changed");
  if (state.registry && state.registry !== registry) state.overflow = true;
  state.registry = registry;
  for (const binding of state.bindings.values()) binding.actions ??= new Set();
  const implementation = ++state.implementation;
  for (const closed of state.closures) {
    closed.error ??= new ComposerClosureError("changed");
    closed.interrupt(closed.error);
  }
  const producer: PersistenceProducer = registry.reuseModuleProducer("mounted-composers");
  const publish =
    options.publish ??
    (async (sessionId, snapshot, work) => {
      await persistMountedComposerDraft(
        sessionId,
        {
          ...snapshot,
          mcpTags: [...snapshot.mcpTags],
          attachments: snapshot.attachments.map((file) => ({ ...file })),
        },
        work,
      );
    });
  const invalidate = (scope: PersistenceScope, reason: unknown) => {
    for (const closed of state.closures)
      if (overlaps(scope, closed.scope)) {
        closed.error ??= reason;
        closed.interrupt(closed.error);
      }
  };
  if (!options.publish) {
    state.cacheObserver = (sessionId, work) => {
      if (!state.owners.has(sessionId)) return;
      const version = (state.cacheVersions.get(sessionId) ?? 0) + 1;
      state.cacheVersions.set(sessionId, version);
      const owner = work ? state.workOwners.get(work) : state.cacheOwner;
      if (owner?.adapter.sessionId === sessionId) owner.cacheVersion = version;
      else invalidate([sessionId], new ComposerClosureError("changed"));
    };
    state.stopCacheObserver ??= subscribeComposerDrafts((sessionId, work) =>
      state.cacheObserver?.(sessionId, work),
    );
  }
  const closedFor = (binding: Binding) =>
    [...state.closures].some((closed) => !closed.reopened && overlaps(binding.scope, closed.scope));
  const notifyGate = (binding: Binding, closed: boolean) => {
    try {
      binding.adapter.gate?.(closed);
    } catch (error) {
      invalidate(binding.scope, error);
    }
  };
  const matches = (binding: Binding, adapter: MountedComposerAdapter) => {
    try {
      return (
        !!binding.snapshot &&
        sameSnapshot(binding.snapshot, immutableSnapshot(adapter.snapshot()).snapshot)
      );
    } catch {
      return false;
    }
  };
  const pruneSettledAlias = (binding: Binding) => {
    const owner = binding.adapter.sessionId
      ? state.owners.get(binding.adapter.sessionId)
      : undefined;
    if (
      !state.closures.size &&
      binding.retired &&
      binding.retirementSettled &&
      binding.jobs.size === 0 &&
      binding.actions.size === 0 &&
      owner &&
      owner !== binding &&
      matches(binding, owner.adapter) &&
      state.bindings.delete(binding.id)
    ) {
      state.bytes -= binding.charge;
    }
  };
  const changed = (binding: Binding, accepted = false) => {
    if (!Number.isSafeInteger(binding.revision + 1)) {
      state.overflow = true;
      invalidate(binding.scope, new ComposerClosureError("capacity"));
      return;
    }
    binding.revision++;
    if (!accepted) invalidate(binding.scope, new ComposerClosureError("changed"));
    producer.noteMutation(binding.scope, binding.active);
  };
  const retain = (binding: Binding) => {
    if (binding.retired && binding.snapshot && binding.snapshotRevision === binding.revision)
      return binding.snapshot;
    const next = immutableSnapshot(binding.adapter.snapshot());
    if (state.bytes - binding.charge + next.charge > 64 * 1024 * 1024)
      throw new ComposerClosureError("capacity");
    state.bytes += next.charge - binding.charge;
    binding.snapshot = next.snapshot;
    binding.snapshotRevision = binding.revision;
    binding.charge = next.charge;
    return next.snapshot;
  };
  const persist = async (binding: Binding, work: PersistenceWork) => {
    const snapshot = retain(binding);
    if (binding.adapter.sessionId) {
      if (binding.cacheVersion !== (state.cacheVersions.get(binding.adapter.sessionId) ?? 0))
        throw new ComposerClosureError("changed");
      const owner = state.owners.get(binding.adapter.sessionId);
      if (
        owner &&
        owner !== binding &&
        !sameSnapshot(immutableSnapshot(owner.adapter.snapshot()).snapshot, snapshot)
      ) {
        throw new ComposerClosureError("changed");
      }
      state.workOwners.set(work, binding);
      try {
        await publish(binding.adapter.sessionId, snapshot, work);
        if (binding.cacheVersion !== (state.cacheVersions.get(binding.adapter.sessionId) ?? 0))
          throw new ComposerClosureError("changed");
      } finally {
        state.workOwners.delete(work);
      }
    }
  };
  const checkpoint = (binding: Binding): Promise<void> => {
    if (binding.capturing) return binding.capturing;
    if (state.active >= 64) return Promise.reject(new ComposerClosureError("capacity"));
    state.active++;
    const actual = producer.run(binding.scope, `capture:${binding.id}`, async (work) => {
      await persist(binding, work);
      work.confirmRecovery();
    });
    binding.capturing = actual;
    void actual.then(
      () => {
        state.active--;
        binding.capturing = undefined;
      },
      () => {
        state.active--;
        binding.capturing = undefined;
      },
    );
    return actual;
  };
  const execute = (binding: Binding, job: Job): Promise<unknown> => {
    if (job.pending) return job.pending;
    if (state.active >= 64) return Promise.reject(new ComposerClosureError("capacity"));
    state.active++;
    job.error = undefined;
    job.failed = false;
    job.settled = false;
    const attempt = ++job.attempt;
    let resolveAttempt!: () => void;
    let rejectAttempt!: (reason: unknown) => void;
    const attemptSettled = new Promise<void>((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    // Consumers can attach during the synchronous preparation callback. They
    // must not finish accepted work merely because that callback returned.
    void attemptSettled.catch(() => {});
    const pending = producer.run(binding.scope, `prepare:${binding.id}:${job.id}`, async (work) => {
      const accepted: ComposerPreparation = {
        whenSettled: () => attemptSettled,
        apply<T>(mutation: () => T): T {
          if (job.settled || job.attempt !== attempt) throw new ComposerClosureError("retired");
          const previous = binding.active;
          binding.active = work;
          try {
            const result = mutation();
            changed(binding, true);
            return result;
          } finally {
            binding.active = previous;
          }
        },
        fail: (error) => {
          job.error = error;
          job.failed = true;
          work.fail(error);
        },
      };
      try {
        const result = job.applied ? job.result : await job.operation(accepted);
        if (!job.failed) {
          job.applied = true;
          job.result = result;
        }
        await persist(binding, work);
        if (job.failed) throw job.error;
        work.confirmRecovery();
        return result;
      } catch (error) {
        job.error = error;
        job.failed = true;
        throw error;
      }
    });
    job.pending = pending;
    void pending.then(
      () => {
        state.active--;
        job.pending = undefined;
        job.settled = true;
        binding.jobs.delete(job.id);
        resolveAttempt();
      },
      (error: unknown) => {
        state.active--;
        job.pending = undefined;
        job.settled = true;
        rejectAttempt(error);
      },
    );
    return pending;
  };
  const settle = async (binding: Binding) => {
    while (true) {
      const pending = [
        ...[...binding.jobs.values()].flatMap((job) => (job.pending ? [job.pending] : [])),
        ...[...binding.actions].flatMap((action) =>
          !action.settled && action.pending ? [action.pending] : [],
        ),
      ];
      if (!pending.length) break;
      await Promise.allSettled(pending);
    }
    const failed = [...binding.jobs.values()].find((job) => job.failed);
    if (failed) throw failed.error;
    const failedAction = [...binding.actions].find((action) => action.failed);
    if (failedAction) throw failedAction.error;
  };
  const assertClosure = (closed: Closure) => {
    if (closed.reopened) throw new ComposerClosureError("changed");
    if (now() >= closed.deadline) closed.error ??= new ComposerClosureError("deadline");
    if (closed.error) throw closed.error;
    if (state.overflow) throw new ComposerClosureError("capacity");
    for (const binding of closed.roster) {
      // A retired lease retains its own snapshot. Its adapter may now point at
      // another view, so only a still-live original may be inspected again.
      if (!binding.retired && binding.adapter.composing?.())
        throw new ComposerClosureError("composition");
      if (
        !binding.retired &&
        binding.snapshot &&
        binding.snapshotRevision === binding.revision &&
        !sameSnapshot(immutableSnapshot(binding.adapter.snapshot()).snapshot, binding.snapshot)
      ) {
        closed.error = new ComposerClosureError("changed");
        closed.interrupt(closed.error);
        throw closed.error;
      }
    }
  };

  function registerMountedComposer(adapter: MountedComposerAdapter): MountedComposerLease {
    const previous = adapter.sessionId ? state.owners.get(adapter.sessionId) : undefined;
    if (
      previous?.retired &&
      previous.retirementSettled &&
      previous.snapshot &&
      previous.jobs.size === 0 &&
      previous.actions.size === 0 &&
      !state.closures.size &&
      matches(previous, adapter)
    ) {
      state.bindings.delete(previous.id);
      state.bytes -= previous.charge;
    }
    if (state.bindings.size >= 256 || !Number.isSafeInteger(state.next + 1)) {
      state.overflow = true;
      throw new ComposerClosureError("capacity");
    }
    const binding: Binding = {
      id: ++state.next,
      adapter,
      scope: scopeOf(adapter.sessionId),
      revision: 0,
      retired: false,
      jobs: new Map(),
      actions: new Set(),
      charge: 0,
      cacheVersion: adapter.sessionId ? (state.cacheVersions.get(adapter.sessionId) ?? 0) : 0,
    };
    state.bindings.set(binding.id, binding);
    if (adapter.sessionId) state.owners.set(adapter.sessionId, binding);
    invalidate(binding.scope, new ComposerClosureError("changed"));
    notifyGate(binding, closedFor(binding));
    return {
      get retired() {
        return binding.retired;
      },
      get pending() {
        return hasPending(binding);
      },
      canMutate: () =>
        !!binding.active ||
        (!binding.retired && implementation === state.implementation && !closedFor(binding)),
      admitAction() {
        if (
          binding.retired ||
          implementation !== state.implementation ||
          closedFor(binding) ||
          state.bindings.get(binding.id) !== binding ||
          binding.jobs.size + binding.actions.size >= 16 ||
          state.active >= 64 ||
          !Number.isSafeInteger(state.next + 1)
        )
          return null;
        const id = ++state.next;
        const action: Action = { settled: false, failed: false };
        binding.actions.add(action);
        state.active++;
        let work: PersistenceWork | undefined;
        let finished = false;
        let resolve!: () => void;
        const ended = new Promise<void>((done) => {
          resolve = done;
        });
        const pending = producer.run(
          binding.scope,
          `action:${binding.id}:${id}`,
          async (actual) => {
            work = actual;
            await ended;
            actual.confirmRecovery();
          },
        );
        action.pending = pending;
        void pending.then(
          () => {
            action.settled = true;
            state.active--;
            binding.actions.delete(action);
          },
          (error: unknown) => {
            action.settled = true;
            action.failed = true;
            action.error = error;
            state.active--;
            invalidate(binding.scope, error);
          },
        );
        const finish = () => {
          if (!finished) {
            finished = true;
            resolve();
          }
        };
        // Module replacement may queue the factory behind an older real write.
        // Without its actual work there is no synchronous action capability.
        if (!work) {
          finish();
          return null;
        }
        const acceptedWork = work;
        return Object.freeze({
          apply<T>(mutation: () => T): T {
            if (
              finished ||
              binding.retired ||
              implementation !== state.implementation ||
              state.bindings.get(binding.id) !== binding
            )
              throw new ComposerClosureError("retired");
            const previous = binding.active;
            binding.active = acceptedWork;
            try {
              return mutation();
            } finally {
              try {
                changed(binding, true);
              } finally {
                binding.active = previous;
              }
            }
          },
          finish,
        });
      },
      mutate<T>(mutation: () => T): T {
        if (
          !binding.active &&
          (binding.retired || implementation !== state.implementation || closedFor(binding))
        )
          throw new ComposerClosureError(binding.retired ? "retired" : "closed");
        const result = mutation();
        changed(binding, !!binding.active);
        return result;
      },
      changed: () => changed(binding, !!binding.active),
      publishCache(operation) {
        if (
          !binding.active &&
          (binding.retired || closedFor(binding) || implementation !== state.implementation)
        )
          return false;
        const previous = state.cacheOwner;
        state.cacheOwner = binding;
        try {
          operation();
          return true;
        } finally {
          state.cacheOwner = previous;
        }
      },
      prepare<T>(operation: (accepted: ComposerPreparation) => Promise<T>): Promise<T> {
        if (binding.retired || implementation !== state.implementation || closedFor(binding))
          return Promise.reject(new ComposerClosureError(binding.retired ? "retired" : "closed"));
        if (binding.jobs.size + binding.actions.size >= 16 || state.active >= 64)
          return Promise.reject(new ComposerClosureError("capacity"));
        if (!Number.isSafeInteger(state.next + 1))
          return Promise.reject(new ComposerClosureError("capacity"));
        const job: Job = {
          id: ++state.next,
          operation,
          failed: false,
          attempt: 0,
          settled: false,
          applied: false,
        };
        binding.jobs.set(job.id, job);
        return execute(binding, job) as Promise<T>;
      },
      retryFailed() {
        if (binding.retrying) return binding.retrying;
        const actual = (async () => {
          const results = await Promise.allSettled(
            [...binding.jobs.values()]
              .filter((job) => job.failed && !job.pending)
              .map((job) => execute(binding, job)),
          );
          const failed = results.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          await settle(binding);
        })();
        binding.retrying = actual;
        void actual.then(
          () => {
            binding.retrying = undefined;
          },
          () => {
            binding.retrying = undefined;
          },
        );
        return actual;
      },
      retire() {
        if (binding.retiring) return binding.retiring;
        binding.retired = true;
        invalidate(binding.scope, new ComposerClosureError("changed"));
        // Capture while the DOM/ref owner is still present. Do not revoke it to manufacture closure.
        try {
          retain(binding);
        } catch (error) {
          return Promise.reject(error);
        }
        const retiring = settle(binding)
          .then(() => checkpoint(binding))
          .then(() => {
            binding.retirementSettled = true;
            pruneSettledAlias(binding);
          });
        binding.retiring = retiring;
        void retiring.catch(() => {
          if (binding.retiring === retiring) binding.retiring = undefined;
        });
        return retiring;
      },
    };
  }

  function beginComposerClosure(
    scope: PersistenceScope,
    options: { owner: object; timeoutMs?: number; signal?: AbortSignal },
  ): MountedComposerClosure {
    if (state.closures.size >= 16 || state.overflow) throw new ComposerClosureError("capacity");
    if ([...state.closures].some((closed) => overlaps(scope, closed.scope)))
      throw new ComposerClosureError("closed");
    const timeout = options.timeoutMs ?? 30_000;
    if (
      !Number.isFinite(timeout) ||
      timeout < 1 ||
      timeout > 30_000 ||
      (scope !== "profile" && (!scope.length || scope.some((id) => !id)))
    )
      throw new ComposerClosureError("changed");
    let interrupt!: (error: unknown) => void;
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = reject;
    });
    void interrupted.catch(() => {});
    const closed: Closure = {
      scope: scope === "profile" ? scope : Object.freeze([...new Set(scope)]),
      owner: options.owner,
      roster: [...state.bindings.values()].filter((binding) => overlaps(scope, binding.scope)),
      reopened: false,
      deadline: now() + timeout,
      cleanup: () => {},
      interrupted,
      interrupt,
    };
    const cancel = () => {
      closed.error ??= new ComposerClosureError("cancelled");
      interrupt(closed.error);
    };
    const timer = setTimeout(() => {
      closed.error ??= new ComposerClosureError("deadline");
      interrupt(closed.error);
    }, timeout);
    options.signal?.addEventListener("abort", cancel, { once: true });
    closed.cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    };
    if (options.signal?.aborted) cancel();
    state.closures.add(closed);
    try {
      for (const binding of closed.roster) retain(binding);
    } catch (error) {
      closed.error = error;
      interrupt(error);
    }
    for (const binding of closed.roster) notifyGate(binding, true);
    return {
      assertCurrent: () => {
        assertClosure(closed);
        if (
          !closed.completed ||
          closed.roster.some((binding) => binding.capturing || hasPending(binding))
        )
          throw new ComposerClosureError("changed");
      },
      retryFailed(owner) {
        if (owner !== closed.owner) return Promise.reject(new ComposerClosureError("wrong-owner"));
        try {
          assertClosure(closed);
        } catch (error) {
          return Promise.reject(error);
        }
        if (closed.retrying) return closed.retrying;
        closed.completed = false;
        closed.capture = undefined;
        const actual = (async () => {
          for (const binding of closed.roster) {
            const results = await Promise.allSettled(
              [...binding.jobs.values()]
                .filter((job) => job.failed && !job.pending)
                .map((job) => execute(binding, job)),
            );
            const failed = results.find((result) => result.status === "rejected");
            if (failed?.status === "rejected") throw failed.reason;
            await settle(binding);
            assertClosure(closed);
          }
        })();
        const waiting = Promise.race([actual, interrupted]);
        closed.retrying = waiting;
        void actual.then(
          () => {
            if (closed.retrying === waiting && !closed.error) closed.retrying = undefined;
          },
          () => {
            if (closed.retrying === waiting && !closed.error) closed.retrying = undefined;
          },
        );
        void waiting.catch(() => {});
        return waiting;
      },
      captureAndFlush() {
        try {
          assertClosure(closed);
        } catch (error) {
          return Promise.reject(error);
        }
        if (
          closed.completed &&
          closed.roster.some((binding) => binding.capturing || hasPending(binding))
        ) {
          closed.completed = false;
          closed.capture = undefined;
        }
        if (closed.capture) return closed.capture;
        const actual = (async () => {
          assertClosure(closed);
          while (true) {
            for (const binding of closed.roster) {
              await settle(binding);
              assertClosure(closed);
              if (!binding.retired && binding.adapter.composing?.())
                throw new ComposerClosureError("composition");
              await checkpoint(binding);
              assertClosure(closed);
            }
            if (
              !closed.roster.some(
                (binding) =>
                  binding.capturing ||
                  binding.snapshotRevision !== binding.revision ||
                  hasPending(binding),
              )
            )
              break;
          }
          closed.completed = true;
          return Object.freeze({
            qualified: false as const,
            snapshots: Object.freeze(
              closed.roster.map((binding) =>
                Object.freeze({
                  id: binding.id,
                  ...(binding.adapter.sessionId ? { sessionId: binding.adapter.sessionId } : {}),
                  revision: binding.revision,
                  snapshot: binding.snapshot!,
                }),
              ),
            ),
            missingCoverage: Object.freeze([
              "native-challenge",
              "full-snapshot-native-retention",
              "native-attachment-durability",
              "parent-session-state",
              "provider-output",
              "quick-composer",
              ...(closed.roster.some((binding) => !binding.adapter.sessionId)
                ? ["unassigned-composers"]
                : []),
            ]),
          });
        })();
        // One subscription per capture attempt. Deadline does not release actual work.
        const waiting = Promise.race([actual, interrupted]);
        closed.capture = waiting;
        void actual.catch(() => {
          if (closed.capture === waiting && !closed.error) closed.capture = undefined;
        });
        void waiting.catch(() => {});
        return waiting;
      },
      reopen(owner) {
        if (owner !== closed.owner) throw new ComposerClosureError("wrong-owner");
        if (closed.reopened) return;
        closed.reopened = true;
        interrupt(new ComposerClosureError("changed"));
        closed.cleanup();
        state.closures.delete(closed);
        for (const binding of state.bindings.values()) notifyGate(binding, closedFor(binding));
        for (const binding of state.bindings.values()) pruneSettledAlias(binding);
      },
    };
  }
  return {
    registerMountedComposer,
    beginComposerClosure,
    observation: () =>
      Object.freeze({
        qualified: false as const,
        bindings: state.bindings.size,
        active: state.active,
        retainedBytes: state.bytes,
        closures: state.closures.size,
      }),
  };
}

const key = Symbol.for("bycoda.mounted-composer-closure.v1");
const globals = globalThis as typeof globalThis & { [key]?: State };
const mounted = implement({}, (globals[key] ??= fresh()));
export const registerMountedComposer = mounted.registerMountedComposer;
export const beginComposerClosure = mounted.beginComposerClosure;
export const mountedComposerObservation = mounted.observation;
