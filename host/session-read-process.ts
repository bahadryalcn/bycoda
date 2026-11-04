import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HostNotesAdmission } from "./host-notes-admission";

export type SessionReadRequest =
  | { kind: "host"; path: string; sessionId: string }
  | { kind: "desktop"; paths: string[]; platform: NodeJS.Platform; method: "snapshot" | "stamp" | "metadata"; sessionId: string; projectId?: string; expectedProjectCwd?: string };
type Reply = { id: string; value?: unknown; error?: string };
const aborted = () => new Error("Session read cancelled before completion.");
/** One bounded readonly job per child. Never settle a dispatched job before EXIT. */
export class SessionReadProcesses {
  private readonly flights = new Map<string, { controller: AbortController; observers: Set<object>; attached: number; work: Promise<unknown> }>();
  private readonly admission = new HostNotesAdmission();
  constructor(private readonly helper = new URL("./session-read-helper.mjs", import.meta.url), private readonly spawn: typeof fork = fork) {}
  read<T>(request: SessionReadRequest, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(aborted());
    const key = JSON.stringify(request);
    let flight = this.flights.get(key);
    if (!flight) {
      if (this.flights.size >= 8) return Promise.reject(new Error("Session read process capacity is busy."));
      const controller = new AbortController();
      const original = { controller, observers: new Set<object>(), attached: 0, work: Promise.resolve(undefined) as Promise<unknown> };
      this.flights.set(key, original);
      original.work = Promise.resolve().then(() => this.run(request, controller.signal)).finally(() => {
        if (this.flights.get(key) === original) this.flights.delete(key);
      });
      void original.work.catch(() => undefined);
      flight = original;
    }
    const original = flight;
    // Detached promises still await the original job; bound that retained metadata
    // too when an unresponsive child cannot be retired by the OS.
    if (original.attached >= 128) return Promise.reject(new Error("Session read observer capacity is busy."));
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
      original.work.then(
        (value) => cancelled ? reject(aborted()) : resolve(value as T),
        (error) => reject(cancelled ? aborted() : error),
      ).finally(() => {
        signal.removeEventListener("abort", cancel);
        original.observers.delete(observer);
        original.attached--;
      }).catch(() => undefined);
    });
  }
  close(): Promise<void> {
    const original = [...this.flights.values()];
    for (const flight of original) flight.controller.abort();
    return Promise.allSettled(original.map((flight) => flight.work)).then(() => undefined);
  }
  private run(request: SessionReadRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const accepted = this.admission.accept(request.kind === "host" ? [request.path] : request.paths, false);
    const id = randomUUID();
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      let failure: Error | undefined;
      let reply: Reply | undefined;
      let ended = false;
      let exited = false;
      let exitCode: number | null = null;
      const finish = (code: number | null) => {
        if (ended) return;
        ended = true;
        clearTimeout(deadline);
        signal.removeEventListener("abort", cancel);
        accepted?.finishActual();
        if (failure || code !== 0 || !reply || reply.error)
          reject(failure ?? new Error(reply?.error ?? "Session read helper exited without a confirmed result."));
        else resolve(reply.value);
      };
      const cancel = () => {
        failure ??= aborted();
        // This captured child has no descendant-spawning methods. A kill request
        // is not completion: keep its admission/slot until this child's EXIT.
        try { child.kill("SIGKILL"); } catch { /* unresolved child remains owned */ }
      };
      const deadline = setTimeout(cancel, 30_000);
      deadline.unref();
      try {
        child = this.spawn(fileURLToPath(this.helper), [], {
          execPath: process.execPath,
          execArgv: import.meta.url.endsWith(".ts") ? ["--experimental-transform-types"] : [],
          env: environment, windowsHide: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced",
        });
      } catch (error) {
        failure = error instanceof Error ? error : new Error("Session read helper could not start.");
        finish(null); // Synchronous spawn failure never produced a physical child.
        return;
      }
      child.once("exit", (code) => {
        exited = true;
        exitCode = code;
        if (failure || reply) finish(code);
      });
      child.once("error", (error) => {
        failure ??= error;
        if (child.pid !== undefined) cancel();
      });
      child.once("close", () => {
        if (exited) finish(exitCode);
        else if (child.pid === undefined) finish(null); // Failed native spawn: no child exists.
      });
      child.on("message", (value: unknown) => {
        if (!value || typeof value !== "object" || (value as Reply).id !== id || reply) {
          failure ??= new Error("Session read helper identity changed.");
          cancel();
          return;
        }
        reply = value as Reply;
        if (exited) finish(exitCode);
      });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else child.send({ id, request, comparison: accepted?.comparison }, (error) => {
        if (error) { failure ??= error; cancel(); }
      });
    });
  }
}
