/**
 * Renderer persistence accounting, not an authority or native idle proof.
 *
 * An attempt observes an admission boundary. It does not close producers: a
 * later ordinary edit/write invalidates the attempt and continues normally.
 * Native checkpoints, mounted composer capture and provider delivery barriers
 * must be integrated before this can qualify an authority transfer.
 */
export type PersistenceScope = readonly string[] | "profile";

export class PersistenceDrainError extends Error {
  readonly cause?: unknown;
  constructor(
    readonly code:
      | "late-producer"
      | "failed-write"
      | "producer-changed"
      | "invalid-parent"
      | "abandoned"
      | "cancelled"
      | "deadline"
      | "capacity",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "PersistenceDrainError";
    this.cause = options?.cause;
  }
}

export interface PersistenceWork {
  /** Record a failure even when a legacy caller deliberately catches it. */
  fail(error: unknown): void;
  /** Domain-confirmed full replacement/equivalent receipt, never mere resolution. */
  confirmRecovery(): void;
}

export interface PersistenceProducer {
  run<T>(
    scope: PersistenceScope,
    key: string,
    operation: (work: PersistenceWork) => T | Promise<T>,
    options?: { parent?: PersistenceWork },
  ): Promise<T>;
  noteMutation(scope: PersistenceScope, parent?: PersistenceWork): void;
  assertSuccessful(scope: PersistenceScope): void;
  settle(scope: PersistenceScope, current?: PersistenceWork): Promise<void>;
  retire(): Promise<void>;
}

export interface PersistenceDrainAttempt {
  observe(): Promise<RendererPersistenceObservation>;
  assertCurrent(): void;
  abandon(): void;
}

type WorkState = {
  scope: PersistenceScope;
  sequence: number;
  rootSequence: number;
  checkpoint?: AttemptState;
  module?: ModuleHook;
  parent?: WorkState;
  settled: boolean;
  failed: boolean;
  recovered: boolean;
  accounting: boolean;
  error?: unknown;
  producer: ProducerState;
  key: string;
  done: Promise<void>;
};
type Failure = { scope: PersistenceScope; sequence: number; error: unknown };
type ModuleHook = {
  flush?: (scope: PersistenceScope, work: PersistenceWork) => Promise<void>;
  wake?: (scope: PersistenceScope) => void;
  revision: number;
};
type ProducerState = {
  id: string;
  flush?: (scope: PersistenceScope, work: PersistenceWork) => Promise<void>;
  wake?: (scope: PersistenceScope) => void;
  active: Set<WorkState>;
  failures: Map<string, Failure>;
  retiring?: Promise<void>;
  retired: boolean;
  module?: { current: ModuleHook; previous: Set<ModuleHook> };
};
type AttemptState = {
  scope: PersistenceScope;
  boundary: number;
  deadline: number;
  error?: PersistenceDrainError;
  interrupt: Promise<never>;
  reject: (reason: PersistenceDrainError) => void;
  cleanup: () => void;
};

export type RendererPersistenceObservation = {
  readonly qualified: false;
  readonly scope: PersistenceScope;
  readonly boundary: number;
  /** Registry admission counter, not a native/applied/durable watermark. */
  readonly observedAt: number;
  readonly missingCoverage: readonly [
    "native-checkpoint",
    "mounted-composers",
    "provider-output",
    "producer-coverage",
  ];
};

function copyScope(scope: PersistenceScope): PersistenceScope {
  if (scope === "profile") return scope;
  if (!scope.length || scope.some((id) => !id))
    throw new Error("A persistence scope needs session IDs");
  return Object.freeze([...new Set(scope)].sort());
}

function overlaps(a: PersistenceScope, b: PersistenceScope): boolean {
  return a === "profile" || b === "profile" || a.some((id) => b.includes(id));
}

function contains(parent: PersistenceScope, child: PersistenceScope): boolean {
  return parent === "profile" || (child !== "profile" && child.every((id) => parent.includes(id)));
}

/** Constructible for isolated tests; application writers share the singleton below. */
export class PersistenceDrainRegistry {
  private sequence = 0;
  private readonly producers = new Map<string, ProducerState>();
  private readonly attempts = new Set<AttemptState>();
  private readonly work = new WeakMap<PersistenceWork, WorkState>();
  private overflow = false;

  registerProducer(
    id: string,
    hooks: {
      flush?: (scope: PersistenceScope, work: PersistenceWork) => Promise<void>;
      wake?: (scope: PersistenceScope) => void;
    } = {},
  ): PersistenceProducer {
    if (this.producers.has(id)) throw new Error(`Persistence producer already registered: ${id}`);
    const producer: ProducerState = {
      id,
      flush: hooks.flush,
      wake: hooks.wake,
      active: new Set(),
      failures: new Map(),
      retired: false,
    };
    this.producers.set(id, producer);
    this.invalidateAll("producer-changed", `Persistence producer registered: ${id}`);
    return this.handle(producer);
  }

