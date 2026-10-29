import { Worker } from "node:worker_threads";
import { AsyncResource } from "node:async_hooks";
import {
  desktopDatabasePaths,
  type DesktopMetadataReply,
  type DesktopMetadataRecord,
  type DesktopSnapshotRecord,
  type DesktopStampRow,
} from "./desktopSessions";
import type { HostNotes, HostNoteDeleted } from "./host-notes";
import type { LocalSessionLocator } from "../src/features/sessions/model/localSessionReference";

type NoteMethod = "list" | "get" | "save" | "delete";
type Results = { [M in NoteMethod]: ReturnType<HostNotes[M]> } & {
  desktopList: DesktopMetadataReply;
  desktopStampRows: DesktopStampRow[];
  desktopMetadata: DesktopMetadataRecord | undefined;
  desktopLocalSessionReference: LocalSessionLocator | undefined;
  desktopSnapshot: DesktopSnapshotRecord | undefined;
};
type StorageMethod = keyof Results;
type Result<M extends StorageMethod> = Results[M];
type Authorization = () => boolean | Promise<boolean>;
type StorageWorker = {
  worker: Worker;
  failed: boolean;
  exited: Promise<void>;
};
type StorageJob = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  authorize?: Authorization;
  lifetime: Promise<void>;
  finish: () => void;
};
type DispatchedJob = StorageJob & { owner: StorageWorker };
export interface HostNotesAccess {
  readonly revision: number;
  list(...args: Parameters<HostNotes["list"]>): Result<"list"> | Promise<Result<"list">>;
  get(...args: Parameters<HostNotes["get"]>): Result<"get"> | Promise<Result<"get">>;
  save(
    raw: unknown,
    expectedUpdatedAt: unknown,
    scopedCwd?: string,
    authorize?: Authorization,
  ): Result<"save"> | Promise<Result<"save">>;
  delete(
    raw: unknown,
    expectedUpdatedAt: unknown,
    scopedCwd?: string,
    authorize?: Authorization,
  ): Result<"delete"> | Promise<Result<"delete">>;
}

/** The worker owns complete SQLite operations, including optimistic transactions.
 * A rejected/uncertain mutation is never replayed automatically. */
export class AsyncHostNotes implements HostNotesAccess {
  onDelete?: (note: HostNoteDeleted) => void;
  private worker?: StorageWorker;
  private sequence = 0;
  private version = Date.now();
  private closing = false;
  private closePromise?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, DispatchedJob>();
  constructor(
    private readonly paths: () => string[] = desktopDatabasePaths,
    private readonly workerUrl = new URL("./host-notes-worker.mjs", import.meta.url),
  ) {}
  get revision() {
    return this.version;
  }

