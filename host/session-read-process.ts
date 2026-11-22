import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { randomUUID } from "node:crypto";
import { HostNotesAdmission, type HostNotesWorkerComparison } from "./host-notes-admission";
import { isSessionReadErrorKind, SessionReadError } from "./domains/sessions/read-errors";

export type SessionReadRequest =
  | { kind: "host"; path: string; sessionId: string }
  | {
      kind: "desktop";
      paths: string[];
      platform: NodeJS.Platform;
      method: "snapshot" | "snapshotStamp" | "metadata";
      sessionId: string;
      projectId?: string;
      expectedProjectCwd?: string;
    };
type Reply = {
  id: string;
  value?: unknown;
  error?: string;
  errorKind?: unknown;
  retire?: boolean;
};
type Job = {
  input: { id: string; request: SessionReadRequest; comparison?: HostNotesWorkerComparison };
  helper?: Helper;
  /** Set once the caller aborted a dispatched job; the helper gets a short grace to reply. */
  grace?: NodeJS.Timeout;
  cancel: () => void;
  /** Takes admission and arms the deadline when the job reaches a helper. */
  begin: (helper: Helper) => void;
  finish: (error?: Error, value?: unknown) => void;
};
type Helper = {
  child: ChildProcess;
  exited: Promise<void>;
  job?: Job;
  failure?: Error;
  idle?: NodeJS.Timeout;
};
const MAX_HELPERS = 2;
const DEADLINE_MS = 30_000;
const IDLE_MS = 60_000;
const ABORT_GRACE_MS = 250;
const aborted = () => new Error("Session read cancelled before completion.");
/** Each helper runs one readonly job at a time and closes its handles before replying. */
export class SessionReadProcesses {
  private readonly flights = new Map<
    string,
    {
      controller: AbortController;
      observers: Set<object>;
      attached: number;
      work: Promise<unknown>;
    }
  >();
  private readonly admission = new HostNotesAdmission();
  private readonly pending = new Set<Job>();
  private readonly helpers = new Set<Helper>();
  private closed = false;
  constructor(
    private readonly helper = new NodeURL("./session-read-helper.mjs", import.meta.url),
    private readonly spawn: typeof fork = fork,
  ) {}
  read<T>(request: SessionReadRequest, signal: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Session read processes are closed."));
    if (signal.aborted) return Promise.reject(aborted());
    const key = JSON.stringify(request);
    let flight = this.flights.get(key);
    if (!flight) {
      if (this.flights.size >= 8) return Promise.reject(new SessionReadError("overloaded"));
      const controller = new AbortController();
      const original = {
        controller,
        observers: new Set<object>(),
        attached: 0,
        work: Promise.resolve(undefined) as Promise<unknown>,
      };
      this.flights.set(key, original);
      original.work = Promise.resolve()
        .then(() => this.run(request, controller.signal))
        .finally(() => {
          if (this.flights.get(key) === original) this.flights.delete(key);
        });
      void original.work.catch(() => undefined);
      flight = original;
    }
    const original = flight;
    // Detached promises still await the original job; bound that retained metadata
    // too when an unresponsive child cannot be retired by the OS.
    if (original.attached >= 128) return Promise.reject(new SessionReadError("overloaded"));
    original.attached++;
    const observer = {};
    original.observers.add(observer);
    return new Promise<T>((resolve, reject) => {
      let cancelled = false;
      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        original.observers.delete(observer);
        if (!original.observers.size) original.controller.abort();
        else reject(aborted()); // Another observer still owns the same bounded process.
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      original.work
        .then(
          (value) => (cancelled ? reject(aborted()) : resolve(value as T)),
          (error) => reject(cancelled ? aborted() : error),
        )
        .finally(() => {
          signal.removeEventListener("abort", cancel);
          original.observers.delete(observer);
          original.attached--;
        })
        .catch(() => undefined);
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    const original = [...this.flights.values()];
    const helpers = [...this.helpers];
    for (const flight of original) flight.controller.abort();
    for (const helper of helpers) this.stop(helper, aborted());
    await Promise.allSettled([
      ...original.map((flight) => flight.work),
      ...helpers.map((helper) => helper.exited),
    ]);
  }
  private run(request: SessionReadRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      // Admission and the deadline start at dispatch, so queue wait costs neither.
      let accepted: ReturnType<HostNotesAdmission["accept"]>;
      let deadline: NodeJS.Timeout | undefined;
      const job: Job = {
        input: { id: randomUUID(), request },
        begin: () => undefined,
        cancel: () => {
          if (job.helper) {
            const helper = job.helper;
            if (job.grace || helper.failure) return;
            job.grace = setTimeout(() => this.stop(helper, aborted()), ABORT_GRACE_MS);
            job.grace.unref();
          } else if (this.pending.delete(job)) job.finish(aborted());
        },
        finish: (error, value) => {
          clearTimeout(deadline);
          clearTimeout(job.grace);
          signal.removeEventListener("abort", job.cancel);
          accepted?.finishActual();
          if (error) reject(error);
          else resolve(value);
        },
      };
      job.begin = (helper) => {
        accepted = this.admission.accept(
          request.kind === "host" ? [request.path] : request.paths,
          false,
        );
        job.input.comparison = accepted?.comparison;
        deadline = setTimeout(() => this.stop(helper, aborted()), DEADLINE_MS);
        deadline.unref();
      };
      this.pending.add(job);
      signal.addEventListener("abort", job.cancel, { once: true });
      if (signal.aborted) job.cancel();
      else this.dispatch();
    });
  }

