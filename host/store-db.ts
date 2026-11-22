import { URL as NodeURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import type { SQLInputValue } from "node:sqlite";
import {
  PersistenceAdmissionError,
  storageFailure,
  type PersistenceHealth,
} from "./storage/persistence-health";
import { createDedupedWarn } from "./diagnostics/log-dedupe";
import { elapsedSince, monotonicNow } from "../src/shared/lib/time/timestamps";
import { ReadPoolUnavailableError, StoreReadPool, type ReadLease } from "./storage/store-read-pool";

export type StoreRow = Record<string, any>;
/** Every Host read and write waits behind a scope this long; the owner names the holder. */
const SLOW_SCOPE_MS = 1_000;
const slowScopeWarn = createDedupedWarn({ windowMs: 10 * 60_000 });
/**
 * A scope still open after this long blocks every later Host request. The release
 * warning never fires for an owner that never returns, so name it while it holds.
 */
const STUCK_SCOPE_MS = 15_000;
const SCOPE_DEADLINE_MS = 5 * 60_000;
const BOUNDARY_DEADLINE_MS = 60_000;
export type ScopeOptions = {
  deadlineMs?: number;
  /** Stable attribution for a known database operation when entering an idle queue. */
  site?: string | (() => string);
  /**
   * Absolute `monotonicNow()` instant after which this request must not be admitted. It is
   * the caller's original ingress deadline, so FIFO queue time counts against it. A scope
   * still queued past it is rejected with `StoreAdmissionExpiredError` before it enters or
   * runs anything; once admitted, the deadline no longer applies.
   */
  admitBefore?: number;
};
/**
 * The request's admission deadline passed before it entered the database or began its
 * transaction. Nothing ran and nothing was written, so the caller may report "not sent".
 */
export class StoreAdmissionExpiredError extends Error {
  readonly code = "HOST_STORE_ADMISSION_EXPIRED";
  readonly admitted = false as const;
  constructor(readonly waitedMs: number) {
    super(`Host database admission deadline passed before the request entered ms=${waitedMs}`);
    this.name = "StoreAdmissionExpiredError";
  }
}
/** Stage timings of one database owner; numbers only, never SQL, parameters or payloads. */
type ScopeTimings = {
  /** FIFO wait before this owner entered. */
  queueMs: number;
  /** Request-level authorization guards run while owning the scope. */
  guardMs: number;
  /** Time the worker spent executing statements. */
  workerMs: number;
  /** Time from posting a request to its reply, which includes worker execution and thread hops. */
  roundTripMs: number;
  /** Round trip of COMMIT, the durable flush. */
  commitMs: number;
  requests: number;
};
/** A holder never returned: it was failed so the queue could move on. */
class ScopeDeadlineError extends Error {
  constructor(site: string, ms: number) {
    super(`Host database queue holder ${site} exceeded its deadline ms=${ms}`);
    this.name = "ScopeDeadlineError";
  }
}
/** Frames kept of a scope's entry stack: enough for the caller names `scopeSite` reports. */
const SITE_FRAMES = 7;
/** Reader connections beside the writer; `BYCODA_HOST_READ_POOL=0` turns the pool off. */
const defaultReaders = (): number => {
  const configured = process.env.BYCODA_HOST_READ_POOL;
  if (configured === undefined || configured === "") return 2;
  const size = Number(configured);
  return Number.isInteger(size) && size >= 0 ? Math.min(size, 4) : 2;
};
const isMemoryPath = (path: string): boolean =>
  path === "" || path === ":memory:" || /^file:(?::memory:|\?.*mode=memory)/.test(path);
/** The functions that entered a scope: names only, no paths and none of this module's frames. */
const scopeSite = (entry: Error | string, depth = 3): string =>
  typeof entry === "string"
    ? entry
    : (entry.stack ?? "")
        .split("\n")
        .slice(1)
        .map((line) => /^\s*at (?:async )?([\w$.<>]+) \(/.exec(line)?.[1])
        .filter(
          (name): name is string => !!name && !/^(?:StoreDatabase|StoreStatement)\./.test(name),
        )
        .slice(0, depth)
        .join(" < ") || "unknown";
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
type Owner = { id: string; phase: "open" | "closing" | "closed"; timings?: ScopeTimings };
/** The owner holding the writer queue, for the one watchdog that names a stuck holder. */
type Holder = { id: string; entry: Error | string; enteredAt: number; admittedBefore: number };
type AuthorizationCheck = () => boolean | Promise<boolean>;
export type StoreAuthorization =
  | AuthorizationCheck
  | { prepare(): Promise<AuthorizationCheck>; check: AuthorizationCheck };
type Reply = {
  id?: number;
  ready?: boolean;
  value?: any;
  /** Worker-side execution time of this request. */
  ms?: number;
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

/** A single SQLite writer. Every write and whole cache-aware store method shares FIFO
 * admission; only nested work from its live ALS owner can reenter. Pure reads use
 * `readScope`, which runs on read-only connections beside the writer instead of in the FIFO. */
export class StoreDatabase {
  readonly ready: Promise<void>;
  private readonly worker: Worker;
  private readonly owners = new AsyncLocalStorage<Owner>();
  /** The read lease of the current `readScope`; reads inside it use its connection. */
  private readonly readLeases = new AsyncLocalStorage<ReadLease>();
  private readonly readPool?: StoreReadPool;
  /** The reader connections need the WAL file the first writer scope (initialization) made. */
  private writerSettled = false;
  private holder?: Holder;
  private watchdog?: ReturnType<typeof setTimeout>;
  private watchedHolder?: string;
  private activeScopes = 0;
  private readonly internal = new AsyncLocalStorage<boolean>();
  private readonly authorizations = new AsyncLocalStorage<StoreAuthorization>();
  onMutation?: (sql: string) => void;
  /** Cache publication failed after a commit: the store must drop its caches. */
  onMutationFault?: () => void;
  onCommit?: (effect: () => void | Promise<void>) => void;
  /** A holder exceeded its deadline: drop any state it kept for a transaction it will never finish. */
  onScopeAbandoned?: () => void;
  /** The worker failed for good: only a Host restart recovers. Called once, from `fail()`. */
  onFatal?: () => void;
  /** Longest one owner may hold the queue (see `scope`). */
  scopeDeadlineMs = SCOPE_DEADLINE_MS;
  /** Longest the worker may take to answer an enter/leave or a liveness ping. */
  boundaryDeadlineMs = BOUNDARY_DEADLINE_MS;
  /** An owner holding the queue, or a request waiting in it, this long logs its stage timings. */
  slowScopeMs = SLOW_SCOPE_MS;
  /** Sink for slow-scope stage timings; deduplicated per call site by default. */
  scopeWarn: (message: string, detail?: string) => void = slowScopeWarn;
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private ownerSequence = 0;
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
      sentAt: number;
      commit: boolean;
    }
  >();

  constructor(
    path: string,
    workerURL = new NodeURL("./store-worker.mjs", import.meta.url),
    options: { readers?: number } = {},
  ) {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    this.worker = new Worker(workerURL, { workerData: { path } });
    const readers = options.readers ?? defaultReaders();
    // An in-memory database exists only inside the writer's connection.
    if (readers > 0 && !isMemoryPath(path))
      this.readPool = new StoreReadPool({
        path,
        workerURL,
        size: readers,
        // A read changes nothing on disk: only damage it found blocks the store.
        onError: (error) => {
          const health = storageFailure(error);
          if (health?.state === "recovery-required") this.setHealth(health);
        },
      });
    this.worker.on("message", (reply: Reply) => {
      if (reply.ready) {
        resolveReady();
        return;
      }
      const request = this.pending.get(reply.id!);
      if (!request) return;
      this.pending.delete(reply.id!);
      const timings = request.owner.timings;
      if (timings) {
        const roundTrip = performance.now() - request.sentAt;
        timings.requests++;
        timings.roundTripMs += roundTrip;
        timings.workerMs += typeof reply.ms === "number" ? reply.ms : 0;
        if (request.commit) timings.commitMs += roundTrip;
      }
      if (reply.error) {
        const error = Object.assign(new Error(reply.error), {
          code: reply.code,
          errcode: reply.errcode,
        });
        try {
          const health = storageFailure(error);
          // A busy, full or I/O failure of a read changes nothing on disk, so it only fails
          // that read. Writes stay blocked only after a failed write; corruption always blocks.
          if (health && (request.write || health.state === "recovery-required"))
            this.setHealth(health);
        } finally {
          // The request left `pending`; whatever bookkeeping throws, its caller must hear back.
          request.reject(error);
        }
      } else {
        try {
          if (
            request.sql &&
            /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(request.sql)
          ) {
            this.dataMutationVersion++;
            if (
              request.mutation ||
              !/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(?:sessions|session_state|session_journal|session_journal_blocks|events)\b/i.test(
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
    // A reply that cannot be deserialized never reaches "message": its request would wait forever.
    this.worker.on("messageerror", failed);
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
      // An abandoned owner (deadline) has no live scope: its transaction was already rolled
      // back by the release, and its cleanup requests must not fail the database.
      if (rejected && !this.failed && this.ownsScope) {
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
      if (!this.failed && this.ownsScope) {
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
    return this.scope(() => this.request("backup", undefined, [destination]), undefined, {
      deadlineMs: Infinity,
    });
  }

  fail(error: Error): void {
    const first = !this.failed;
    this.failed ??= error;
    if (first) {
      try {
        this.onFatal?.();
      } catch (fatalError) {
        console.error("Host database failure handler failed:", fatalError);
      }
    }
    clearTimeout(this.recoveryTimer);
    this.health = { state: "recovery-required", reason: "worker" };
    for (const request of this.pending.values()) request.reject(this.failed);
    this.pending.clear();
    // Readers of a database that needs a restart would serve a state no writer stands behind.
    void this.readPool?.close(this.failed).catch(() => undefined);
    clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  outsideScope<T>(work: () => T): T {
    return this.owners.exit(() =>
      this.readLeases.exit(() =>
        this.internal.exit(() =>
          this.authorizations.exit(() => this.critical.exit(() => this.recovering.exit(work))),
        ),
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
    if (!guard) return;
    const timings = this.owners.getStore()?.timings;
    const startedAt = performance.now();
    try {
      if (!(await this.authorizations.exit(typeof guard === "function" ? guard : guard.check)))
        throw new RequestAuthorizationError();
    } finally {
      if (timings) timings.guardMs += performance.now() - startedAt;
    }
  }
  /**
   * Throws `StoreAdmissionExpiredError` when the caller's ingress deadline has passed. Call it
   * before work that must not begin late (a BEGIN, an effect); it costs no queue admission.
   */
  assertAdmissionOpen(admitBefore: number | undefined): void {
    if (admitBefore !== undefined && monotonicNow() >= admitBefore)
      throw new StoreAdmissionExpiredError(0);
  }
  storeScope<T>(work: () => T | Promise<T>, options?: ScopeOptions): Promise<T> {
    return this.scope(() => this.internal.run(true, work), undefined, options);
  }
  /**
   * One timer for the whole queue: it names a holder that kept the writer through a whole
   * interval. A holder that changed meanwhile only re-targets it, so scopes pay nothing.
   */
  private armWatchdog(): void {
    if (this.watchdog || !this.holder) return;
    this.watchedHolder = this.holder.id;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      const holder = this.holder;
      if (!holder) return;
      if (holder.id === this.watchedHolder)
        console.warn(
          `Host database queue still held by ${scopeSite(holder.entry, 8)} ms=${Math.round(performance.now() - holder.enteredAt)} queued=${this.admissionVersion - holder.admittedBefore}`,
        );
      this.armWatchdog();
    }, STUCK_SCOPE_MS);
    this.watchdog.unref?.();
  }

  /**
   * Runs pure reads outside the writer FIFO: on a read-only connection, in one read
   * transaction, so every statement of `work` sees the same committed snapshot. Inside a
   * writer scope the read runs on the writer and sees that scope's own writes. In-memory
   * databases, `BYCODA_HOST_READ_POOL=0` and a pool that cannot start fall back to `scope`.
   * `work` must only read: the connection is `query_only`.
   *
   * A reader never sees uncommitted state, and a write whose scope was merely queued before
   * this call may not be visible yet; await the write when the read must follow it.
   */
  async readScope<T>(work: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error("Database read admission cancelled.");
    // A writer owner reads its own writes; a read inside a read scope shares its snapshot.
    if (this.owners.getStore()) return this.scope(work, signal);
    if (this.readLeases.getStore()) return work();
    const pool = this.readPool;
    if (!pool?.usable || !this.writerSettled || this.failed || this.closing)
      return this.scope(work, signal);
    const authorization = this.authorizations.getStore();
    if (authorization && typeof authorization !== "function") {
      const prepared = await this.authorizations.exit(() => authorization.prepare());
      return this.authorizations.run(prepared, () => this.readScope(work, signal));
    }
    await this.authorize(authorization);
    let started = false;
    try {
      return await pool.lease(async (lease) => {
        started = true;
        return this.readLeases.run(lease, work);
      }, signal);
    } catch (error) {
      // Nothing ran: serve the read from the writer instead of failing it.
      if (!started && error instanceof ReadPoolUnavailableError) return this.scope(work, signal);
      throw error;
    }
  }
  /**
   * `PRAGMA data_version` of the writer connection: it moves only when another connection
   * or process committed, which is the store's external-change signal. Answered between
   * worker operations, so it never waits in the writer queue.
   */
  dataVersion(): Promise<number> {
    // A closed worker never answers; fail like a scope would instead of waiting forever.
    if (this.terminating) return Promise.reject(new Error("Host database is closed."));
    return this.probeWorker("dataVersion").then((value) => Number(value));
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

  /**
   * Runs `work` as the one owner of the database; later scopes queue FIFO behind it.
   * An owner still running after the deadline (default 5 minutes; `deadlineMs: Infinity`
   * for work that is legitimately long, such as backups and migrations) is abandoned: its
   * promise rejects with `ScopeDeadlineError`, its transaction rolls back and the queue
   * moves on. Abandonment cannot stop code: whatever `work` does outside the store
   * (processes, network, timers, in-memory state) keeps running, and only its later store
   * requests are rejected as having no live owner.
   */
  scope<T>(work: () => T | Promise<T>, signal?: AbortSignal, options?: ScopeOptions): Promise<T> {
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
        .then((prepared) =>
          this.authorizations.run(prepared, () => this.scope(work, signal, options)),
        );
    if (signal && this.queuedCancellableReads >= 128)
      return Promise.reject(new Error("Database cancellable read queue is full."));
    if (signal) this.queuedCancellableReads++;
    // Every later admission queues behind this one (FIFO); nested work never admits.
    const admittedBefore = ++this.admissionVersion;
    // The caller's stack is gone by the time a scope turns out slow, so it is captured here:
    // V8 formats it only when read, and a short capture is all the caller names need.
    let entry: Error | string;
    if (options?.site && this.activeScopes === 0)
      entry = typeof options.site === "function" ? options.site() : options.site;
    else {
      const stackLimit = Error.stackTraceLimit;
      Error.stackTraceLimit = SITE_FRAMES;
      try {
        entry = new Error();
      } finally {
        Error.stackTraceLimit = stackLimit;
      }
    }
    const queuedAt = performance.now();
    let entered = false;
    this.activeScopes++;
    const pending = this.tail.then(async () => {
      if (this.failed) throw this.failed;
      await this.ready;
      if (signal?.aborted) throw new Error("Database read admission cancelled.");
      // Queue time counts against the caller's original deadline: a request that waited out
      // its deadline never enters, so nothing of it can run after the caller gave up.
      if (options?.admitBefore !== undefined && monotonicNow() >= options.admitBefore) {
        const waitedMs = Math.round(performance.now() - queuedAt);
        if (waitedMs >= this.slowScopeMs)
          this.scopeWarn(
            `Host database request expired in queue before ${scopeSite(entry)}`,
            `queue=${waitedMs}ms queued=${this.admissionVersion - admittedBefore}`,
          );
        throw new StoreAdmissionExpiredError(waitedMs);
      }
      entered = true;
      const enteredAt = performance.now();
      const owner: Owner = {
        id: String(++this.ownerSequence),
        phase: "open",
        timings: {
          queueMs: enteredAt - queuedAt,
          guardMs: 0,
          workerMs: 0,
          roundTripMs: 0,
          commitMs: 0,
          requests: 0,
        },
      };
      this.holder = { id: owner.id, entry, enteredAt, admittedBefore };
      this.armWatchdog();
      return this.owners.run(owner, async () => {
        await this.request("enter", undefined, [], owner);
        let primary: unknown;
        let result: Awaited<ReturnType<typeof work>> | undefined;
        let workFailed = false;
        try {
          await this.authorize(authorization);
          result = await this.withDeadline(
            work(),
            owner,
            entry,
            options?.deadlineMs ?? this.scopeDeadlineMs,
          );
        } catch (error) {
          primary = error;
          workFailed = true;
          if (error instanceof ScopeDeadlineError) {
            // The abandoned work can never roll back its own state; the leave below rolls
            // back the SQL transaction, the store resets what it kept beside it.
            try {
              this.onScopeAbandoned?.();
            } catch (abandonError) {
              console.error("Host database abandoned-scope reset failed:", abandonError);
            }
          }
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
          if (this.holder?.id === owner.id) this.holder = undefined;
        }
        const held = performance.now() - enteredAt;
        const timings = owner.timings!;
        if (held >= this.slowScopeMs || timings.queueMs >= this.slowScopeMs) {
          const ms = (value: number) => Math.round(value);
          // Numbers only: never SQL text, parameters, payloads, tokens or paths.
          this.scopeWarn(
            `Host database queue held by ${scopeSite(entry)}`,
            `ms=${ms(held)} queued=${this.admissionVersion - admittedBefore} queue=${ms(timings.queueMs)}ms guard=${ms(timings.guardMs)}ms worker=${ms(timings.workerMs)}ms roundTrip=${ms(timings.roundTripMs)}ms commit=${ms(timings.commitMs)}ms requests=${timings.requests}`,
          );
        }
        if (workFailed) throw primary;
        return result as Awaited<ReturnType<typeof work>>;
      });
    });
    const settled = pending.finally(() => {
      this.writerSettled = true;
      if (signal) this.queuedCancellableReads--;
      // An idle database keeps no timer; a busy one keeps the one watchdog.
      if (--this.activeScopes === 0) {
        clearTimeout(this.watchdog);
        this.watchdog = undefined;
      }
    });
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
      settled
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", cancelled))
        .catch(() => undefined);
    });
  }

  /**
   * Bounds how long one owner may hold the FIFO. Past the deadline the holder fails with
   * `ScopeDeadlineError` so the queue moves on; its late requests find a closed owner. A
   * holder blocked on the worker itself (reply lost) cannot be released safely, so the
   * database fails and every pending request rejects instead of waiting forever.
   */
  private withDeadline<T>(
    work: T | Promise<T>,
    owner: Owner,
    entry: Error | string,
    deadlineMs: number,
  ): Promise<T> {
    if (!Number.isFinite(deadlineMs)) return Promise.resolve(work);
    return new Promise<T>((resolve, reject) => {
      const startedAt = monotonicNow();
      let settled = false;
      const timer = setTimeout(() => {
        const error = new ScopeDeadlineError(
          scopeSite(entry, 8),
          Math.round(elapsedSince(startedAt)),
        );
        const abandon = () => {
          if (settled) return;
          console.error(`Host database queue holder abandoned: ${error.message}`);
          reject(error);
        };
        if (![...this.pending.values()].some((request) => request.owner === owner)) {
          abandon();
          return;
        }
        // A request is still on the worker: slow is not dead. Only a worker that does not
        // answer a ping is failed; a responsive one lets the holder be abandoned.
        // A missing answer already failed the database in `watchReply`, which rejects the work.
        this.pingWorker().then(abandon, () => undefined);
      }, deadlineMs);
      timer.unref?.();
      Promise.resolve(work)
        .then(resolve, reject)
        .finally(() => {
          settled = true;
          clearTimeout(timer);
        });
    });
  }

  /** Resolves when the worker answers between operations; rejects when it does not in time. */
  private pingWorker(): Promise<void> {
    return this.probeWorker("ping").then(() => undefined);
  }
  /** A request answered between worker operations that owns nothing: a ping or a version read. */
  private probeWorker(method: "ping" | "dataVersion"): Promise<unknown> {
    if (this.failed) return Promise.reject(this.failed);
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      // A version read waits behind whatever statement the worker runs, however long a
      // migration makes it; only the liveness ping may declare the worker lost.
      const timer = method === "ping" ? this.watchReply(id, "a liveness ping") : undefined;
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        owner: { id: "", phase: "closed" },
        mutation: false,
        write: false,
        sentAt: performance.now(),
        commit: false,
      });
      try {
        this.worker.postMessage({ id, owner: "", method, params: [] });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Fails the database when request `id` has no answer after the boundary deadline. The
   * check runs on `setImmediate`: after a long main-thread stall or sleep the timer fires
   * before the queued replies are delivered, and a late-but-delivered reply is not a failure.
   */
  private watchReply(id: number, what: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      setImmediate(() => {
        const request = this.pending.get(id);
        if (!request) return;
        const error = new Error(`Host database worker did not answer ${what} in time.`);
        this.fail(error);
      });
    }, this.boundaryDeadlineMs);
    timer.unref?.();
    return timer;
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
      method === "batchWrites" ||
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
      // Admission and release are instant for a healthy worker; no reply means it is lost.
      const boundary =
        method === "enter" || method === "leave" ? this.watchReply(id, `"${method}"`) : undefined;
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(boundary);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(boundary);
          reject(error);
        },
        owner,
        sql,
        mutation:
          !this.internal.getStore() &&
          (method === "runMany" ||
            method === "batchWrites" ||
            method === "run" ||
            method === "exec"),
        write: writes,
        sentAt: performance.now(),
        commit: method === "exec" && /^\s*COMMIT\s*;?\s*$/i.test(sql ?? ""),
      });
      try {
        this.worker.postMessage({ id, owner: owner.id, method, sql, params: workerParams(params) });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(boundary);
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
    this.readPool?.registerFunction(name);
    return this.scope(() => this.request("registerFunction", name));
  }
  query(method: "get" | "all" | "run", sql: string, params: SQLInputValue[]): Promise<any> {
    // Inside a read scope (and no writer owner) the statement joins its read transaction.
    const lease = this.owners.getStore() ? undefined : this.readLeases.getStore();
    if (lease) {
      if (method === "run") return Promise.reject(new Error("A read scope cannot write."));
      return lease.request(method, sql, workerParams(params) as SQLInputValue[]);
    }
    return this.scope(() => this.request(method, sql, params), undefined, {
      // The statement text (never its parameters) names what a slow holder was doing.
      // Built only when used: nested statements return before the label is needed.
      site: () => `SQL ${method}: ${sql.replace(/\s+/g, " ").trim().slice(0, 80)}`,
    });
  }
  runMany(sql: string, rows: SQLInputValue[][]): Promise<void> {
    return this.scope(() => this.request("runMany", sql, rows));
  }
  /** Writes share the caller's transaction, owner and rollback boundary. */
  batchWrites(operations: { sql: string; rows: (string | number | null)[][] }[]): Promise<void> {
    if (!this.internal.getStore())
      return Promise.reject(new Error("Batched writes require a store scope."));
    return this.scope(() =>
      this.request("batchWrites", "UPDATE session_journal", [JSON.stringify(operations)]),
    );
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
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
      await Promise.all([this.worker.terminate(), this.readPool?.close()]);
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