  private async start(): Promise<StorageWorker> {
    // An error observation is not the worker's actual exit. Keep its identity
    // and original jobs until EXIT, rather than starting a concurrent successor.
    while (this.worker?.failed) await this.worker.exited;
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerUrl, {
      // Source execution uses Node's own type transformer; the packaged worker
      // is bundled JavaScript and needs no loader, compiler or source fallback.
      execArgv: import.meta.url.endsWith(".ts") ? ["--experimental-transform-types"] : [],
    });
    let finishExit!: () => void;
    const owner: StorageWorker = {
      worker,
      failed: false,
      exited: new Promise<void>((resolve) => {
        finishExit = resolve;
      }),
    };
    const failed = () => {
      owner.failed = true;
      worker.ref();
      for (const request of this.pending.values()) {
        if (request.owner === owner)
          request.reject(
            new Error(
              "Notes storage stopped. A write may have completed; refresh before retrying.",
            ),
          );
      }
    };
    worker.on("error", failed);
    worker.on("exit", () => {
      failed();
      if (this.worker === owner) this.worker = undefined;
      for (const [id, request] of this.pending) {
        if (request.owner !== owner) continue;
        this.pending.delete(id);
        request.finish();
      }
      finishExit();
    });
    worker.on(
      "message",
      async (reply: {
        id: number;
        kind?: string;
        signal?: SharedArrayBuffer;
        value?: unknown;
        error?: string;
        revision?: number;
        deletedNote?: HostNoteDeleted;
      }) => {
        const candidate = this.pending.get(reply.id);
        const request = candidate?.owner === owner ? candidate : undefined;
        if (reply.kind === "authorize" && reply.signal instanceof SharedArrayBuffer) {
          let allowed = false;
          try {
            allowed = !!request && (request.authorize ? await request.authorize() : true);
          } catch {
            /* fail closed */
          }
          if (this.pending.get(reply.id) !== request) allowed = false;
          const status = new Int32Array(reply.signal);
          Atomics.store(status, 0, allowed ? 1 : 2);
          Atomics.notify(status, 0);
          return;
        }
        if (!request) return;
        this.pending.delete(reply.id);
        if (typeof reply.revision === "number") this.version = reply.revision;
        try {
          if (reply.error) request.reject(new Error(reply.error));
          else {
            // Worker success follows its own COMMIT. Fence retained copies before
            // resolving the owner wait; do not defer this behind a HostDB actor.
            if (reply.deletedNote) this.onDelete?.(reply.deletedNote);
            request.resolve(reply.value);
          }
        } catch (cause) {
          // The deletion has already committed. Settle this waiter honestly;
          // a notification failure must never strand it or replay the mutation.
          request.reject(
            Object.assign(
              new Error(
                "The note was deleted, but its update notification failed. Refresh before continuing.",
                { cause },
              ),
              { code: "NOTES_DELETE_NOTIFICATION_FAILED", committed: true, uncertain: true },
            ),
          );
        } finally {
          // The production terminal message follows connection close, even if
          // its public waiter was already rejected by an earlier observation.
          request.finish();
          if (!owner.failed && !this.pending.size) worker.unref();
        }
      },
    );
    this.worker = owner;
    worker.unref();
    return owner;
  }

  private call<M extends StorageMethod>(
    method: M,
    args: unknown[],
    authorize?: Authorization,
  ): Promise<Result<M>> {
    if (this.closing) return Promise.reject(new Error("Notes storage is closing."));
    // Capture immutable input now; queued edits must not read a later draft.
    const input = structuredClone(args);
    const paths = this.paths();
    const currentAuthorization = authorize && AsyncResource.bind(authorize);
    let finish!: () => void;
    const lifetime = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let job!: StorageJob;
    const result = new Promise<Result<M>>((resolve, reject) => {
      job = {
        resolve: (value) => resolve(value as Result<M>),
        reject,
        authorize: currentAuthorization,
        lifetime,
        finish,
      };
    });
    this.tail = this.tail.then(async () => {
      try {
        if (this.worker?.failed) await this.worker.exited;
        if (currentAuthorization && !(await currentAuthorization()))
          throw new Error("Session authority revoked.");
        await this.dispatch(method, input, paths, job);
      } catch (error) {
        job.reject(error);
      } finally {
        job.finish();
      }
    });
    // A dropped RPC waiter does not cancel the accepted job or orphan rejection.
    void result.catch(() => {});
    return result;
  }
  private async dispatch(
    method: StorageMethod,
    args: unknown[],
    paths: string[],
    job: StorageJob,
  ): Promise<void> {
    const owner = await this.start(),
      worker = owner.worker,
      id = ++this.sequence;
    worker.ref();
    this.pending.set(id, { ...job, owner });
    try {
      worker.postMessage({ id, method, args, paths, checkAuthorization: !!job.authorize });
    } catch (error) {
      // Delivery may already have happened. Reject this public waiter, but only
      // a real terminal reply or worker EXIT can end the original SQL lifetime.
      job.reject(error);
    }
    await job.lifetime;
    if (owner.failed) await owner.exited;
  }
  list(...args: Parameters<HostNotes["list"]>) {
    return this.call("list", args);
  }
  get(...args: Parameters<HostNotes["get"]>) {
    return this.call("get", args);
  }
  desktopList(
    projectCwd: string,
    projectId: string,
    providers: readonly string[],
    platform: NodeJS.Platform,
    known?: string,
  ) {
    return this.call("desktopList", [projectCwd, projectId, providers, platform, known]);
  }
  desktopStampRows(id: string, platform: NodeJS.Platform) {
    return this.call("desktopStampRows", [id, platform]);
  }
  desktopMetadata(id: string, platform: NodeJS.Platform) {
    return this.call("desktopMetadata", [id, platform]);
  }
  desktopLocalSessionReference(id: string, platform: NodeJS.Platform) {
    return this.call("desktopLocalSessionReference", [id, platform]);
  }
  desktopSnapshot(
    id: string,
    projectId: string,
    platform: NodeJS.Platform,
    expectedProjectCwd?: string,
  ) {
    return this.call("desktopSnapshot", [id, projectId, platform, expectedProjectCwd]);
  }
  save(raw: unknown, expectedUpdatedAt: unknown, scopedCwd?: string, authorize?: Authorization) {
    return this.call("save", [raw, expectedUpdatedAt, scopedCwd], authorize);
  }
  delete(raw: unknown, expectedUpdatedAt: unknown, scopedCwd?: string, authorize?: Authorization) {
    return this.call("delete", [raw, expectedUpdatedAt, scopedCwd], authorize);
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.finishClose());
  }
  private async finishClose(): Promise<void> {
    this.closing = true;
    await this.tail;
    const owner = this.worker;
    if (!owner) return;
    // An accepted transaction must settle before its owner terminates.
    await owner.worker.terminate();
    await owner.exited;
  }
}
