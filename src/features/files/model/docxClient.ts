import { checkDocxHtml } from "./docxPreview";

export const DOCX_TIMEOUT = 15_000;
type Reply = { ok: true; html: string } | { ok: false; message: string };

/** Each view owns its converter. Cancellation terminates CPU work, not just its reply. */
export function loadDocx(
  bytes: Uint8Array,
  signal: AbortSignal,
  createWorker = () => new Worker(new URL("./docx.worker.ts", import.meta.url), { type: "module" }),
  timeout = DOCX_TIMEOUT,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (cause) {
      reject(cause);
      return;
    }
    let finished = false;
    const finish = (cause?: unknown, html?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (cause) reject(cause);
      else resolve(html!);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new Error("Document preview exceeded 15 seconds. Open it in the default app instead."),
        ),
      timeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      try {
        if (!event.data.ok) return finish(new Error(event.data.message));
        checkDocxHtml(event.data.html);
        finish(undefined, event.data.html);
      } catch (cause) {
        finish(cause);
      }
    };
    worker.onerror = () =>
      finish(new Error("Document conversion failed. Open it in the default app instead."));
    try {
      // The original belongs to the shared document cache and must remain readable.
      const copy = bytes.slice();
      worker.postMessage(copy, [copy.buffer]);
    } catch (cause) {
      finish(cause);
    }
  });
}
