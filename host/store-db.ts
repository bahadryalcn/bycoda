import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { SQLInputValue } from "node:sqlite";
import {
  PersistenceAdmissionError,
  storageFailure,
  type PersistenceHealth,
} from "./storage/persistence-health";

export type StoreRow = Record<string, any>;
/**
 * Structured clone ships a typed-array view's entire backing ArrayBuffer. A 64 KiB
 * chunk sliced from a 64 MiB artifact would otherwise copy 64 MiB per statement, so
 * partial views are copied to exact-size bytes before crossing to the store worker.
 */
const exactBytes = (value: SQLInputValue): SQLInputValue =>
  ArrayBuffer.isView(value) &&
  (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength)
    ? new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    : value;
const workerParams = (
  params: SQLInputValue[] | SQLInputValue[][],
): SQLInputValue[] | SQLInputValue[][] =>
  params.map((param) =>
    Array.isArray(param) ? param.map(exactBytes) : exactBytes(param as SQLInputValue),
  ) as SQLInputValue[] | SQLInputValue[][];
type Owner = { id: string; phase: "open" | "closing" | "closed" };
type AuthorizationCheck = () => boolean | Promise<boolean>;
export type StoreAuthorization =
  | AuthorizationCheck
  | { prepare(): Promise<AuthorizationCheck>; check: AuthorizationCheck };
type Reply = {
  id?: number;
  ready?: boolean;
  value?: any;
  error?: string;
  code?: string;
  errcode?: number;
};

export class RequestAuthorizationError extends Error {
  readonly code = "HOST_AUTH_REVOKED";
  constructor() {
    super("Request authorization was revoked.");
    this.name = "RequestAuthorizationError";
  }
}

/** A single SQLite owner. Every operation and whole cache-aware store method
 * shares FIFO admission; only nested work from its live ALS owner can reenter. */
