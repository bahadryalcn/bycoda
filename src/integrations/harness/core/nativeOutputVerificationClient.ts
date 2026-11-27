import {
  checkedOutputFrame,
  digestOutputFrame,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_ITEMS,
  verifyOutputItems,
  type VerificationChannel,
} from "./nativeOutputVerification";

type Job = {
  channel: VerificationChannel;
  items: readonly string[];
  utf8Bytes: number;
  resolve: (digest: string) => void;
  reject: () => void;
};
const pending = new Map<number, { job: Job; timer: ReturnType<typeof setTimeout> }>();
const queue: Job[] = [];
const MAX_REQUESTS = 32;
const MAX_QUEUED = 256;
const JOB_TIMEOUT_MS = 30_000;
const MAX_CONSECUTIVE_TIMEOUTS = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
let worker: Worker | undefined;
let requestId = 0;
// Recoverable failures only pause the worker: until this timer fires, callers verify with the
// full inline codec; afterwards the next request recreates the worker.
let backingOff = false;
let backoffTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let timeouts = 0;

function scheduleRetry(): void {
  failures += 1;
  backingOff = true;
  clearTimeout(backoffTimer);
  backoffTimer = setTimeout(
    () => {
      backingOff = false;
    },
    Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 16)),
  );
}
function retireWorker(instance: Worker): void {
  if (worker !== instance) return;
  worker = undefined;
  scheduleRetry();
  instance.terminate();
  // Every in-flight or queued job rejects; each caller re-verifies its own snapshot inline.
  const jobs = [...pending.values()];
  for (const entry of jobs) clearTimeout(entry.timer);
  pending.clear();
  const waiting = queue.splice(0);
  for (const entry of jobs) entry.job.reject();
  for (const job of waiting) job.reject();
}
function pump(instance: Worker): void {
  while (worker === instance && queue.length && pending.size < MAX_REQUESTS) {
    if (requestId >= Number.MAX_SAFE_INTEGER) {
      retireWorker(instance);
      return;
    }
    const job = queue.shift() as Job;
    const id = ++requestId;
    const timer = setTimeout(() => {
      // Only the job that missed its deadline fails; its late proof is ignored (id is gone).
      if (!pending.delete(id)) return;
      job.reject();
      if (worker !== instance) return;
      if (++timeouts >= MAX_CONSECUTIVE_TIMEOUTS) retireWorker(instance);
      else pump(instance);
    }, JOB_TIMEOUT_MS);
    pending.set(id, { job, timer });
    try {
      instance.postMessage({
        id,
        channel: job.channel,
        items: job.items,
        utf8Bytes: job.utf8Bytes,
      });
    } catch {
      retireWorker(instance);
      return;
    }
  }
}
function verifierWorker(): Worker | undefined {
  if (typeof Worker === "undefined" || backingOff) return;
  if (worker) return worker;
  try {
    const instance = new Worker(new URL("./nativeOutputVerification.worker.ts", import.meta.url), {
      type: "module",
    });
    worker = instance;
    instance.onmessage = (event: MessageEvent<unknown>) => {
      if (worker !== instance || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (!Number.isSafeInteger(data.id)) return;
      const entry = pending.get(data.id as number);
      if (!entry) return;
      if (Object.keys(data).length === 2 && data.error === true) {
        pending.delete(data.id as number);
        clearTimeout(entry.timer);
        entry.job.reject();
        pump(instance);
        return;
      }
      if (
        Object.keys(data).length !== 2 ||
        typeof data.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.digest)
      ) {
        retireWorker(instance);
        return;
      }
      pending.delete(data.id as number);
      clearTimeout(entry.timer);
      failures = 0;
      timeouts = 0;
      entry.job.resolve(data.digest);
      pump(instance);
    };
    instance.onerror = () => retireWorker(instance);
    instance.onmessageerror = () => retireWorker(instance);
    return instance;
  } catch {
    scheduleRetry();
    return;
  }
}
function requestVerification(
  channel: VerificationChannel,
  items: readonly string[],
  utf8Bytes: number,
): Promise<string> {
  const instance = verifierWorker();
  if (!instance || queue.length >= MAX_QUEUED)
    return Promise.reject(new Error("verification-unavailable"));
  return new Promise((resolve, reject) => {
    queue.push({
      channel,
      items,
      utf8Bytes,
      resolve,
      reject: () => reject(new Error("verification-unavailable")),
    });
    pump(instance);
  });
}

/** Snapshot once: strings are immutable, only the bounded array of references is copied.
 * No worker reply alone grants authority; caller compares exact original expected digest.
 * A failed worker always uses the same full codec, never an unsigned success. Worker
 * failures are transient: the worker is recreated after a bounded backoff, requests beyond
 * the in-flight cap queue for the worker, and a timeout fails only its own job. */
export function prepareOutputVerification(
  channel: VerificationChannel,
  items: readonly string[],
  utf8Bytes: number,
): () => Promise<string> {
  if (!items.length || items.length > MAX_OUTPUT_ITEMS) throw new Error("invalid-payload");
  let units = 0;
  for (const item of items) {
    if (typeof item !== "string" || (units += item.length) > MAX_OUTPUT_BYTES)
      throw new Error("invalid-payload");
  }
  if (units > utf8Bytes) throw new Error("invalid-payload");
  const snapshot = Object.freeze([...items]);
  if (!verifierWorker()) {
    const frame = checkedOutputFrame(channel, snapshot, utf8Bytes);
    let work: Promise<string> | undefined;
    return () => (work ??= digestOutputFrame(frame));
  }
  let work: Promise<string> | undefined;
  return () =>
    (work ??= requestVerification(channel, snapshot, utf8Bytes).catch(() =>
      verifyOutputItems(channel, snapshot, utf8Bytes),
    ));
}

import.meta.hot?.dispose(() => {
  if (worker) retireWorker(worker);
  clearTimeout(backoffTimer);
  backingOff = false;
  failures = 0;
  timeouts = 0;
});
