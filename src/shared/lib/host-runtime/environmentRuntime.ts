import {
  BulkResultSchema,
  CommandReceiptSchema,
  IdentifierSchema,
  SubscriptionEventSchema,
  SubscriptionOpenResultSchema,
  SubscriptionTargetSchema,
  WS_LIMITS,
  getHostRpcMethod,
  hostRpcCost,
  hostRpcWireMethod,
  parseHostRpcParams,
  type StreamCursor,
} from "../../model/host-contracts";
import {
  initialConnectionState,
  reduceConnectionState,
  type ConnectionState,
} from "./connectionState";
import {
  requireBoundedKey,
  requireSafeCounter,
  type ManagedHostConnectionPort,
  type ManagedHostEvent,
  type RuntimeRequestOptions,
  type RuntimeClock,
  type RuntimeScope,
} from "./ports";
import { SubscriptionRegistry, type CursorCommit, type SubscriptionLease } from "./subscriptions";
import { hostRpcHasEffect } from "./requestPolicy";

type Target = ReturnType<typeof SubscriptionTargetSchema.parse>;
type CommitInput = Parameters<CursorCommit>[0];
export type RuntimeStreamMetadata = {
  kind: "snapshot" | "delta";
  baseRevision?: number;
  revision?: number;
};
export type RuntimeCommitInput = CommitInput & RuntimeStreamMetadata;
export type RuntimeSubscriptionConsumer<T> = {
  parse(data: unknown, metadata: RuntimeStreamMetadata): T;
  commit(value: T, input: RuntimeCommitInput): void | Promise<void>;
  closed?(): void | Promise<void>;
  onError?(error: unknown): void;
};
type Consumer = {
  lease: SubscriptionLease;
  commit(data: unknown, input: RuntimeCommitInput): void | Promise<void>;
  closed?(): void | Promise<void>;
  onError?(error: unknown): void;
};
type Entry = {
  target: Target;
  key: string;
  id: string;
  streamId?: string;
  generation?: number;
  opening?: Promise<void>;
  refreshing?: Promise<void>;
  consumers: Set<Consumer>;
  tail: Promise<void>;
  queued: number;
  closed: boolean;
  version: number;
  resyncAttempts: number;
  abandoned: Set<Promise<void>>;
  controls: Map<string, "closed" | "resync-required">;
};
type ControlWaiter = { grant(): void; reject(error: Error): void };
let runtimeSequence = 0;

export class HostCommandUncertainError extends Error {
  readonly delivery = "unknown";
  readonly uncertain = true;
  readonly code: string;
  readonly generation?: number | null;
  readonly requestId?: string | null;
  readonly unsupported = false;
  constructor(
    readonly commandId: string,
    readonly cause: unknown,
  ) {
    super(
      cause instanceof Error
        ? cause.message
        : "Host command delivery is unknown; reconcile this command ID before another attempt.",
    );
    this.name = "HostCommandUncertainError";
    const metadata = typeof cause === "object" && cause !== null ? cause : {};
    this.code =
      "code" in metadata &&
      typeof metadata.code === "string" &&
      /^RPC_WS_[A-Z_]+$/.test(metadata.code)
        ? metadata.code
        : "RPC_WS_INTERRUPTED";
    if (
      "generation" in metadata &&
      (metadata.generation === null || Number.isSafeInteger(metadata.generation))
    )
      this.generation = metadata.generation as number | null;
    if (
      "requestId" in metadata &&
      (metadata.requestId === null || typeof metadata.requestId === "string")
    )
      this.requestId = metadata.requestId;
  }
}

/** Stateful RPCs without durable command receipts still cannot be replayed after an unknown outcome. */
export class HostRpcUncertainError extends Error {
  readonly delivery = "unknown";
  readonly uncertain = true;
  readonly unsupported = false;
  readonly code: string;
  readonly generation?: number | null;
  constructor(
    readonly method: string,
    readonly requestId: string,
    readonly cause: unknown,
  ) {
    super("The Host operation may have completed. Refresh its state before retrying.");
    this.name = "HostRpcUncertainError";
    const metadata = typeof cause === "object" && cause !== null ? cause : {};
    this.code =
      "code" in metadata &&
      typeof metadata.code === "string" &&
      /^RPC_WS_[A-Z_]+$/.test(metadata.code)
        ? metadata.code
        : "RPC_WS_INTERRUPTED";
    if (
      "generation" in metadata &&
      (metadata.generation === null ||
        (typeof metadata.generation === "number" &&
          Number.isSafeInteger(metadata.generation) &&
          metadata.generation >= 0))
    )
      this.generation = metadata.generation;
  }
}