export class StoreDatabase {
  readonly ready: Promise<void>;
  private readonly worker: Worker;
  private readonly owners = new AsyncLocalStorage<Owner>();
  private readonly internal = new AsyncLocalStorage<boolean>();
  private readonly authorizations = new AsyncLocalStorage<StoreAuthorization>();
  onMutation?: (sql: string) => void;
  /** Cache publication failed after a commit: the store must drop its caches. */
  onMutationFault?: () => void;
  onCommit?: (effect: () => void | Promise<void>) => void;
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  admissionVersion = 0;
  dataMutationVersion = 0;
  unattributedMutationVersion = 0;
  private failed?: Error;
  private closing = false;
  private closePromise?: Promise<void>;
  private terminating = false;
  private critical = new AsyncLocalStorage<boolean>();
  private recovering = new AsyncLocalStorage<boolean>();
  private health: PersistenceHealth = { state: "ready" };
  private ioFailures = 0;
  private busyFailures = 0;
  private recoveryAttempts = 0;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private queuedCancellableReads = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      owner: Owner;
      sql?: string;
      mutation: boolean;
      write: boolean;
    }
  >();

  constructor(path: string, workerURL = new URL("./store-worker.mjs", import.meta.url)) {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    this.worker = new Worker(workerURL, { workerData: { path } });
    this.worker.on("message", (reply: Reply) => {
      if (reply.ready) {
        resolveReady();
        return;
      }
      const request = this.pending.get(reply.id!);
      if (!request) return;
      this.pending.delete(reply.id!);
      if (reply.error) {
        const error = Object.assign(new Error(reply.error), {
          code: reply.code,
          errcode: reply.errcode,
        });
        const health = storageFailure(error);
        // A busy, full or I/O failure of a read changes nothing on disk, so it only fails
        // that read. Writes stay blocked only after a failed write; corruption always blocks.
        if (health && (request.write || health.state === "recovery-required"))
          this.setHealth(health);
        request.reject(error);
      } else {
        try {
          if (
            request.sql &&
            /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(request.sql)
          ) {
            this.dataMutationVersion++;
            if (
              request.mutation ||
              !/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(?:sessions|session_state|session_journal|session_journal_blocks|session_events)\b/i.test(
                request.sql,
              )
            )
              this.unattributedMutationVersion++;
          }
          if (request.mutation && request.sql)
            this.owners.run(request.owner, () => this.onMutation?.(request.sql!));
          request.resolve(reply.value);
        } catch (error) {
          // The write committed; a cache/listener fault must not kill storage.
          console.error("Host database cache publication failed; caches were cleared:", error);
          try {
            this.onMutationFault?.();
          } catch (faultError) {
            console.error("Host cache reset failed:", faultError);
          }
          request.resolve(reply.value);
        }
      }
    });
    const failed = (cause: unknown) => {
      const error = new Error(
        "Host database worker stopped. A pending write may have committed; restart the host before retrying.",
        { cause },
      );
      this.fail(error);
      rejectReady(error);
    };
    this.worker.on("error", failed);
    this.worker.on("exit", (code) => {
      if (!this.terminating) failed(new Error(`Database worker exit ${code}`));
    });
  }

  get ownsScope(): boolean {
    return this.owners.getStore()?.phase === "open";
  }
  get restartRequired(): boolean {
    return !!this.failed;
  }

  persistenceHealth(): PersistenceHealth {
    return { ...this.health };
  }
  /** Transient IO errors escalate only after repeated failed probes. */
  private setHealth(next: PersistenceHealth, recoveryProbe = false): void {
    if (recoveryProbe && next.state === "temporarily-blocked") {
      if (next.reason === "io" && ++this.ioFailures > 5)
        next = { state: "recovery-required", reason: "io" };
      // Another process holding the database is not damage: a write that fails because of
      // it reports its own error. Stop holding every write back once probes keep finding
      // it busy, instead of probing forever.
      else if (next.reason === "busy" && ++this.busyFailures > 6) {
        console.warn(
          "Host database stayed busy; accepting writes again, each reports its own failure.",
        );
        next = { state: "ready" };
        this.busyFailures = 0;
        this.recoveryAttempts = 0;
      }
    }
    this.health = next;
    if (next.state === "temporarily-blocked") this.scheduleRecovery();
  }
  /** A temporary block heals itself: probe with growing gaps until writes work. */
  private scheduleRecovery(): void {
    if (this.recoveryTimer || this.failed || this.closing || this.terminating) return;
    const delay = Math.min(3000 * 2 ** Math.min(this.recoveryAttempts, 4), 30_000);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (this.health.state !== "temporarily-blocked") return;
      this.recoveryAttempts++;
      this.recoverPersistence({ automatic: true }).catch((error) => {
        console.warn("Automatic persistence recovery failed; will retry:", error);
        if (this.health.state === "temporarily-blocked") this.scheduleRecovery();
      });
    }, delay);
    this.recoveryTimer.unref?.();
  }
  assertWriteAdmission(): void {
    if (this.health.state !== "ready" && !this.recovering.getStore())
      throw new PersistenceAdmissionError(this.persistenceHealth());
  }
  assertCriticalScope(): void {
    if (!this.critical.getStore())
      throw new Error("Accepted intent requires a critical storage transaction.");
  }
  /** Serialized FULL selection precedes BEGIN; no implicit upgrade inside a transaction. */
  durableScope<T>(work: () => T | Promise<T>): Promise<T> {
    return this.scope(async () => {
      this.assertWriteAdmission();
      if (this.critical.getStore()) return work();
      await this.request("durability", undefined, [2]);
      let value!: T;
      let primary: unknown;
      let rejected = false;
      try {
        value = await this.critical.run(true, work);
      } catch (error) {
        primary = error;
        rejected = true;
      }
      if (rejected && !this.failed) {
        try {
          await this.request("rollbackOpen");
        } catch (error) {
          this.fail(
            new Error(
              "Critical transaction cleanup could not prove rollback; reconcile storage before retrying.",
              { cause: error },
            ),
          );
          if (primary instanceof Error) {
            try {
              Object.defineProperty(primary, "cleanupError", { value: error, configurable: true });
            } catch {
              /* Preserve the primary failure even when its error object is immutable. */
            }
          }
        }
      }
      if (!this.failed) {
        try {
          await this.request("durability", undefined, [1]);
        } catch (error) {
          const failure = new Error("Could not restore serialized storage durability.", {
            cause: error,
          });
          this.fail(failure);
          if (!rejected) {
            primary = failure;
            rejected = true;
          }
        }
      }
      if (rejected) throw primary;
      return value;
    });
  }
  /** Probe (automatic for temporary blocks); a live worker may leave recovery-required
   * when the integrity check and write probe pass. Worker failure needs a restart.
   * An explicit call always runs the integrity check. An automatic probe is one small
   * write that does not wait out a lock, and verifies integrity only after an I/O error
   * (a whole-file scan on the storage queue every few seconds is not a probe). */
  recoverPersistence(options: { automatic?: boolean } = {}): Promise<void> {
    return this.scope(async () => {
      if (this.failed) throw new PersistenceAdmissionError(this.persistenceHealth());
      const previous = this.health;
      const automatic = options.automatic === true;
      const verify = !automatic || previous.reason === "io";
      this.health = { state: "recovering", reason: previous.reason };
      let waitMs: number | undefined;
      try {
        await this.recovering.run(true, () =>
          this.durableScope(async () => {
            if (automatic) {
              const row = await this.prepare("PRAGMA busy_timeout").get();
              waitMs = Number(row && Object.values(row)[0]) || 5000;
              await this.exec("PRAGMA busy_timeout=200");
            }
            try {
              await this.exec("BEGIN IMMEDIATE");
              try {
                await this.exec(
                  "CREATE TABLE IF NOT EXISTS host_persistence_probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL)",
                );
                await this.prepare(
                  "INSERT INTO host_persistence_probe VALUES (1, randomblob(4096)) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                ).run();
                await this.exec("COMMIT");
              } catch (error) {
                await this.exec("ROLLBACK");
                throw error;
              }
            } finally {
              if (waitMs !== undefined) {
                try {
                  await this.exec(`PRAGMA busy_timeout=${waitMs}`);
                } catch {
                  /* a dead worker fails the probe on its own */
                }
              }
            }
            if (verify) {
              const rows = await this.prepare("PRAGMA quick_check").all();
              if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok")
                throw Object.assign(new Error("Storage integrity verification failed."), {
                  errcode: 11,
                });
            }
          }),
        );
        this.health = { state: "ready" };
        this.ioFailures = 0;
        this.busyFailures = 0;
        this.recoveryAttempts = 0;
      } catch (error) {
        this.setHealth(storageFailure(error) ?? previous, true);
        throw error;
      }
    });
  }
  /** Caller holds the same source admission through manifest/blob capture. */
  backupTo(destination: string): Promise<void> {
    return this.scope(() => this.request("backup", undefined, [destination]));
  }

  fail(error: Error): void {
    this.failed ??= error;
    clearTimeout(this.recoveryTimer);
    this.health = { state: "recovery-required", reason: "worker" };
    for (const request of this.pending.values()) request.reject(this.failed);
    this.pending.clear();
  }

  outsideScope<T>(work: () => T): T {
    return this.owners.exit(() =>
      this.internal.exit(() =>
        this.authorizations.exit(() => this.critical.exit(() => this.recovering.exit(work))),
      ),
    );
  }
  /** Preserve request authority across external preparation without holding SQL admission. */
  withAuthorization<T>(guard: StoreAuthorization, work: () => T): T {
    return this.authorizations.run(guard, work);
  }
  /** Capture only authority, never an SQL owner or recovery/internal admission. */
  async captureAuthorization(): Promise<() => Promise<void>> {
    const owner = this.owners.getStore();
    if (owner && owner.phase !== "open")
      throw new Error("Database operation escaped its closed owner scope.");
    const original = this.authorizations.getStore();
    if (original && typeof original !== "function" && this.ownsScope)
      throw new Error("Prepare structured authorization before SQL admission.");
    const prepared =
      original && typeof original !== "function"
        ? await this.authorizations.exit(() => original.prepare())
        : undefined;
    const check = typeof original === "function" ? original : original?.check;
    const captured = async () => {
      const current = this.owners.getStore();
      if (current && current.phase !== "open")
        throw new Error("Database operation escaped its closed owner scope.");
      await this.authorize(check);
      if (prepared && prepared !== check) await this.authorize(prepared);
    };
    await captured();
    return captured;
  }
  /** @internal Only an already-owned failure's blocked-state/operation bookkeeping.
   * Keeps the current SQL owner; never use for new effects, retries or normal commands. */
  runRecoveryBookkeeping<T>(work: () => T): T {
    return this.authorizations.exit(work);
  }
  async checkAuthorization(): Promise<void> {
    const authorization = this.authorizations.getStore();
    if (authorization && typeof authorization !== "function" && !this.ownsScope) {
      const prepared = await this.authorizations.exit(() => authorization.prepare());
      return this.authorizations.exit(() => this.scope(() => this.authorize(prepared)));
    }
    return this.authorize(authorization);
  }
  private async authorize(guard?: StoreAuthorization): Promise<void> {
    // The guard may read this Store. Keep the live SQL owner, but prevent the
    // guard's own reads from recursively checking that same request guard.
    if (
      guard &&
      !(await this.authorizations.exit(typeof guard === "function" ? guard : guard.check))
    )
      throw new RequestAuthorizationError();
  }
  storeScope<T>(work: () => T | Promise<T>): Promise<T> {
    return this.scope(() => this.internal.run(true, work));
  }
  afterCommit(effect: () => void | Promise<void>): void {
    if (this.onCommit) this.onCommit(effect);
    else
      this.outsideScope(() => {
        void Promise.resolve(effect()).catch((error) =>
          console.error("Committed storage effect failed:", error),
        );
      });
  }

  scope<T>(work: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("Database read admission cancelled."));
    const current = this.owners.getStore();
    if (current) {
      if (current.phase !== "open")
        return Promise.reject(new Error("Database operation escaped its closed owner scope."));
      if (this.failed) return Promise.reject(this.failed);
      return Promise.resolve().then(work);
    }
    if (this.closing) return Promise.reject(new Error("Host database is closing."));
    const authorization = this.authorizations.getStore();
    // A scoped credential may need metadata from a different database/worker.
    // Prepare it before joining the SQL FIFO, then recheck authority on admission.
    if (authorization && typeof authorization !== "function")
      return this.authorizations
        .exit(() => authorization.prepare())
        .then((prepared) => this.authorizations.run(prepared, () => this.scope(work, signal)));
    if (signal && this.queuedCancellableReads >= 128)
      return Promise.reject(new Error("Database cancellable read queue is full."));
    if (signal) this.queuedCancellableReads++;
    this.admissionVersion++;
    let entered = false;
    const pending = this.tail.then(async () => {
      if (this.failed) throw this.failed;
      await this.ready;
      if (signal?.aborted) throw new Error("Database read admission cancelled.");
      entered = true;
      const owner: Owner = { id: randomUUID(), phase: "open" };
      return this.owners.run(owner, async () => {
        await this.request("enter", undefined, [], owner);
        let primary: unknown;
        let result: Awaited<ReturnType<typeof work>> | undefined;
        let workFailed = false;
        try {
          await this.authorize(authorization);
          result = await work();
        } catch (error) {
          primary = error;
          workFailed = true;
        }
        owner.phase = "closing";
        try {
          if (!this.failed) {
            try {
              await this.request("leave", undefined, [], owner);
            } catch (cleanupError) {
              if (primary === undefined) throw cleanupError;
              if (primary instanceof Error) {
                try {
                  Object.defineProperty(primary, "cleanupError", { value: cleanupError });
                } catch {
                  console.error("Database owner cleanup failed:", cleanupError);
                }
              } else console.error("Database owner cleanup failed:", cleanupError);
            }
          }
        } finally {
          owner.phase = "closed";
        }
        if (workFailed) throw primary;
        return result as Awaited<ReturnType<typeof work>>;
      });
    });
    const settled = pending.finally(() => { if (signal) this.queuedCancellableReads--; });
    this.tail = settled.catch(() => undefined);
    if (!signal) return settled;
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => {
        // The queued closure checks the same signal before enter. Once entered,
        // observer abort cannot release an accepted SQL owner or its writes.
        if (!entered) reject(new Error("Database read admission cancelled."));
      };
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled();
      settled.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancelled)).catch(() => undefined);
    });
  }

  private request(
    method: string,
    sql?: string,
    params: SQLInputValue[] | SQLInputValue[][] = [],
    owner = this.owners.getStore(),
  ): Promise<any> {
    if (this.failed) return Promise.reject(this.failed);
    const writes =
      method === "runMany" ||
      method === "run" ||
      method === "exec" ||
      ((method === "get" || method === "all" || method === "cursorOpen") &&
        !/^\s*(?:SELECT\b|PRAGMA\b|EXPLAIN\b)/i.test(sql ?? ""));
    if (writes && !/^\s*(?:ROLLBACK|PRAGMA\b)/i.test(sql ?? "")) {
      try {
        this.assertWriteAdmission();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    if (!owner || (owner.phase !== "open" && method !== "leave"))
      return Promise.reject(new Error("Database request has no live owner."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        owner,
        sql,
        mutation:
          !this.internal.getStore() &&
          (method === "runMany" || method === "run" || method === "exec"),
        write: writes,
      });
      try {
        this.worker.postMessage({ id, owner: owner.id, method, sql, params: workerParams(params) });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  prepare(sql: string): StoreStatement {
    return new StoreStatement(this, sql);
  }
  exec(sql: string): Promise<void> {
    return this.scope(() => this.request("exec", sql));
  }
  registerFunction(name: "social_text_matches"): Promise<void> {
    return this.scope(() => this.request("registerFunction", name));
  }
  query(method: "get" | "all" | "run", sql: string, params: SQLInputValue[]): Promise<any> {
    return this.scope(() => this.request(method, sql, params));
  }
  runMany(sql: string, rows: SQLInputValue[][]): Promise<void> {
    return this.scope(() => this.request("runMany", sql, rows));
  }
  async *iterate(sql: string, params: SQLInputValue[]): AsyncIterableIterator<StoreRow> {
    const owner = this.owners.getStore();
    if (!owner || owner.phase !== "open")
      throw new Error("Database iteration requires a live database scope.");
    const cursor = await this.request("cursorOpen", sql, params, owner);
    let primary: unknown;
    try {
      for (;;) {
        if (owner.phase !== "open")
          throw new Error("Database iterator escaped its closed owner scope.");
        const page = await this.request("cursorNext", undefined, [cursor], owner);
        for (const row of page.rows) {
          if (owner.phase !== "open")
            throw new Error("Database iterator escaped its closed owner scope.");
          yield row;
        }
        if (page.done) break;
      }
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      await this.closeCursor(owner, cursor, primary);
    }
  }
  /** Closes a cursor; a close failure is reported only when iteration itself did not fail. */
  private async closeCursor(owner: Owner, cursor: SQLInputValue, primary: unknown): Promise<void> {
    if (owner.phase !== "open" || this.failed) return;
    try {
      await this.request("cursorClose", undefined, [cursor], owner);
    } catch (error) {
      if (primary === undefined) throw error;
    }
  }
  close(beforeClose?: () => Promise<void>): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.owners.getStore()?.phase === "open")
      return Promise.reject(new Error("Host database cannot close from an active owner scope."));
    const closing = this.outsideScope(() =>
      this.scope(async () => {
        let primary: unknown;
        let flushFailed = false;
        try {
          await beforeClose?.();
        } catch (error) {
          primary = error;
          flushFailed = true;
        }
        try {
          await this.request("close");
        } catch (error) {
          if (!flushFailed) throw error;
          if (primary instanceof Error) {
            try {
              Object.defineProperty(primary, "cleanupError", { value: error });
            } catch {
              console.error("Database close failed:", error);
            }
          }
        }
        if (flushFailed) throw primary;
      }),
    );
    // Reserve one final FIFO operation before synchronously closing admission.
    // Its flush may reenter with the live final owner; unrelated work cannot.
    this.closing = true;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.closePromise = closing.finally(async () => {
      this.terminating = true;
      await this.worker.terminate();
    });
    return this.closePromise;
  }
}

export class StoreStatement {
  constructor(
    private readonly database: StoreDatabase,
    private readonly sql: string,
  ) {}
  get(...params: SQLInputValue[]): Promise<StoreRow | undefined> {
    return this.database.query("get", this.sql, params);
  }
  all(...params: SQLInputValue[]): Promise<StoreRow[]> {
    return this.database.query("all", this.sql, params);
  }
  run(
    ...params: SQLInputValue[]
  ): Promise<{ changes: number | bigint; lastInsertRowid: number | bigint }> {
    return this.database.query("run", this.sql, params);
  }
  runMany(rows: SQLInputValue[][]): Promise<void> {
    return this.database.runMany(this.sql, rows);
  }
  async *iterate(...params: SQLInputValue[]): AsyncIterableIterator<StoreRow> {
    yield* this.database.iterate(this.sql, params);
  }
}