  private dispatch(): void {
    for (const job of this.pending) {
      let helper = [...this.helpers].find((item) => !item.job && !item.failure);
      if (!helper && this.helpers.size >= MAX_HELPERS) return;
      this.pending.delete(job);
      try {
        helper ??= this.startHelper();
      } catch (error) {
        job.finish(
          error instanceof Error ? error : new Error("Session read helper could not start."),
        );
        continue;
      }
      const active = helper;
      clearTimeout(active.idle);
      active.idle = undefined;
      try {
        job.begin(active);
      } catch (error) {
        job.finish(error instanceof Error ? error : new Error("Session read admission failed."));
        this.park(active);
        continue;
      }
      active.job = job;
      job.helper = active;
      active.child.ref();
      active.child.channel?.ref();
      try {
        active.child.send(job.input, (error) => {
          if (error && active.job === job) this.stop(active, error);
        });
      } catch (error) {
        this.stop(
          active,
          error instanceof Error ? error : new Error("Session read helper send failed."),
        );
      }
    }
  }

  private startHelper(): Helper {
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    const child = this.spawn(fileURLToPath(this.helper), [], {
      execPath: process.execPath,
      execArgv: import.meta.url.endsWith(".ts") ? ["--experimental-transform-types"] : [],
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
    });
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const helper: Helper = { child, exited };
    this.helpers.add(helper);
    const noResult = () => new Error("Session read helper exited without a confirmed result.");
    const finishExit = () => {
      this.helpers.delete(helper);
      clearTimeout(helper.idle);
      helper.job?.finish(helper.failure ?? noResult());
      helper.job = undefined;
      resolveExit();
      this.dispatch();
    };
    child.once("exit", finishExit);
    child.once("close", () => {
      if (child.pid === undefined && this.helpers.has(helper)) finishExit();
    });
    child.on("error", (error) => this.stop(helper, error));
    child.once("disconnect", () => this.stop(helper, noResult()));
    child.on("message", (message: unknown) => this.receive(helper, message));
    return helper;
  }

  private receive(helper: Helper, message: unknown): void {
    if (helper.failure || !this.helpers.has(helper)) return;
    const job = helper.job;
    if (!job || !message || typeof message !== "object" || (message as Reply).id !== job.input.id) {
      this.stop(helper, new Error("Session read helper identity changed."));
      return;
    }
    const reply = message as Reply;
    if (reply.retire) {
      this.stop(helper, new Error("Session read connection close was not confirmed."));
      return;
    }
    // A caller that already received its abort gets the helper back, not the result.
    const error = job.grace
      ? aborted()
      : reply.error
        ? isSessionReadErrorKind(reply.errorKind)
          ? new SessionReadError(reply.errorKind)
          : new Error(reply.error)
        : undefined;
    helper.job = undefined;
    job.finish(error, reply.value);
    this.dispatch();
    this.park(helper);
  }

  /** An unused helper stays warm for a minute without keeping the Host alive. */
  private park(helper: Helper): void {
    if (helper.job || helper.failure || !this.helpers.has(helper)) return;
    clearTimeout(helper.idle);
    helper.child.unref();
    helper.child.channel?.unref();
    helper.idle = setTimeout(() => this.stop(helper, aborted()), IDLE_MS);
    helper.idle.unref();
  }

  private stop(helper: Helper, failure: Error): void {
    if (helper.failure || !this.helpers.has(helper)) return;
    helper.failure = failure;
    clearTimeout(helper.idle);
    // Keep this slot and its job admission until the captured child exits.
    try {
      if (helper.child.pid !== undefined) {
        helper.child.ref();
        helper.child.kill("SIGKILL");
      }
    } catch {
      /* unresolved child remains owned */
    }
  }
}