  /** Explicit service-module re-evaluation only; ordinary duplicate IDs remain errors. */
  reuseModuleProducer(
    id: string,
    hooks: {
      flush?: (scope: PersistenceScope, work: PersistenceWork) => Promise<void>;
      wake?: (scope: PersistenceScope) => void;
    } = {},
  ): PersistenceProducer {
    let producer = this.producers.get(id);
    const current: ModuleHook = { flush: hooks.flush, wake: hooks.wake, revision: 0 };
    if (!producer) {
      this.registerProducer(id);
      producer = this.producers.get(id)!;
      producer.module = { current, previous: new Set() };
    } else {
      if (!producer.module || producer.retired)
        throw new Error(`Persistence producer is not a live module: ${id}`);
      this.retainModuleHook(producer, producer.module.current);
      producer.module.current = current;
      this.invalidateAll("producer-changed", `Persistence module updated: ${id}`);
    }
    const retained = producer;
    retained.wake = (scope) => {
      const versions = retained.module!;
      for (const previous of versions.previous) previous.wake?.(scope);
      versions.current.wake?.(scope);
    };
    retained.flush = async (scope, work) => {
      const versions = retained.module!;
      const pendingVersions = [...versions.previous];
      // Old module timers may contain a prior draft with no CAS. Never race
      // their flush against the latest module's capture/native replacement.
      for (const previous of pendingVersions) {
        const revision = previous.revision;
        await previous.flush?.(scope, work);
        if (scope === "profile" && previous.revision === revision)
          versions.previous.delete(previous);
      }
      await versions.current.flush?.(scope, work);
    };
    return this.handle(retained, current);
  }

  private retainModuleHook(producer: ProducerState, hook: ModuleHook): void {
    if ((!hook.flush && !hook.wake) || producer.module!.previous.has(hook)) return;
    if (producer.module!.previous.size >= 16) {
      // Ordinary jobs and timers still run. Losing coverage is an explicit
      // qualification failure, never permission to discard their data.
      this.overflow = true;
      this.invalidateAll("capacity", "Too many retiring persistence modules");
      return;
    }
    producer.module!.previous.add(hook);
  }