/** One logical scope; the injected platform exclusively owns connections and retries. */
export class EnvironmentRuntime {
  private readonly registry = new SubscriptionRegistry();
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<
    string,
    { cancel(): void; cancelQueued(reason: string, code?: string): void; cost: "read" | "control" }
  >();
  private readonly controlQueue: ControlWaiter[] = [];
  private activeControls = 0;
  private readonly id = `runtime-${++runtimeSequence}`;
  private sequence = 0;
  private stateValue: ConnectionState;
  private startPromise?: Promise<void>;
  private stopListening?: () => void;
  private disposed = false;
  private scopeVersion = 0;

  constructor(
    readonly scope: RuntimeScope,
    private readonly port: ManagedHostConnectionPort,
    private readonly clock: RuntimeClock = {
      now: () => performance.now(),
      schedule: (delay, callback) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    },
  ) {
    for (const value of [scope.environmentId, scope.principalId, scope.accessEpoch]) {
      if (typeof value !== "string") throw new Error("Invalid runtime scope");
      requireBoundedKey(value, "runtime scope");
    }
    this.scope = Object.freeze({ ...scope });
    this.stateValue = initialConnectionState(scope.environmentId);
  }
  get state(): ConnectionState {
    return { ...this.stateValue };
  }
  get subscriptionCount(): number {
    return this.entries.size;
  }
  get pendingCount(): number {
    return this.pending.size;
  }

