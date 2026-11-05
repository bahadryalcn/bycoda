import { wrap, type Remote } from "comlink";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import type { DiffWorkerApi } from "./diffWorker.worker";

/** Base deadline for one active request, before the per-input-size allowance. */
const BASE_TIMEOUT_MS = 10_000;
/** Extra time granted per KiB of input; large files legitimately take longer. */
const TIMEOUT_MS_PER_KIB = 20;
const MAX_TIMEOUT_MS = 120_000;
/** Consecutive failed requests before the worker is given up for a while. */
const FAILURE_BUDGET = 3;
/** After giving up, the worker is tried again once this much time has passed. */
const RETRY_AFTER_MS = 60_000;

let worker: Worker | undefined;
let api: Remote<DiffWorkerApi> | undefined;
/** Monotonic time at which the worker was given up; undefined while it is usable. */
let givenUpAt: number | undefined;
let consecutiveFailures = 0;
let failActive: ((reason: Error) => void) | undefined;
/** Requests run one at a time so a deadline measures only the work being done. */
let queue: Promise<unknown> = Promise.resolve();

/** Deadline for one request: the base plus an allowance that grows with the input size in characters. */
export function diffWorkerDeadline(size = 0): number {
  const extra = Math.ceil(Math.max(0, size) / 1024) * TIMEOUT_MS_PER_KIB;
  return Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + extra);
}

/** Whether a request may use the worker now, re-arming it once the retry delay has passed. */
function workerMayRun(): boolean {
  if (givenUpAt === undefined) return true;
  if (elapsedSince(givenUpAt) < RETRY_AFTER_MS) return false;
  givenUpAt = undefined;
  consecutiveFailures = 0;
  return true;
}

/** Drops the worker so the next request starts a fresh one; the caller decides when to give up. */
function recycle(failedWorker?: Worker) {
  if (failedWorker && failedWorker !== worker) return;
  worker?.terminate();
  worker = undefined;
  api = undefined;
}

function ensureWorker(): Remote<DiffWorkerApi> {
  if (api) return api;
  const created = new Worker(new URL("./diffWorker.worker.ts", import.meta.url), {
    type: "module",
  });
  const onFailure = () => {
    failActive?.(new Error("Diff worker failed"));
    recycle(created);
  };
  created.addEventListener("error", onFailure);
  created.addEventListener("messageerror", onFailure);
  worker = created;
  api = wrap<DiffWorkerApi>(created);
  return api;
}

type Attempt<T> = { ok: true; value: T } | { ok: false };

async function attempt<T>(
  invoke: (remote: Remote<DiffWorkerApi>) => Promise<T>,
  size: number,
): Promise<Attempt<T>> {
  if (typeof Worker === "undefined" || !workerMayRun()) return { ok: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remote = ensureWorker();
    // The timer starts here, when the request becomes active, never while it waits in the queue.
    const failed = new Promise<never>((_, reject) => {
      failActive = reject;
      timer = setTimeout(
        () => reject(new Error("Diff worker timed out")),
        diffWorkerDeadline(size),
      );
    });
    const value = await Promise.race([invoke(remote), failed]);
    consecutiveFailures = 0;
    return { ok: true, value };
  } catch {
    // Only this request falls back; the worker is re-created for the ones behind it.
    // A single timeout never disables the worker; only a run of failures does, and
    // even then it is retried after RETRY_AFTER_MS.
    consecutiveFailures += 1;
    recycle();
    if (consecutiveFailures >= FAILURE_BUDGET) givenUpAt = monotonicNow();
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
    failActive = undefined;
  }
}

/**
 * Optional acceleration: CSP, WebView and worker failures retain the local path.
 * `size` is the input length in characters and scales the deadline.
 */
export async function runDiffWorker<T>(
  invoke: (remote: Remote<DiffWorkerApi>) => Promise<T>,
  fallback: () => T | Promise<T>,
  options: { size?: number } = {},
): Promise<T> {
  const run = queue.then(() => attempt(invoke, options.size ?? 0));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  const result = await run;
  return result.ok ? result.value : fallback();
}
