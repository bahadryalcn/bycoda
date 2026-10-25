import { Worker } from "node:worker_threads";
import { AsyncResource } from "node:async_hooks";
import {
  desktopDatabasePaths,
  type DesktopMetadataReply,
  type DesktopMetadataRecord,
  type DesktopSnapshotRecord,
  type DesktopStampRow,
} from "./desktopSessions";
import type { HostNotes } from "./host-notes";

type NoteMethod = "list" | "get" | "save" | "delete";
type Results = { [M in NoteMethod]: ReturnType<HostNotes[M]> } & {
  desktopList: DesktopMetadataReply;
  desktopStampRows: DesktopStampRow[];
  desktopMetadata: DesktopMetadataRecord | undefined;
  desktopSnapshot: DesktopSnapshotRecord | undefined;
};
type StorageMethod = keyof Results;
type Result<M extends StorageMethod> = Results[M];
type Authorization = () => boolean | Promise<boolean>;
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
  private worker?: Worker;
  private sequence = 0;
  private version = Date.now();
  private closing = false;
  private closePromise?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; authorize?: Authorization }
  >();
  constructor(
    private readonly paths: () => string[] = desktopDatabasePaths,
    private readonly workerUrl = new URL("./host-notes-worker.mjs", import.meta.url),
  ) {}
  get revision() {
    return this.version;
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerUrl, {
      // Source execution uses Node's own type transformer; the packaged worker
      // is bundled JavaScript and needs no loader, compiler or source fallback.
      execArgv: import.meta.url.endsWith(".ts") ? ["--experimental-transform-types"] : [],
    });
    const failed = () => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const request of this.pending.values())
        request.reject(
          new Error("Notes storage stopped. A write may have completed; refresh before retrying."),
        );
      this.pending.clear();
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    worker.on(
      "message",
      async (reply: {
        id: number;
        kind?: string;
        signal?: SharedArrayBuffer;
        value?: unknown;
        error?: string;
        revision?: number;
      }) => {
        const request = this.pending.get(reply.id);
        if (reply.kind === "authorize" && reply.signal instanceof SharedArrayBuffer) {
          let allowed = false;
          try {
            allowed = !!request && (request.authorize ? await request.authorize() : true);
          } catch {
            /* fail closed */
          }
          const status = new Int32Array(reply.signal);
          Atomics.store(status, 0, allowed ? 1 : 2);
          Atomics.notify(status, 0);
          return;
        }
        if (!request) return;
        this.pending.delete(reply.id);
        if (typeof reply.revision === "number") this.version = reply.revision;
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.value);
        if (!this.pending.size) worker.unref();
      },
    );
    this.worker = worker;
    worker.unref();
    return worker;
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
    const result = this.tail.then(async () => {
      if (currentAuthorization && !(await currentAuthorization()))
        throw new Error("Session authority revoked.");
      return this.dispatch<M>(method, input, paths, currentAuthorization);
    });
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private dispatch<M extends StorageMethod>(
    method: M,
    args: unknown[],
    paths: string[],
    authorize?: Authorization,
  ): Promise<Result<M>> {
    const worker = this.start(),
      id = ++this.sequence;
    worker.ref();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as Result<M>), reject, authorize });
      try {
        worker.postMessage({ id, method, args, paths, checkAuthorization: !!authorize });
      } catch (error) {
        this.pending.delete(id);
        if (!this.pending.size) worker.unref();
        reject(error);
      }
    });
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
    const worker = this.worker;
    if (!worker) return;
    // An accepted transaction must settle before its owner terminates.
    if (this.worker === worker) this.worker = undefined;
    await worker.terminate();
  }
}