  private acquireControl(): { promise: Promise<() => void>; cancel(error: Error): void } {
    let waiter!: ControlWaiter;
    let waiting = true;
    const promise = new Promise<() => void>((resolve, reject) => {
      waiter = {
        grant: () => {
          if (!waiting) return;
          waiting = false;
          this.activeControls++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.activeControls--;
            this.drainControlQueue();
          });
        },
        reject: (error) => {
          if (!waiting) return;
          waiting = false;
          const index = this.controlQueue.indexOf(waiter);
          if (index >= 0) this.controlQueue.splice(index, 1);
          reject(error);
        },
      };
      if (!this.controlQueue.length && this.activeControls < WS_LIMITS.maxControlJobsPerDevice)
        waiter.grant();
      else if (this.controlQueue.length >= WS_LIMITS.maxPendingRpc)
        waiter.reject(
          Object.assign(new Error("Host pending control queue limit reached"), {
            code: "RPC_WS_OVERLOAD",
            uncertain: false,
          }),
        );
      else this.controlQueue.push(waiter);
    });
    return { promise, cancel: (error) => waiter.reject(error) };
  }

  private drainControlQueue(): void {
    while (this.controlQueue.length && this.activeControls < WS_LIMITS.maxControlJobsPerDevice)
      this.controlQueue.shift()!.grant();
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Host runtime is closed"));
    return (this.startPromise ??= (async () => {
      const stop = await this.port.listen((event) => this.receive(event));
      if (this.disposed) {
        stop();
        return;
      }
      this.stopListening = stop;
      if (!(await this.port.attach())) throw new Error("Host WebSocket transport is unsupported");
      if (this.disposed) await this.port.detach();
    })());
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.scopeVersion++;
    this.stateValue = reduceConnectionState(this.stateValue, { type: "close" });
    for (const { cancel } of this.pending.values()) cancel();
    for (const entry of this.entries.values()) {
      entry.closed = true;
      for (const consumer of entry.consumers) consumer.lease.release();
      entry.consumers.clear();
    }
    this.entries.clear();
    this.stopListening?.();
    this.stopListening = undefined;
    await this.port.detach();
  }

  async request(
    method: string,
    params: unknown,
    options: RuntimeRequestOptions = {},
  ): Promise<unknown> {
    method = hostRpcWireMethod(method);
    if (this.disposed || options.signal?.aborted) throw new Error("Host request is cancelled");
    const definition = getHostRpcMethod(method);
    if (!definition) throw new Error("Unsupported Host RPC method");
    const parsed = parseHostRpcParams(method, params);
    const commandId =
      method === "commands.dispatch" ? IdentifierSchema.parse(parsed.commandId) : undefined;
    if (options.commandId !== undefined && options.commandId !== commandId)
      throw new Error("Command ID does not match the request");
    const timeout = options.responseTimeoutMs ?? definition.responseTimeoutMs;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid Host request timeout");
    const deadline = this.clock.now() + timeout;
    const cost = hostRpcCost(method, parsed);
    if (
      cost === "read" &&
      [...this.pending.values()].filter((value) => value.cost === "read").length >=
        WS_LIMITS.maxPendingRpc
    )
      throw new Error("Host pending read request limit reached");
    if (
      cost === "control" &&
      [...this.pending.values()].filter((value) => value.cost === "control").length >=
        WS_LIMITS.maxControlJobsPerDevice + WS_LIMITS.maxPendingRpc
    )
      throw Object.assign(new Error("Host pending control queue limit reached"), {
        code: "RPC_WS_OVERLOAD",
        uncertain: false,
        commandId,
      });
    const requestId = `${this.id}-${++this.sequence}`;
    const version = this.scopeVersion;
    let admissionGeneration: number | undefined;
    let submitted = false;
    let replySeen = false;
    let cancelledLocally = false;
    let cancelError: Error | undefined;
    let releaseSignal: (() => void) | undefined;
    let releaseDeadline: (() => void) | undefined;
    let releaseControl: (() => void) | undefined;
    let cancelWait: ((error: Error) => void) | undefined;
    let rejectCancelled!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject;
    });
    void cancelled.catch(() => {});
    const cancelWith = (code: string, message: string) => {
      if (cancelledLocally) return;
      cancelledLocally = true;
      if (submitted && definition.cancellation === "query")
        void this.port.cancel(requestId).catch(() => {});
      cancelError = Object.assign(new Error(message), {
        code,
        ...(!submitted ? { uncertain: false, commandId } : {}),
      });
      cancelWait?.(cancelError);
      rejectCancelled(cancelError);
    };
    const cancel = () => cancelWith("RPC_WS_CANCELLED", "Host request is cancelled");
    this.pending.set(requestId, {
      cancel,
      cost,
      cancelQueued: (reason, code = "RPC_WS_UNAVAILABLE") => {
        if (!submitted && admissionGeneration !== undefined) cancelWith(code, reason);
      },
    });
    try {
      releaseDeadline = this.clock.schedule(timeout, () =>
        cancelWith("RPC_WS_DEADLINE", "Host request deadline exceeded"),
      );
      releaseSignal = options.signal?.subscribe(cancel);
      if (options.signal?.aborted) cancel();
      if (cancelledLocally) throw cancelError;
      await Promise.race([this.start(), cancelled]);
      if (cancelledLocally || this.disposed)
        throw cancelError ?? new Error("Host request is cancelled");
      admissionGeneration = this.stateValue.generation;
      if (cost === "control") {
        const ticket = this.acquireControl();
        cancelWait = ticket.cancel;
        releaseControl = await ticket.promise;
        cancelWait = undefined;
      }
      if (cancelledLocally) throw cancelError;
      if (
        version !== this.scopeVersion ||
        admissionGeneration !== this.stateValue.generation ||
        this.stateValue.transport === "blocked" ||
        this.stateValue.transport === "closed"
      )
        throw Object.assign(new Error("Host connection changed before request admission"), {
          code: "RPC_WS_UNAVAILABLE",
          uncertain: false,
          commandId,
        });
      const remaining = Math.ceil(deadline - this.clock.now());
      if (remaining <= 0) {
        cancelWith("RPC_WS_DEADLINE", "Host request deadline exceeded");
        throw cancelError;
      }
      submitted = true;
      const physical = this.port.request(method, parsed, {
        requestId,
        commandId,
        responseTimeoutMs: remaining,
      });
      const releasePhysical = releaseControl;
      releaseControl = undefined;
      if (releasePhysical) void physical.then(releasePhysical, releasePhysical);
      const reply = await Promise.race([physical, cancelled]);
      replySeen = true;
      requireSafeCounter(reply.generation, "reply generation");
      if (this.disposed || version !== this.scopeVersion)
        throw new Error("Stale Host access scope");
      if (commandId) {
        const receipt = CommandReceiptSchema.parse(reply.result);
        if (receipt.commandId !== commandId)
          throw new Error("Host command receipt identity changed");
        return receipt;
      }
      this.assertCurrent(reply.generation, version);
      const bulkRemaining = Math.ceil(deadline - this.clock.now());
      if (bulkRemaining <= 0) {
        cancelWith("RPC_WS_DEADLINE", "Host request deadline exceeded");
        throw cancelError;
      }
      const value = await Promise.race([
        this.resolveBulk(reply.result, reply.generation, version, bulkRemaining),
        cancelled,
      ]);
      this.assertCurrent(reply.generation, version);
      return definition.resultSchema.parse(value);
    } catch (error) {
      if (
        !submitted &&
        commandId &&
        typeof error === "object" &&
        error !== null &&
        "uncertain" in error &&
        error.uncertain === false &&
        !("commandId" in error)
      )
        Object.assign(error, { commandId });
      if (submitted) {
        const knownFailure =
          !replySeen &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string" &&
          /^RPC_WS_[A-Z_]+$/.test(error.code) &&
          "uncertain" in error &&
          error.uncertain === false &&
          (!("requestId" in error && error.requestId !== null && error.requestId !== undefined) ||
            error.requestId === requestId) &&
          (!("commandId" in error && error.commandId !== null && error.commandId !== undefined) ||
            error.commandId === commandId);
        if (knownFailure) throw error;
        if (commandId) throw new HostCommandUncertainError(commandId, error);
        if (hostRpcHasEffect(method, definition.kind))
          throw new HostRpcUncertainError(method, requestId, error);
      }
      throw error;
    } finally {
      cancelWait?.(cancelError ?? new Error("Host request is cancelled"));
      releaseControl?.();
      releaseDeadline?.();
      releaseSignal?.();
      this.pending.delete(requestId);
    }
  }

  retain<T>(rawTarget: Target, consumer: RuntimeSubscriptionConsumer<T>): () => void {
    if (this.disposed) throw new Error("Host runtime is closed");
    const target = SubscriptionTargetSchema.parse(rawTarget);
    const key = JSON.stringify(target);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= WS_LIMITS.maxSubscriptionsPerSocket)
        throw new Error("Host subscription limit reached");
      entry = {
        target,
        key,
        id: `${this.id}-subscription-${++this.sequence}`,
        consumers: new Set(),
        tail: Promise.resolve(),
        queued: 0,
        closed: false,
        version: 0,
        resyncAttempts: 0,
        abandoned: new Set(),
        controls: new Map(),
      };
      this.entries.set(key, entry);
    }
    const lease = this.registry.retain({ ...this.scope, streamId: key, filterKey: "snapshot" });
    const retained: Consumer = {
      lease,
      commit: (data, input) => consumer.commit(consumer.parse(data, input), input),
      closed: consumer.closed,
      onError: consumer.onError,
    };
    entry.consumers.add(retained);
    const needsSnapshot = entry.streamId !== undefined;
    void this.start()
      .then(async () => {
        if (needsSnapshot && !entry!.closed && entry!.generation === this.stateValue.generation) {
          // A newly retained view has no applied cursor. Re-open logical demand
          // for a fresh snapshot; this never creates another physical connection.
          await this.refresh(entry!, false);
          return;
        }
        await this.open(entry!);
      })
      .catch((error) => this.report(entry!, error));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      lease.release();
      entry!.consumers.delete(retained);
      if (entry!.consumers.size) return;
      entry!.closed = true;
      if (this.entries.get(key) === entry) this.entries.delete(key);
      if (entry!.generation === this.stateValue.generation && this.stateValue.transport === "ready")
        void this.request("subscriptions.close", { subscriptionId: entry!.id }).catch(() => {});
    };
  }

  private receive(event: ManagedHostEvent): void {
    if (this.disposed) return;
    if (event.environmentId !== this.scope.environmentId) return;
    if (!Number.isSafeInteger(event.generation) || event.generation < this.stateValue.generation)
      return;
    if (event.kind === "state") {
      if (event.generation > this.stateValue.generation) {
        for (const pending of this.pending.values())
          pending.cancelQueued("Host connection generation changed before request admission");
        this.stateValue = reduceConnectionState(this.stateValue, {
          type: "attempt",
          generation: event.generation,
        });
        this.registry.setGeneration(event.generation);
        for (const entry of this.entries.values()) {
          entry.generation = undefined;
          entry.streamId = undefined;
          if (!this.interruptQueue(entry, false)) {
            this.report(
              entry,
              new Error("Host application could not retire its previous connection scopes"),
              true,
            );
            entry.closed = true;
          }
        }
      }
      const generation = event.generation;
      if (event.phase === "ready") {
        this.stateValue = reduceConnectionState(this.stateValue, { type: "opened", generation });
        this.stateValue = reduceConnectionState(this.stateValue, {
          type: "ready",
          generation,
          environmentId: event.environmentId,
        });
        for (const entry of this.entries.values())
          void this.open(entry).catch((error) => this.report(entry, error));
      } else if (event.phase !== "connecting") {
        this.stateValue = reduceConnectionState(this.stateValue, {
          type: "failed",
          generation,
          failure:
            event.phase === "blocked"
              ? event.category === "authentication"
                ? "auth"
                : event.category === "identity"
                  ? "identity"
                  : "schema"
              : "network",
        });
        if (event.phase === "blocked" || event.phase === "closed") {
          const code =
            event.category === "identity"
              ? "RPC_WS_IDENTITY"
              : event.category === "authentication"
                ? "RPC_WS_BLOCKED"
                : "RPC_WS_SCHEMA";
          for (const pending of this.pending.values())
            pending.cancelQueued(
              "Host connection is blocked or closed before request admission",
              event.phase === "blocked" ? code : "RPC_WS_UNAVAILABLE",
            );
          const error =
            event.phase === "blocked"
              ? Object.assign(new Error(`${code}: Host connection admission was refused`), {
                  code,
                  generation,
                })
              : new Error("Host connection is no longer authorized or available");
          for (const entry of this.entries.values()) this.report(entry, error, true);
          if (event.phase === "closed") void this.close().catch(() => {});
        }
      }
      return;
    }
    if (
      event.kind !== "subscription" ||
      this.stateValue.transport !== "ready" ||
      event.generation !== this.stateValue.generation
    )
      return;
    const parsed = SubscriptionEventSchema.safeParse(event.event);
    if (!parsed.success) return;
    const entry = [...this.entries.values()].find(
      (value) => value.id === parsed.data.params.subscriptionId,
    );
    if (!entry || entry.closed) return;
    const kind = parsed.data.params.kind;
    if (kind === "closed" || kind === "resync-required") {
      const control = parsed.data.params;
      if (entry.streamId !== undefined)
        this.applyControl(entry, kind, event.generation, control.subscriptionId, control.streamId);
      else if (entry.controls.size < WS_LIMITS.maxUnacknowledgedEvents) {
        // Verify against the open response BEFORE releasing its queued data.
        // A wrong early stream cannot retire a real view, while a matching
        // control dominates even a synchronous baseline application.
        const previous = entry.controls.get(control.streamId);
        entry.controls.set(control.streamId, previous === "closed" ? previous : kind);
      } else void this.refresh(entry, true).catch((error) => this.report(entry, error));
      return;
    }
    if (entry.queued >= WS_LIMITS.maxUnacknowledgedEvents) {
      void this.refresh(entry, true).catch((error) => this.report(entry, error));
      return;
    }
    const version = this.scopeVersion;
    const entryVersion = entry.version;
    const isEntryCurrent = () =>
      !entry.closed &&
      entry.version === entryVersion &&
      entry.id === parsed.data.params.subscriptionId;
    entry.queued++;
    entry.tail = entry.tail
      .then(async () => {
        await entry.opening;
        this.assertCurrent(event.generation, version);
        if (
          !isEntryCurrent() ||
          entry.generation !== event.generation ||
          parsed.data.params.streamId !== entry.streamId
        )
          return;
        const update = parsed.data.params;
        const metadata: RuntimeStreamMetadata = {
          kind,
          baseRevision: update.baseRevision,
          revision: update.revision,
        };
        const data = await this.resolveBulk(update.data, event.generation, version);
        this.assertCurrent(event.generation, version);
        if (!isEntryCurrent()) return;
        let applied = true;
        const consumers = [...entry.consumers];
        for (const retained of consumers) {
          const apply =
            update.kind === "snapshot"
              ? this.registry.applySnapshot.bind(this.registry)
              : this.registry.applyDelta.bind(this.registry);
          const result = await apply(retained.lease, event.generation, update.cursor, (input) => {
            this.assertCurrent(event.generation, version);
            return retained.commit(data, {
              ...input,
              ...metadata,
              isCurrent: () =>
                input.isCurrent() &&
                isEntryCurrent() &&
                !this.disposed &&
                this.stateValue.transport === "ready" &&
                this.stateValue.generation === event.generation &&
                version === this.scopeVersion,
            });
          });
          if (
            result.status !== "applied" &&
            result.status !== "duplicate" &&
            result.status !== "closed"
          ) {
            applied = false;
          }
        }
        if (!applied && isEntryCurrent()) {
          await this.refresh(entry, true);
          return;
        }
        if (applied && isEntryCurrent() && entry.consumers.size) {
          this.assertCurrent(event.generation, version);
          const acknowledgement = await this.request("subscriptions.ack", {
            subscriptionId: entry.id,
            cursor: update.cursor,
          });
          if (
            typeof acknowledgement !== "object" ||
            acknowledgement === null ||
            !("accepted" in acknowledgement) ||
            acknowledgement.accepted !== true
          )
            throw new Error("Host did not acknowledge the applied subscription cursor");
          if (!isEntryCurrent()) return;
          entry.resyncAttempts = 0;
          this.stateValue = reduceConnectionState(this.stateValue, {
            type: "content-applied",
            generation: event.generation,
          });
        }
      })
      .catch((error) => {
        if (isEntryCurrent()) this.report(entry, error);
      })
      .finally(() => {
        if (entry.version === entryVersion) entry.queued--;
      });
  }

  private applyControl(
    entry: Entry,
    kind: "closed" | "resync-required",
    generation: number,
    subscriptionId: string,
    streamId: string,
  ): void {
    if (
      this.disposed ||
      entry.closed ||
      this.stateValue.transport !== "ready" ||
      generation !== this.stateValue.generation ||
      entry.generation !== generation ||
      entry.id !== subscriptionId ||
      entry.streamId !== streamId
    )
      return;
    if (kind === "resync-required") {
      void this.refresh(entry, true).catch((error) => this.report(entry, error));
      return;
    }
    entry.closed = true;
    entry.version++;
    entry.controls.clear();
    this.registry.invalidate({ ...this.scope, streamId: entry.key, filterKey: "snapshot" });
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    const consumers = [...entry.consumers];
    entry.consumers.clear();
    for (const retained of consumers) {
      retained.lease.release();
      void Promise.resolve()
        .then(() => retained.closed?.())
        .catch((error) => {
          try {
            retained.onError?.(error);
          } catch {
            /* consumer isolation */
          }
        });
    }
  }

  private async refresh(entry: Entry, recovery: boolean): Promise<void> {
    if (this.disposed || entry.closed || this.stateValue.transport !== "ready") return;
    if (entry.refreshing) return entry.refreshing;
    if ((recovery && entry.resyncAttempts >= 2) || entry.abandoned.size >= 2) {
      this.report(
        entry,
        new Error("Host subscription could not recover after two fresh snapshots"),
      );
      entry.closed = true;
      await this.request("subscriptions.close", { subscriptionId: entry.id }).catch(() => {});
      return;
    }
    const previousId = entry.id;
    const generation = this.stateValue.generation;
    this.interruptQueue(entry);
    entry.id = `${this.id}-subscription-${++this.sequence}`;
    entry.generation = undefined;
    entry.streamId = undefined;
    if (recovery) entry.resyncAttempts++;
    entry.refreshing = (async () => {
      await this.request("subscriptions.close", { subscriptionId: previousId });
      if (this.disposed || entry.closed || generation !== this.stateValue.generation) return;
      // Deliberately omit old cursors: the last application stays visible until
      // this fresh snapshot is validated and committed through the registry.
      await this.open(entry, true);
    })().finally(() => {
      entry.refreshing = undefined;
    });
    await entry.refreshing;
  }

  private interruptQueue(entry: Entry, snapshotRequired = true): boolean {
    const interruptApplication = snapshotRequired || entry.queued > 0;
    if (entry.queued) {
      if (entry.abandoned.size >= 2) return false;
      const previousTail = entry.tail;
      entry.abandoned.add(previousTail);
      void previousTail.finally(() => {
        entry.abandoned.delete(previousTail);
      });
      entry.tail = Promise.resolve();
    }
    entry.version++;
    entry.controls.clear();
    entry.queued = 0;
    if (interruptApplication)
      for (const consumer of entry.consumers) this.registry.interrupt(consumer.lease);
    return true;
  }

  private async open(entry: Entry, fresh = false): Promise<void> {
    if (this.disposed || entry.closed || this.stateValue.transport !== "ready") return;
    const generation = this.stateValue.generation;
    const entryVersion = entry.version;
    const subscriptionId = entry.id;
    if (entry.generation === generation) return entry.opening;
    entry.generation = generation;
    const cursors = [...entry.consumers].map((consumer) =>
      this.registry.appliedCursor(consumer.lease),
    );
    const first = cursors[0];
    const cursor: StreamCursor | undefined =
      !fresh &&
      first &&
      cursors.every((value) => value?.epoch === first.epoch && value.sequence === first.sequence)
        ? first
        : undefined;
    entry.opening = (async () => {
      const result = SubscriptionOpenResultSchema.parse(
        await this.request("subscriptions.open", {
          subscriptionId,
          target: entry.target,
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (
        this.disposed ||
        generation !== this.stateValue.generation ||
        entry.version !== entryVersion ||
        subscriptionId !== entry.id
      )
        return;
      if (entry.closed) {
        await this.request("subscriptions.close", { subscriptionId: entry.id });
        return;
      }
      if (result.subscriptionId !== subscriptionId)
        throw new Error("Host subscription identity changed");
      entry.streamId = result.streamId;
      const control = entry.controls.get(result.streamId);
      entry.controls.clear();
      if (control) this.applyControl(entry, control, generation, subscriptionId, result.streamId);
    })();
    await entry.opening;
  }

  private assertCurrent(generation: number, version: number): void {
    if (
      this.disposed ||
      version !== this.scopeVersion ||
      this.stateValue.transport !== "ready" ||
      generation !== this.stateValue.generation
    )
      throw new Error("Stale Host connection or access scope");
  }
  private async resolveBulk(
    value: unknown,
    generation: number,
    version: number,
    responseTimeoutMs?: number,
  ): Promise<unknown> {
    if (typeof value !== "object" || value === null || !("$bulk" in value)) return value;
    const { $bulk: descriptor } = BulkResultSchema.parse(value);
    if (descriptor.environmentId !== this.scope.environmentId)
      throw new Error("Host bulk environment changed");
    const resolved = await this.port.bulk(descriptor, { responseTimeoutMs });
    this.assertCurrent(generation, version);
    return resolved;
  }
  private report(entry: Entry, error: unknown, force = false): void {
    if (
      this.disposed ||
      entry.closed ||
      (!force &&
        (this.stateValue.transport === "connecting" || this.stateValue.transport === "retry-wait"))
    )
      return;
    for (const consumer of entry.consumers) {
      try {
        consumer.onError?.(error);
      } catch {
        /* consumer isolation */
      }
    }
  }
}
