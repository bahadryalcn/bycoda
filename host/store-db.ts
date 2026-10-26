import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { SQLInputValue } from "node:sqlite";

export type StoreRow = Record<string, any>;
type Owner = { id: string; phase: "open" | "closing" | "closed" };
type AuthorizationCheck = () => boolean | Promise<boolean>;
export type StoreAuthorization =
  | AuthorizationCheck
  | { prepare(): Promise<AuthorizationCheck>; check: AuthorizationCheck };
type Reply = { id?: number; ready?: boolean; value?: any; error?: string; code?: string };

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
  onCommit?: (effect: () => void | Promise<void>) => void;
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  admissionVersion = 0;
  private failed?: Error;
  private closing = false;
  private closePromise?: Promise<void>;
  private terminating = false;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      owner: Owner;
      sql?: string;
      mutation: boolean;
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
        const error = Object.assign(new Error(reply.error), { code: reply.code });
        request.reject(error);
      } else {
        try {
          if (request.mutation && request.sql)
            this.owners.run(request.owner, () => this.onMutation?.(request.sql!));
          request.resolve(reply.value);
        } catch (error) {
          const failure = new Error(
            "Host database committed but cache publication failed; restart the host before retrying.",
            { cause: error },
          );
          request.reject(failure);
          this.fail(failure);
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

  fail(error: Error): void {
    this.failed ??= error;
    for (const request of this.pending.values()) request.reject(this.failed);
    this.pending.clear();
  }

  outsideScope<T>(work: () => T): T {
    return this.owners.exit(() => this.internal.exit(() => this.authorizations.exit(work)));
  }
  /** Preserve request authority across external preparation without holding SQL admission. */
  withAuthorization<T>(guard: StoreAuthorization, work: () => T): T {
    return this.authorizations.run(guard, work);
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

  scope<T>(work: () => T | Promise<T>): Promise<T> {
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
        .then((prepared) => this.authorizations.run(prepared, () => this.scope(work)));
    this.admissionVersion++;
    const pending = this.tail.then(async () => {
      if (this.failed) throw this.failed;
      await this.ready;
      const owner: Owner = { id: randomUUID(), phase: "open" };
      return this.owners.run(owner, async () => {
        await this.request("enter", undefined, [], owner);
        let primary: unknown;
        try {
          await this.authorize(authorization);
          return await work();
        } catch (error) {
          primary = error;
          throw error;
        } finally {
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
        }
      });
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  private request(
    method: string,
    sql?: string,
    params: SQLInputValue[] = [],
    owner = this.owners.getStore(),
  ): Promise<any> {
    if (this.failed) return Promise.reject(this.failed);
    if (!owner || (owner.phase !== "open" && method !== "leave"))
      return Promise.reject(new Error("Database request has no live owner."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        owner,
        sql,
        mutation: !this.internal.getStore() && (method === "run" || method === "exec"),
      });
      try {
        this.worker.postMessage({ id, owner: owner.id, method, sql, params });
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
      if (owner.phase === "open" && !this.failed) {
        try {
          await this.request("cursorClose", undefined, [cursor], owner);
        } catch (error) {
          if (primary === undefined) throw error;
        }
      }
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
  async *iterate(...params: SQLInputValue[]): AsyncIterableIterator<StoreRow> {
    yield* this.database.iterate(this.sql, params);
  }
}