  private handle(producer: ProducerState, module?: ModuleHook): PersistenceProducer {
    const touch = (parent?: PersistenceWork) => {
      if (!module) return;
      const inherited = parent ? this.work.get(parent) : undefined;
      // Checkpoint writes are the flush itself, not newly accepted user work.
      if (inherited?.accounting || inherited?.checkpoint) return;
      module.revision += 1;
      if (producer.module!.current !== module) this.retainModuleHook(producer, module);
    };
    return {
      run: <T>(
        scope: PersistenceScope,
        key: string,
        operation: (work: PersistenceWork) => T | Promise<T>,
        options: { parent?: PersistenceWork } = {},
      ): Promise<T> => {
        touch(options.parent);
        const parent = options.parent ? this.work.get(options.parent) : undefined;
        const isAncestor = (candidate: WorkState) => {
          for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
            if (ancestor === candidate) return true;
          }
          return false;
        };
        // Preserve accepted ordering across a service module replacement only.
        // Fresh per-module queues must not race an incumbent native draft write.
        const previous =
          module && !(parent?.producer === producer && parent.module)
            ? [...producer.active].filter(
                (entry) =>
                  entry.module &&
                  entry.module !== module &&
                  overlaps(entry.scope, scope) &&
                  !isAncestor(entry),
              )
            : [];
        return this.run(
          producer,
          scope,
          key,
          (work) =>
            previous.length
              ? Promise.all(previous.map((entry) => entry.done)).then(() => operation(work))
              : operation(work),
          options.parent,
          undefined,
          false,
          module,
        );
      },
      noteMutation: (scope: PersistenceScope, parent?: PersistenceWork) => {
        touch(parent);
        this.noteMutation(scope, parent);
      },
      assertSuccessful: (scope: PersistenceScope) => this.assertSuccessful(producer, scope),
      settle: async (scope: PersistenceScope, current?: PersistenceWork): Promise<void> => {
        const excluded = current ? this.parentState(scope, current) : undefined;
        await this.waitForWork(scope, producer, excluded);
        this.assertSuccessful(producer, scope);
      },
      retire: (): Promise<void> => {
        if (producer.retiring) return producer.retiring;
        producer.retired = true;
        this.invalidateAll("producer-changed", `Persistence producer retiring: ${producer.id}`);
        producer.retiring = (async () => {
          await this.waitForWork("profile", producer);
          if (producer.flush) {
            await this.run(
              producer,
              "profile",
              "retirement",
              (work) => producer.flush!("profile", work),
              undefined,
              undefined,
              true,
            );
          }
          await this.waitForWork("profile", producer);
          this.assertSuccessful(producer, "profile");
          this.producers.delete(producer.id);
        })().catch((error: unknown) => {
          producer.retiring = undefined;
          throw error;
        });
        // Failed retirement remains registered/unknown. Accepted work is never cancelled.
        return producer.retiring;
      },
    };
  }

  noteMutation(scope: PersistenceScope, parent?: PersistenceWork): void {
    const inherited = this.parentState(scope, parent);
    for (const attempt of this.attempts) {
      if (overlaps(attempt.scope, scope) && !this.wasAccepted(attempt, inherited)) {
        this.invalidate(
          attempt,
          "late-producer",
          "Local data changed after the persistence boundary",
        );
      }
    }
  }

  beginAttempt(
    scope: PersistenceScope,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): PersistenceDrainAttempt {
    if (this.attempts.size >= 32)
      throw new PersistenceDrainError("capacity", "Too many drain attempts");
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
    ) {
      throw new Error("Invalid persistence drain deadline");
    }
    let reject!: AttemptState["reject"];
    const interrupt = new Promise<never>((_, fail) => {
      reject = fail;
    });
    // Invalidation is synchronous even if the caller has not started waiting yet.
    void interrupt.catch(() => {});
    const attempt: AttemptState = {
      scope: copyScope(scope),
      boundary: this.sequence,
      deadline: Date.now() + (options.timeoutMs ?? 30_000),
      interrupt,
      reject,
      cleanup: () => {},
    };
    this.attempts.add(attempt);
    const cancel = () => this.invalidate(attempt, "cancelled", "Persistence drain cancelled");
    const timer = setTimeout(
      () => this.invalidate(attempt, "deadline", "Persistence drain deadline expired"),
      options.timeoutMs ?? 30_000,
    );
    options.signal?.addEventListener("abort", cancel, { once: true });
    attempt.cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    };
    if (options.signal?.aborted) cancel();
    if (options.timeoutMs === 0)
      this.invalidate(attempt, "deadline", "Persistence drain deadline expired");
    let observing: Promise<RendererPersistenceObservation> | undefined;
    return {
      observe: (): Promise<RendererPersistenceObservation> => {
        observing ??= Promise.race([this.observe(attempt), interrupt]);
        return observing;
      },
      assertCurrent: () => this.assertAttempt(attempt),
      abandon: () => {
        this.invalidate(attempt, "abandoned", "Persistence drain abandoned");
        attempt.cleanup();
        this.attempts.delete(attempt);
      },
    };
  }

  private parentState(scope: PersistenceScope, parent?: PersistenceWork): WorkState | undefined {
    if (!parent) return;
    const state = this.work.get(parent);
    if (!state || state.settled || !contains(state.scope, scope)) {
      this.invalidateAll(
        "invalid-parent",
        "A persistence producer used an expired or wider parent",
      );
      throw new PersistenceDrainError("invalid-parent", "Invalid persistence parent");
    }
    return state;
  }

  private wasAccepted(attempt: AttemptState, parent?: WorkState): boolean {
    return !!parent && (parent.checkpoint === attempt || parent.rootSequence <= attempt.boundary);
  }

  private run<T>(
    producer: ProducerState,
    scope: PersistenceScope,
    key: string,
    operation: (work: PersistenceWork) => T | Promise<T>,
    parent?: PersistenceWork,
    checkpoint?: AttemptState,
    retirement = false,
    module?: ModuleHook,
  ): Promise<T> {
    const inherited = this.parentState(scope, parent);
    if (producer.retired && !inherited && !checkpoint && !retirement) {
      for (const attempt of this.attempts) {
        if (overlaps(attempt.scope, scope)) {
          this.invalidate(
            attempt,
            "producer-changed",
            "New work used a retired persistence producer",
          );
        }
      }
      return Promise.reject(
        new PersistenceDrainError("producer-changed", "Persistence producer retired"),
      );
    }
    const sequence = ++this.sequence;
    for (const attempt of this.attempts) {
      if (
        overlaps(attempt.scope, scope) &&
        checkpoint !== attempt &&
        !this.wasAccepted(attempt, inherited)
      ) {
        this.invalidate(
          attempt,
          "late-producer",
          "New persistence work crossed the observation boundary",
        );
      }
    }
    let settle!: () => void;
    const state: WorkState = {
      scope: copyScope(scope),
      sequence,
      rootSequence: inherited?.rootSequence ?? sequence,
      checkpoint: checkpoint ?? inherited?.checkpoint,
      parent: inherited,
      module,
      settled: false,
      failed: false,
      recovered: false,
      accounting: checkpoint !== undefined || retirement,
      producer,
      key,
      done: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    const work: PersistenceWork = {
      confirmRecovery: () => {
        state.recovered = true;
      },
      fail: (error) => {
        state.failed = true;
        state.error = error;
        if (state.settled) this.finish(state);
        for (const attempt of this.attempts) {
          if (overlaps(attempt.scope, state.scope)) {
            this.invalidate(attempt, "failed-write", "Persistence work failed", error);
          }
        }
      },
    };
    this.work.set(work, state);
    producer.active.add(state);
    let pending: T | Promise<T>;
    try {
      pending = operation(work);
    } catch (error) {
      work.fail(error);
      pending = Promise.reject(error);
    }
    return Promise.resolve(pending).then(
      (value) => {
        this.finish(state);
        settle();
        return value;
      },
      (error: unknown) => {
        work.fail(error);
        this.finish(state);
        settle();
        throw error;
      },
    );
  }

  private finish(state: WorkState): void {
    state.settled = true;
    state.producer.active.delete(state);
    const key = JSON.stringify([state.scope, state.key]);
    const previous = state.producer.failures.get(key);
    // A checkpoint is accounting around domain work, not another durable intent.
    if (state.accounting) return;
    if (state.failed) {
      if (!previous || previous.sequence < state.sequence) {
        if (state.producer.failures.size >= 1024 && !previous) this.overflow = true;
        else
          state.producer.failures.set(key, {
            scope: state.scope,
            sequence: state.sequence,
            error: state.error,
          });
      }
    } else if (state.recovered && previous && previous.sequence < state.sequence) {
      state.producer.failures.delete(key);
    }
  }

  private async waitForWork(
    scope: PersistenceScope,
    producer?: ProducerState,
    excluded?: WorkState,
  ): Promise<void> {
    while (true) {
      const pending = [...(producer ? [producer] : this.producers.values())]
        .flatMap((entry) => [...entry.active])
        .filter((entry) => entry !== excluded && overlaps(scope, entry.scope));
      if (!pending.length) return;
      await Promise.all(pending.map((entry) => entry.done));
    }
  }

  private assertSuccessful(producer: ProducerState, scope: PersistenceScope): void {
    if (this.overflow)
      throw new PersistenceDrainError("capacity", "Persistence failure inventory overflowed");
    const failed = [...producer.failures.values()].find((entry) => overlaps(scope, entry.scope));
    if (failed)
      throw new PersistenceDrainError("failed-write", `Unconfirmed persistence: ${producer.id}`, {
        cause: failed.error,
      });
  }

  private assertAttempt(attempt: AttemptState, writes = true): void {
    if (this.overflow)
      throw new PersistenceDrainError("capacity", "Persistence coverage inventory overflowed");
    if (Date.now() >= attempt.deadline)
      this.invalidate(attempt, "deadline", "Persistence drain deadline expired");
    if (attempt.error) throw attempt.error;
    if (!this.attempts.has(attempt))
      throw new PersistenceDrainError("abandoned", "Persistence drain abandoned");
    if (writes)
      for (const producer of this.producers.values())
        this.assertSuccessful(producer, attempt.scope);
  }

  private async observe(attempt: AttemptState): Promise<RendererPersistenceObservation> {
    this.assertAttempt(attempt, false);
    // Wake already admitted timers; their leases still require actual settlement.
    try {
      for (const producer of this.producers.values()) producer.wake?.(attempt.scope);
    } catch (error) {
      this.invalidate(attempt, "failed-write", "Could not wake accepted persistence work", error);
      throw error;
    }
    await this.waitForWork(attempt.scope);
    this.assertAttempt(attempt, false);
    const flushes = [...this.producers.values()].filter((producer) => producer.flush);
    await Promise.allSettled(
      flushes.map((producer) =>
        this.run(
          producer,
          attempt.scope,
          "checkpoint",
          (work) => producer.flush!(attempt.scope, work),
          undefined,
          attempt,
        ),
      ),
    );
    this.assertAttempt(attempt);
    await this.waitForWork(attempt.scope);
    this.assertAttempt(attempt);
    return Object.freeze({
      qualified: false,
      scope: attempt.scope,
      boundary: attempt.boundary,
      observedAt: this.sequence,
      missingCoverage: Object.freeze([
        "native-checkpoint",
        "mounted-composers",
        "provider-output",
        "producer-coverage",
      ] as const),
    });
  }

  private invalidate(
    attempt: AttemptState,
    code: PersistenceDrainError["code"],
    message: string,
    cause?: unknown,
  ): void {
    if (attempt.error) return;
    attempt.error = new PersistenceDrainError(code, message, { cause });
    attempt.cleanup();
    attempt.reject(attempt.error);
  }

  private invalidateAll(code: PersistenceDrainError["code"], message: string): void {
    for (const attempt of this.attempts) this.invalidate(attempt, code, message);
  }
}

export const rendererPersistenceDrain = new PersistenceDrainRegistry();
