import type { Spreadsheet } from "./spreadsheet";

export const SPREADSHEET_TIMEOUT = 15_000;
type Reply = { ok: true; book: Spreadsheet } | { ok: false; message: string };
export function loadSpreadsheet(
  bytes: Uint8Array,
  signal: AbortSignal,
  createWorker = () =>
    new Worker(new URL("./spreadsheet.worker.ts", import.meta.url), {
      type: "module",
    }),
  timeout = SPREADSHEET_TIMEOUT,
  format?: "csv" | "tsv",
): Promise<Spreadsheet> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (cause) {
      reject(cause);
      return;
    }
    const finish = (cause?: unknown, book?: Spreadsheet) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (cause) reject(cause);
      else resolve(book!);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new Error("Spreadsheet preview exceeded 15 seconds. Open it in the default app instead."),
        ),
      timeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<Reply>) =>
      event.data.ok ? finish(undefined, event.data.book) : finish(new Error(event.data.message));
    worker.onerror = () =>
      finish(new Error("Spreadsheet worker failed. Open it in the default app instead."));
    try {
      // Transfer a copy: other document views still own the original bytes.
      const copy = bytes.slice();
      worker.postMessage(format ? { bytes: copy, format } : copy, [copy.buffer]);
    } catch (cause) {
      finish(cause);
    }
  });
}
