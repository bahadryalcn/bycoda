import { Worker } from "node:worker_threads";
import type { SQLInputValue } from "node:sqlite";

/**
 * Read-only SQLite connections beside the store's single writer worker. One lease owns one
 * connection for one read scope and runs every statement of it in one read transaction, so a
 * multi-statement read sees one consistent snapshot of the WAL database and never waits for
 * the writer FIFO. Nothing here writes: the connections are `query_only`.
 */

/** Statements a read scope may issue; everything else belongs to the writer. */
export type ReadMethod = "get" | "all";
export type ReadLease = {
  request(method: ReadMethod, sql: string, params: SQLInputValue[]): Promise<any>;
};
/** The pool cannot serve reads (not WAL, workers will not start): the caller uses the writer. */
export class ReadPoolUnavailableError extends Error {
  constructor(reason: string) {
    super(`Host database read pool is unavailable: ${reason}`);
    this.name = "ReadPoolUnavailableError";
  }
}
type ReaderReply = {
  id?: number;
  ready?: boolean;
  wal?: boolean;
  value?: any;
  error?: string;
  code?: string;
  errcode?: number;
};
type Request = { resolve: (value: any) => void; reject: (error: Error) => void };
type Slot = {
  worker: Worker;
  ready: Promise<boolean>;
  pending: Map<number, Request>;
  sequence: number;
  busy: boolean;
  dead: boolean;
  /** `performance.now()` when the current lease took the slot. */
  leasedAt: number;
  /** Fails the lease that holds this slot, whatever its work is waiting for. */
  kill?: (error: Error) => void;
};
type Waiter = {
  grant: (slot: Slot) => void;
  fail: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};
const SPAWN_FAILURES_BEFORE_DISABLE = 3;
const WATCHDOG_MS = 5_000;
const READ_DEADLINE_MS = 60_000;

export class StoreReadPool {
  /** A read scope still running after this long fails and its connection is replaced. */
  deadlineMs = READ_DEADLINE_MS;
  private readonly slots: Slot[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly functions = new Set<string>();
  private spawnFailures = 0;
  private disabled?: string;
  private closed = false;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly options: {
      path: string;
      workerURL: URL;
      size: number;
      /** Every failed read statement, so the store can see corruption a reader found. */
      onError: (error: Error) => void;
    },
  ) {}

  get usable(): boolean {
    return !this.closed && !this.disabled;
  }
  /** Scopes holding a connection right now, for diagnostics and tests. */
  get activeLeases(): number {
    return this.slots.filter((slot) => slot.busy).length;
  }

  /**
   * Runs `work` with exclusive use of one connection. Waits (FIFO, independent of the writer
   * queue) when every connection is leased; `signal` abandons a wait that has not started.
   * Throws `ReadPoolUnavailableError` before `work` ran when no connection can be had.
   */
  async lease<T>(work: (lease: ReadLease) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const slot = await this.acquire(signal);
    let released = false;
    let begun = false;
    let killed: Error | undefined;
    const lease: ReadLease = {
      request: (method, sql, params) => {
        if (released || slot.dead)
          return Promise.reject(killed ?? new Error("Database read request has no live scope."));
        const id = ++slot.sequence;
        // The first statement opens the transaction; ordered messages keep it first.
        const begin = !begun;
        begun = true;
        return new Promise((resolve, reject) => {
          slot.pending.set(id, { resolve, reject });
          try {
            slot.worker.postMessage({ id, method, sql, params, begin });
          } catch (error) {
            slot.pending.delete(id);
            reject(error as Error);
          }
        });
      },
    };
    try {
      return await new Promise<T>((resolve, reject) => {
        slot.kill = (error) => {
          killed = error;
          reject(error);
        };
        work(lease).then(resolve, reject);
      });
    } finally {
      released = true;
      slot.kill = undefined;
      // Ends the snapshot without a round trip; the next lease's first statement would also
      // end a stale one, but an idle connection must not pin the WAL.
      if (begun && !slot.dead) {
        try {
          slot.worker.postMessage({ method: "end" });
        } catch {
          /* a dying worker drops its transaction with its connection */
        }
      }
      this.release(slot);
    }
  }

  /** Registers a SQL function on every connection, now and on those spawned later. */
  registerFunction(name: string): void {
    this.functions.add(name);
    for (const slot of this.slots)
      if (!slot.dead) void this.send(slot, "registerFunction", { name }).catch(() => undefined);
  }

  async close(error = new Error("Host database is closing.")): Promise<void> {
    this.closed = true;
    clearTimeout(this.watchdog);
    this.watchdog = undefined;
    for (const waiter of this.waiters.splice(0)) {
      this.detach(waiter);
      waiter.fail(error);
    }
    await Promise.all(this.slots.splice(0).map((slot) => this.kill(slot, error)));
  }

