import { wrap, type Remote } from "comlink";
import type { DiffWorkerApi } from "./diffWorker.worker";

let worker: Worker | undefined;
let api: Remote<DiffWorkerApi> | undefined;
let unavailable = false;
const pendingFailures = new Set<(reason: Error) => void>();
function disable() {
  unavailable = true;
  worker?.terminate();
  worker = undefined;
  api = undefined;
  for (const fail of pendingFailures) fail(new Error("Diff worker unavailable"));
  pendingFailures.clear();
}

/** Optional acceleration: CSP, WebView and worker failures retain the local path. */
export async function runDiffWorker<T>(
  invoke: (remote: Remote<DiffWorkerApi>) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (!unavailable && typeof Worker !== "undefined") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectPending: ((error: Error) => void) | undefined;
    try {
      if (!api) {
        worker = new Worker(new URL("./diffWorker.worker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("error", disable);
        worker.addEventListener("messageerror", disable);
        api = wrap<DiffWorkerApi>(worker);
      }
      const failed = new Promise<never>((_, reject) => {
        rejectPending = reject;
        pendingFailures.add(reject);
        timer = setTimeout(() => reject(new Error("Diff worker timed out")), 10_000);
      });
      return await Promise.race([invoke(api), failed]);
    } catch {
      disable();
    } finally {
      if (timer) clearTimeout(timer);
      if (rejectPending) pendingFailures.delete(rejectPending);
    }
  }
  return fallback();
}
