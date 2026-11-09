import type { SessionSync } from "./protocol";

const WORKER_THRESHOLD = 256 * 1024;

/** Large immutable transfers are joined and decoded outside the renderer thread. */
export async function decodeSessionSync(pieces: string[], length: number): Promise<SessionSync> {
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 32 * 1024 * 1024 ||
    pieces.some((piece) => typeof piece !== "string") ||
    pieces.reduce((sum, piece) => sum + piece.length, 0) !== length
  )
    throw new Error("Invalid session transfer length");
  if (length < WORKER_THRESHOLD || typeof Worker === "undefined") {
    // Non-browser callers keep the same wire contract. Yield before their bounded decode.
    if (length >= WORKER_THRESHOLD) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return JSON.parse(pieces.join("")) as SessionSync;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./sessionSyncDecode.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (value?: SessionSync, error?: Error) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(undefined, new Error("Session transfer decode timed out")),
      15_000,
    );
    worker.onmessage = (event: MessageEvent<{ value?: SessionSync; error?: string }>) => {
      if (event.data.error) finish(undefined, new Error(event.data.error));
      else if (event.data.value) finish(event.data.value);
      else finish(undefined, new Error("Invalid session decode response"));
    };
    worker.onerror = () => finish(undefined, new Error("Session transfer decoder failed"));
    try {
      worker.postMessage({ pieces, length });
    } catch {
      finish(undefined, new Error("Session transfer could not be decoded"));
    }
  });
}
