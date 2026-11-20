/**
 * Chunk pipeline behind `prepareLocalFileCopy`: the same 1 MiB requests the Host and the native
 * copy already accept, now overlapped, retried on a passing outage and cancellable at once.
 */

/** The Host and `remote_files.rs` both refuse a larger chunk. */
export const REMOTE_COPY_CHUNK_BYTES = 1024 * 1024;

/**
 * Chunks requested ahead of the one being written. A few in flight hide the round trip while
 * staying far below the Host's per-device read limit.
 */
export const REMOTE_COPY_PREFETCH = 2;

/** Waits before each retry of one request; the last failure is thrown. */
export const REMOTE_COPY_RETRY_DELAYS_MS: readonly number[] = [250, 750, 2000];

export type RemoteChunk = { data: string; offset: number; length: number };

function abortError(): DOMException {
  return new DOMException("Cancelled", "AbortError");
}

/**
 * Settles with `work`, or rejects with an `AbortError` the moment `signal` aborts. A Tauri
 * request cannot be withdrawn, so a late answer is dropped without being used.
 */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return abortable(new Promise<void>((resolve) => setTimeout(resolve, ms)), signal);
}

export type RetryOptions = {
  signal?: AbortSignal;
  /** Only a failure that proves nothing about the request itself (a dropped or busy link). */
  isTransient: (error: unknown) => boolean;
  /** Replaceable wait, so a test needs no timers. */
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * Runs a read-only request again after a transient failure, with bounded backoff. Cancelling
 * rejects at once, also while waiting. Any other failure, such as a changed file version, is
 * thrown unchanged on the first attempt.
 */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  { signal, isTransient, delay = sleep }: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      return await abortable(operation(), signal);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      const wait = REMOTE_COPY_RETRY_DELAYS_MS[attempt];
      if (wait === undefined || !isTransient(error)) throw error;
      await delay(wait, signal);
    }
  }
}

export type RemoteChunkDownload = {
  size: number;
  signal?: AbortSignal;
  /** Reads one chunk of the exact source revision; the Host rejects a changed one. */
  read: (offset: number, length: number) => Promise<RemoteChunk>;
  /** Writes at `offset`; the native copy accepts only the next offset or a byte-identical replay. */
  append: (offset: number, data: string) => Promise<void>;
  isTransient: (error: unknown) => boolean;
  onProgress?: (received: number, total: number) => void;
  delay?: RetryOptions["delay"];
};

/**
 * Reads every chunk of a file of `size` bytes and appends them in byte order. Reads overlap the
 * write of the previous chunk; each read is retried on its own, so a passing outage resumes at
 * the failed offset with the same version instead of restarting. Appends are never retried:
 * they are local, and their failure ends the download.
 */
export async function downloadRemoteChunks({
  size,
  signal: callerSignal,
  read,
  append,
  isTransient,
  onProgress,
  delay,
}: RemoteChunkDownload): Promise<void> {
  const control = new AbortController();
  const relay = () => control.abort();
  if (callerSignal?.aborted) control.abort();
  else callerSignal?.addEventListener("abort", relay, { once: true });
  const { signal } = control;

  type Pending = { requested: number; result: Promise<RemoteChunk> };
  let queue: Pending[] = [];
  let next = 0;
  const request = () => {
    const offset = next;
    const requested = Math.min(REMOTE_COPY_CHUNK_BYTES, size - offset);
    const result = retryTransient(() => read(offset, requested), { signal, isTransient, delay });
    // A prefetched read that is never awaited (an earlier chunk failed) must not be an
    // unhandled rejection; the awaited path below still sees its error.
    result.catch(() => undefined);
    queue.push({ requested, result });
    next += requested;
  };
  const fill = () => {
    while (queue.length <= REMOTE_COPY_PREFETCH && next < size) request();
  };

  try {
    if (signal.aborted) throw abortError();
    onProgress?.(0, size);
    let offset = 0;
    fill();
    while (offset < size) {
      const head = queue.shift();
      if (!head) throw new Error("The connected machine returned an invalid file chunk.");
      const chunk = await head.result;
      // Overlap the next reads with this chunk's write.
      fill();
      if (
        chunk.offset !== offset ||
        !Number.isSafeInteger(chunk.length) ||
        chunk.length < 1 ||
        chunk.length > head.requested ||
        typeof chunk.data !== "string"
      )
        throw new Error("The connected machine returned an invalid file chunk.");
      await abortable(append(offset, chunk.data), signal);
      offset += chunk.length;
      onProgress?.(offset, size);
      if (chunk.length < head.requested) {
        // A short chunk shifts every later offset: the reads already ahead are stale.
        queue = [];
        next = offset;
        fill();
      }
    }
  } finally {
    // Stops retries and waits of reads still in flight when the download ends or fails.
    control.abort();
    callerSignal?.removeEventListener("abort", relay);
  }
}