  private async acquire(signal?: AbortSignal): Promise<Slot> {
    if (signal?.aborted) throw new Error("Database read admission cancelled.");
    if (!this.usable) throw new ReadPoolUnavailableError(this.disabled ?? "closing");
    let slot = this.slots.find((candidate) => !candidate.busy && !candidate.dead);
    if (!slot && this.slots.filter((candidate) => !candidate.dead).length < this.options.size)
      slot = this.spawn();
    if (slot) slot.busy = true;
    else slot = await this.wait(signal);
    slot.leasedAt = performance.now();
    this.armWatchdog();
    try {
      if (!(await slot.ready))
        throw new ReadPoolUnavailableError(this.disabled ?? "a reader did not start");
      if (slot.dead) throw new ReadPoolUnavailableError("a reader stopped");
      return slot;
    } catch (error) {
      this.release(slot);
      throw error;
    }
  }

  private wait(signal?: AbortSignal): Promise<Slot> {
    return new Promise<Slot>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("Database read admission cancelled."));
      const waiter: Waiter = { grant: resolve, fail: reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("Database read admission cancelled."));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }
  private detach(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
  }

  private release(slot: Slot): void {
    slot.busy = false;
    for (;;) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      this.detach(waiter);
      if (waiter.signal?.aborted) continue;
      if (slot.dead) {
        // A replacement serves the waiter; none can be started once the pool is off.
        if (!this.usable) waiter.fail(new ReadPoolUnavailableError(this.disabled ?? "closing"));
        else {
          const replacement = this.spawn();
          replacement.busy = true;
          waiter.grant(replacement);
        }
        return;
      }
      slot.busy = true;
      waiter.grant(slot);
      return;
    }
  }

  private spawn(): Slot {
    let markReady!: (usable: boolean) => void;
    const ready = new Promise<boolean>((resolve) => (markReady = resolve));
    const worker = new Worker(this.options.workerURL, {
      workerData: { path: this.options.path, role: "reader" },
    });
    const slot: Slot = {
      worker,
      ready,
      pending: new Map(),
      sequence: 0,
      busy: false,
      dead: false,
      leasedAt: 0,
    };
    this.slots.push(slot);
    worker.on("message", (reply: ReaderReply) => {
      if (reply.ready) {
        if (reply.wal) {
          this.spawnFailures = 0;
          for (const name of this.functions)
            void this.send(slot, "registerFunction", { name }).catch(() => undefined);
        } else this.disable("the database is not in WAL mode");
        markReady(!!reply.wal);
        return;
      }
      const request = slot.pending.get(reply.id!);
      if (!request) return;
      slot.pending.delete(reply.id!);
      if (reply.error) {
        const error = Object.assign(new Error(reply.error), {
          code: reply.code,
          errcode: reply.errcode,
        });
        try {
          this.options.onError(error);
        } finally {
          request.reject(error);
        }
      } else request.resolve(reply.value);
    });
    const stopped = (cause: unknown) => {
      if (slot.dead) return;
      slot.dead = true;
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      markReady(false);
      const error = new Error("Host database reader stopped.", { cause });
      for (const request of slot.pending.values()) request.reject(error);
      slot.pending.clear();
      slot.kill?.(error);
      if (!this.closed && ++this.spawnFailures >= SPAWN_FAILURES_BEFORE_DISABLE)
        this.disable("readers keep stopping");
    };
    worker.on("error", stopped);
    worker.on("messageerror", stopped);
    worker.on("exit", (code) => stopped(new Error(`Database reader exit ${code}`)));
    return slot;
  }

  private disable(reason: string): void {
    if (this.disabled) return;
    this.disabled = reason;
    console.warn(`Host database read pool disabled: ${reason}; reads use the writer queue.`);
    for (const waiter of this.waiters.splice(0)) {
      this.detach(waiter);
      waiter.fail(new ReadPoolUnavailableError(reason));
    }
    const error = new ReadPoolUnavailableError(reason);
    for (const slot of this.slots.splice(0)) void this.kill(slot, error);
  }

  private send(slot: Slot, method: string, extra: Record<string, unknown>): Promise<unknown> {
    const id = ++slot.sequence;
    return new Promise((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      try {
        slot.worker.postMessage({ id, method, params: [], ...extra });
      } catch (error) {
        slot.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private async kill(slot: Slot, error: Error): Promise<void> {
    slot.dead = true;
    for (const request of slot.pending.values()) request.reject(error);
    slot.pending.clear();
    slot.kill?.(error);
    await slot.worker.terminate().catch(() => undefined);
  }

  /**
   * One timer for the whole pool, armed while any connection is leased: a scope past the
   * deadline fails and its connection is replaced, so a lost reply cannot pin a reader.
   */
  private armWatchdog(): void {
    if (this.watchdog || this.closed) return;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      const now = performance.now();
      for (const slot of [...this.slots]) {
        if (!slot.busy || now - slot.leasedAt < this.deadlineMs) continue;
        const index = this.slots.indexOf(slot);
        if (index >= 0) this.slots.splice(index, 1);
        console.error("Host database read scope exceeded its deadline; its reader was replaced.");
        void this.kill(
          slot,
          new Error(`Host database read scope exceeded its deadline ms=${this.deadlineMs}`),
        );
      }
      if (this.slots.some((slot) => slot.busy)) this.armWatchdog();
    }, WATCHDOG_MS);
    this.watchdog.unref?.();
  }
}
