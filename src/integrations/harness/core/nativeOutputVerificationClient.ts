import {
  checkedOutputFrame,
  digestOutputFrame,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_ITEMS,
  verifyOutputItems,
  type VerificationChannel,
} from "./nativeOutputVerification";

type Pending = {
  resolve: (digest: string) => void;
  reject: () => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<number, Pending>();
const MAX_REQUESTS = 32;
let worker: Worker | undefined;
let disabled = false;
let requestId = 0;

function retireWorker(instance: Worker): void {
  if (worker !== instance) return;
  worker = undefined;
  disabled = true;
  instance.terminate();
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject();
  }
  pending.clear();
}
function verifierWorker(): Worker | undefined {
  if (disabled || typeof Worker === "undefined") return;
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
      const job = pending.get(data.id as number);
      if (!job) return;
      if (Object.keys(data).length === 2 && data.error === true) {
        pending.delete(data.id as number);
        clearTimeout(job.timer);
        job.reject();
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
      clearTimeout(job.timer);
      job.resolve(data.digest);
    };
    instance.onerror = () => retireWorker(instance);
    instance.onmessageerror = () => retireWorker(instance);
    return instance;
  } catch {
    disabled = true;
    return;
  }
}
function requestVerification(
  instance: Worker,
  channel: VerificationChannel,
  items: readonly string[],
  utf8Bytes: number,
): Promise<string> {
  if (worker !== instance || pending.size >= MAX_REQUESTS || requestId >= Number.MAX_SAFE_INTEGER)
    return Promise.reject(new Error("verification-unavailable"));
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => retireWorker(instance), 30_000);
    pending.set(id, {
      resolve,
      reject: () => reject(new Error("verification-unavailable")),
      timer,
    });
    try {
      instance.postMessage({ id, channel, items, utf8Bytes });
    } catch {
      retireWorker(instance);
    }
  });
}

/** Snapshot once: strings are immutable, only the bounded array of references is copied.
 * No worker reply alone grants authority; caller compares exact original expected digest.
 * A failed worker always uses the same full codec, never an unsigned success. */
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
  const instance = verifierWorker();
  if (!instance) {
    const frame = checkedOutputFrame(channel, snapshot, utf8Bytes);
    let work: Promise<string> | undefined;
    return () => (work ??= digestOutputFrame(frame));
  }
  let work: Promise<string> | undefined;
  return () =>
    (work ??= requestVerification(instance, channel, snapshot, utf8Bytes).catch(() =>
      verifyOutputItems(channel, snapshot, utf8Bytes),
    ));
}

import.meta.hot?.dispose(() => {
  if (worker) retireWorker(worker);
});
